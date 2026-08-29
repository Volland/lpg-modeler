import { build } from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'out'), { recursive: true })

await build({
  entryPoints: [join(root, 'src', 'webview', 'main.tsx')],
  outfile: join(root, 'out', 'webview.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  minify: true,
  loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"' },
})

// React Flow ships its own stylesheet; concatenate it with ours so the webview needs
// exactly one style resource (the CSP allows no external stylesheet hosts).
const reactFlowCss = readFileSync(
  join(root, '..', '..', 'node_modules', '@xyflow', 'react', 'dist', 'style.css'), 'utf8')
const ours = readFileSync(join(root, 'src', 'webview', 'styles.css'), 'utf8')
writeFileSync(join(root, 'out', 'webview.css'), `${reactFlowCss}\n${ours}`)

console.log('webview bundled')
