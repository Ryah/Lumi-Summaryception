import { describe, expect, test } from 'bun:test';
import {
  cleanOutput, coveredIds, createStore, eligibleCount, normalizeSettings,
  parseStoredStore, promoteLayers, reconcile, skipBacklog, summarizeBatch, validateStore,
  type Message, type Settings, type Store, type Summarize,
} from '../src/engine.js';

function conversation(turns: number): Message[] {
  const messages: Message[] = [];
  for (let turn = 0; turn < turns; turn++) {
    messages.push({ id: `user-${turn}`, role: 'user', content: `Question ${turn}`, name: 'Ada' });
    messages.push({ id: `assistant-${turn}`, role: 'assistant', content: `Answer ${turn}` });
  }
  return messages;
}
function settings(overrides: Partial<Settings> = {}): Settings {
  return normalizeSettings({ verbatimTurns: 0, turnsPerSummary: 1, ...overrides });
}
async function recorded(turns: number, configuration = settings()): Promise<{ store: Store; messages: Message[] }> {
  const messages = conversation(turns);
  const store = createStore('chat');
  const signal = new AbortController().signal;
  while (eligibleCount(store, messages, configuration)) {
    await summarizeBatch(store, messages, configuration, async story => `Memory: ${story}`, signal);
  }
  return { store, messages };
}

describe('source reconciliation and recursive coverage', () => {
  test('an edit inside promoted coverage invalidates the whole merged range and later memory', async () => {
    const configuration = settings({ snippetsPerLayer: 1, snippetsPerPromotion: 2, maxLayers: 3 });
    const { store, messages } = await recorded(8, configuration);
    const originalCoverage = [...coveredIds(store)];
    await promoteLayers(store, configuration, async () => 'Compressed memory', new AbortController().signal);
    expect([...coveredIds(store)].sort()).toEqual(originalCoverage.sort());
    const promoted = store.layers.slice(1).flat().find(snippet => snippet.end > snippet.start + 1)!;
    expect(promoted).toBeDefined();
    messages[promoted.end].content = 'Edited after promotion';
    expect(reconcile(store, messages)).toBe(true);
    expect(store.sources).toHaveLength(promoted.start);
    expect(store.layers.flat().every(snippet => snippet.end < promoted.start)).toBe(true);
    expect(coveredIds(store).has(messages[promoted.end].id)).toBe(false);
    expect(eligibleCount(store, messages, configuration)).toBeGreaterThan(0);
  });

  test('deleting or replacing a source identity invalidates memory even with identical text', async () => {
    for (const change of ['delete', 'replace', 'role', 'name'] as const) {
      const { store, messages } = await recorded(4);
      if (change === 'delete') messages.splice(2, 1);
      else if (change === 'replace') messages[2].id = 'replacement-user';
      else if (change === 'role') messages[2].role = 'system';
      else messages[2].name = 'Different speaker';
      expect(reconcile(store, messages)).toBe(true);
      expect(store.sources).toHaveLength(2);
      expect(store.layers.flat()).toHaveLength(1);
    }
  });

  test('an appended message does not invalidate previously processed sources', async () => {
    const { store, messages } = await recorded(2);
    messages.push({ id: 'next', role: 'user', content: 'Continue' });
    expect(reconcile(store, messages)).toBe(false);
    expect(store.sources).toHaveLength(4);
  });
});

