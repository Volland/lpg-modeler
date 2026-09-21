import { build } from 'esbuild'

/**
 * The CLI ships as one self-contained package. Core is inlined rather than published
 * beside it, which is the same trade the extension makes: a published artifact that
 * carries no node_modules cannot resolve a bare workspace import.
 * See lat.md/architecture#Distribution.
 *
 * Two runtimes are the exception, each needed by one command family only: the LadybugDB
 * runtime carries a native binding per platform, which a bundle cannot inline, and the
 * Bolt driver is several megabytes that only a Memgraph import and `apply` use. Both stay
 * external `require`s resolved when those commands run.
 */
await build({
  entryPoints: ['dist/cli.js'],
  outfile: 'dist/cli.js',
  bundle: true,
  allowOverwrite: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['@ladybugdb/core', 'neo4j-driver', 'redis'],
  logLevel: 'warning',
})
console.log('cli bundled')
