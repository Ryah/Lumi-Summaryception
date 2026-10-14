import { mkdir } from 'node:fs/promises'

await mkdir('dist', { recursive: true })
for (const entrypoint of ['./src/backend.ts', './src/frontend.ts']) {
  const result = await Bun.build({ entrypoints: [entrypoint], outdir: './dist', target: 'browser', format: 'esm', minify: false, sourcemap: 'none' })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}
console.log('Summaryception bundles written to dist/.')
