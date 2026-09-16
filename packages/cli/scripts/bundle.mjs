import { build } from 'esbuild'

/**
 * The CLI ships as one self-contained package. Core is inlined rather than published
 * beside it, which is the same trade the extension makes: a published artifact that
 * carries no node_modules cannot resolve a bare workspace import.
 * See lat.md/architecture#Distribution.
 *
 * The LadybugDB runtime is the one exception. It carries a native binding per platform,
 * which a bundle cannot inline, and only a database import needs it, so it stays an
 * external `require` resolved when that command runs.
 */
await build({
  entryPoints: ['dist/cli.js'],
  outfile: 'dist/cli.js',
  bundle: true,
  allowOverwrite: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['@ladybugdb/core'],
  logLevel: 'warning',
})
console.log('cli bundled')