describe('verbatim and skipped boundaries', () => {
  test('a batch counts assistants while preserving intervening user text and newest assistant turns', async () => {
    const messages = conversation(5);
    messages.push({ id: 'trailing-user', role: 'user', content: 'Latest question' });
    const store = createStore('chat');
    const configuration = settings({ verbatimTurns: 2, turnsPerSummary: 3 });
    let passage = '';
    expect(eligibleCount(store, messages, configuration)).toBe(3);
    await summarizeBatch(store, messages, configuration, async story => { passage = story; return 'A useful memory'; }, new AbortController().signal);
    expect(passage).toContain('Ada: Question 0');
    expect(passage).toContain('Ada: Question 1');
    expect(passage).toContain('Ada: Question 2');
    expect(passage).not.toContain('Question 3');
    expect(store.layers[0][0]).toMatchObject({ start: 0, end: 5 });
    expect(eligibleCount(store, messages, configuration)).toBe(0);
    expect([...coveredIds(store)]).toEqual(messages.slice(0, 6).map(message => message.id));
    expect(coveredIds(store).has('trailing-user')).toBe(false);
  });

  test('short final batches never consume retained turns; empty assistants do not count', async () => {
    const messages = conversation(3);
    messages.splice(2, 0, { id: 'empty', role: 'assistant', content: '  ' });
    const configuration = settings({ verbatimTurns: 2, turnsPerSummary: 5 });
    const store = createStore('chat');
    expect(await summarizeBatch(store, messages, configuration, async () => 'One old turn', new AbortController().signal)).toBe(true);
    expect(store.sources).toHaveLength(2);
    let called = false;
    expect(await summarizeBatch(store, messages, configuration, async () => { called = true; return 'Unexpected'; }, new AbortController().signal)).toBe(false);
    expect(called).toBe(false);
  });

  test('skips do not ghost messages, including after promotion across a skipped gap', async () => {
    const messages = conversation(6);
    const store = createStore('chat');
    const configuration = settings({ snippetsPerLayer: 1, snippetsPerPromotion: 2 });
    const signal = new AbortController().signal;
    await summarizeBatch(store, messages.slice(0, 2), configuration, async () => 'First memory', signal);
    skipBacklog(store, messages.slice(0, 6), configuration);
    const skippedIds = messages.slice(2, 6).map(message => message.id);
    while (eligibleCount(store, messages, configuration)) await summarizeBatch(store, messages, configuration, async () => 'Later memory', signal);
    await promoteLayers(store, configuration, async () => 'Merged later memory', signal);
    for (const id of skippedIds) expect(coveredIds(store).has(id)).toBe(false);
    expect(store.skipped).toBe(4);
    expect(coveredIds(store).has('assistant-0')).toBe(true);
    expect(coveredIds(store).has('assistant-5')).toBe(true);
    messages[3].content = 'Changed a skipped source';
    expect(reconcile(store, messages)).toBe(true);
    expect(store.sources).toHaveLength(3);
    expect(store.skipped).toBe(1);
  });
});

describe('loss-safe generation boundaries', () => {
  test('rejected, empty, reasoning-only and cancelled batches leave all store fields unchanged', async () => {
    const cases: ((controller: AbortController) => Summarize)[] = [
      () => async () => { throw new Error('Provider failed'); },
      () => async () => '  ',
      () => async () => '<thinking>private thoughts</thinking>',
      controller => async () => { controller.abort(); return 'Too late'; },
    ];
    for (const makeSummarizer of cases) {
      const { store, messages } = await recorded(1);
      messages.push(...conversation(1).map(message => ({ ...message, id: `later-${message.id}` })));
      const before = structuredClone(store);
      const controller = new AbortController();
      await expect(summarizeBatch(store, messages, settings(), makeSummarizer(controller), controller.signal)).rejects.toThrow();
      expect(store).toEqual(before);
    }
  });

  test('a pending call cannot commit edited source text', async () => {
    const store = createStore('chat');
    const messages = conversation(1);
    const result = Promise.withResolvers<string>();
    const pending = summarizeBatch(store, messages, settings(), () => result.promise, new AbortController().signal);
    messages[0].content = 'New user text';
    result.resolve('Summary of stale text');
    await expect(pending).rejects.toThrow('changed during summarization');
    expect(store).toEqual(createStore('chat'));
  });

  test('promotion failure or cancellation retains inputs and rolls back free seeds', async () => {
    for (const failure of ['reject', 'empty', 'cancel'] as const) {
      const configuration = settings({ snippetsPerLayer: 1, snippetsPerPromotion: 2 });
      const { store } = await recorded(6, configuration);
      const before = structuredClone(store);
      const controller = new AbortController();
      const summarize: Summarize = async () => {
        if (failure === 'reject') throw new Error('Compression failed');
        if (failure === 'cancel') controller.abort();
        return failure === 'empty' ? '<reasoning>nothing</reasoning>' : 'Cancelled text';
      };
      await expect(promoteLayers(store, configuration, summarize, controller.signal)).rejects.toThrow();
      expect(store).toEqual(before);
    }
  });

  test('direct seeding costs no generation and retains exact source coverage', async () => {
    const { store } = await recorded(2);
    let called = false;
    const before = [...coveredIds(store)];
    const oldest = structuredClone(store.layers[0][0]);
    await promoteLayers(store, settings({ snippetsPerLayer: 1 }), async () => { called = true; return 'Unneeded'; }, new AbortController().signal);
    expect(called).toBe(false);
    expect(store.layers[1][0]).toEqual(oldest);
    expect([...coveredIds(store)].sort()).toEqual(before.sort());
  });
});

