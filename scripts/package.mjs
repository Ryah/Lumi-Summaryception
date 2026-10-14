import { zipSync } from 'fflate'
import { mkdir, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

const manifest = await Bun.file('spindle.json').json()
const files = [
  'spindle.json', 'package.json', 'bun.lock', 'tsconfig.json', 'LICENSE', 'README.md',
  'THIRD-PARTY-NOTICES.txt',
  'CHANGELOG.md', '.gitignore', 'src/backend.ts', 'src/frontend.ts', 'src/engine.ts',
  'test/engine.test.ts', 'scripts/build.mjs', 'scripts/package.mjs',
  'dist/backend.js', 'dist/frontend.js',
]
const archive = {}
for (const path of files) archive[`summaryception/repo/${path}`] = new Uint8Array(await Bun.file(path).arrayBuffer())
await mkdir('release', { recursive: true })
const output = `release/Summaryception-${manifest.version}.zip`
await Bun.write(output, zipSync(archive, { level: 6 }))
console.log(`Created ${output} with bundles and complete corresponding source.`)

if (process.argv.includes('--stage-local')) {
  const target = resolve('../data/extensions/summaryception/repo')
  let exists = true
  try { await access(target) } catch { exists = false }
  if (exists) throw new Error(`Refusing to overwrite an existing extension: ${target}`)
  for (const path of files) {
    const destination = resolve(target, path)
    await mkdir(dirname(destination), { recursive: true })
    await Bun.write(destination, Bun.file(path))
  }
  console.log(`Staged ${target}. Import Local and enable it in Lumiverse; no database or chat was modified.`)
}
