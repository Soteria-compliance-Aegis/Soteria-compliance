// Bundles tests/buyerSummary.render.tsx with the esbuild that ships with vite,
// runs it, and exits non-zero on the first failed check. No test framework.
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const outdir = resolve(root, '.buyer-render')
const bundle = resolve(outdir, 'buyerSummary.render.cjs')

try {
  await build({
    absWorkingDir: root,
    entryPoints: ['tests/buyerSummary.render.tsx'],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    target: 'node20',
    logLevel: 'silent',
  })
  const module = await import(pathToFileURL(bundle).href)
  const run = module.run ?? module.default?.run
  if (typeof run !== 'function') throw new Error('render bundle exported no run()')
  for (const line of run()) console.log(`ok  ${line}`)
  console.log('ok  buyer summary render')
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.stack ?? error.message : error}`)
  process.exitCode = 1
} finally {
  await rm(outdir, { recursive: true, force: true })
}
