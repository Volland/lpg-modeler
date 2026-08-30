import { build } from 'esbuild'

/**
 * The CLI ships as one self-contained package. Core is inlined rather than published
 * beside it, which is the same trade the extension makes: a published artifact that
 * carries no node_modules cannot resolve a bare workspace import.
 * See lat.md/architecture#Distribution.
 */
await build({
  entryPoints: ['dist/cli.js'],
  outfile: 'dist/cli.js',
  bundle: true,
  allowOverwrite: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  logLevel: 'warning',
})
console.log('cli bundled')