describe('import provenance and corruption', () => {
  test('native imports reject wrong chat, modified content, duplicate identities and invalid ranges', async () => {
    const { store, messages } = await recorded(2);
    expect(() => validateStore(store, 'other-chat', messages)).toThrow();
    const changed = structuredClone(messages);
    changed[1].content = 'Not the exported history';
    expect(() => validateStore(store, 'chat', changed)).toThrow();
    const corruptions = [
      (copy: Store) => { copy.sources[1].id = copy.sources[0].id; },
      (copy: Store) => { copy.sources[0].fingerprint = 'not-a-hash'; },
      (copy: Store) => { copy.layers[0][1].start = 1; },
      (copy: Store) => { copy.layers[0][0].end = 100; },
      (copy: Store) => { copy.layers[0][0].text = ''; },
      (copy: Store) => { copy.layers[0][0].timestamp = NaN; },
    ];
    for (const corrupt of corruptions) {
      const copy = structuredClone(store);
      corrupt(copy);
      expect(() => validateStore(copy, 'chat', messages)).toThrow();
    }
  });

  test('persisted memory can be parsed then reconciled without accepting stale history as an import', async () => {
    const { store, messages } = await recorded(3);
    messages[3].content = 'Edited before reload';
    const loaded = parseStoredStore(JSON.parse(JSON.stringify(store)), 'chat');
    expect(reconcile(loaded, messages)).toBe(true);
    expect(loaded.sources).toHaveLength(2);
    expect(() => validateStore(store, 'chat', messages)).toThrow();
  });

  test('actual ST nested ranged exports bind coverage but un-ranged promoted exports are rejected', () => {
    const messages = conversation(3);
    const original = {
      layers: [[{ text: 'Earlier events', turnRange: [0, 1], timestamp: 123 }]],
      summarizedUpTo: 3,
      ghostedIndices: [0, 1, 2, 3],
    };
    const imported = validateStore(original, 'chat', messages);
    expect([...coveredIds(imported)]).toEqual(['user-0', 'assistant-0']);
    expect(imported.skipped).toBe(2);
    expect(() => validateStore({ ...original, chatId: 'different' }, 'chat', messages)).toThrow();
    expect(() => validateStore({ ...original, summarizedUpTo: 100 }, 'chat', messages)).toThrow();
    expect(() => validateStore({ ...original, layers: [original.layers[0], [{ text: 'Merged', fromLayer: 0, mergedCount: 3, timestamp: 124 }]] }, 'chat', messages)).toThrow('no recoverable source range');
    expect(() => validateStore({ ...original, layers: [[{ text: 'Bad', turnRange: ['0', 1], timestamp: 123 }]] }, 'chat', messages)).toThrow();
  });

  test('reasoning delimiters are removed with their content before custom stripping', () => {
    expect(cleanOutput('<thinking>do not save this</thinking><output>Ada reached town.</output>', settings())).toBe('Ada reached town.');
    expect(cleanOutput('<|channel>thoughtsecret<channel|>Useful memory', settings())).toBe('Useful memory');
  });
});
