import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// @lat: [[architecture#Package Boundary]]
describe('package boundary', () => {
  it('core never imports vscode', () => {
    const root = join(__dirname, '..', 'src')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!p.endsWith('.ts')) continue
        const text = readFileSync(p, 'utf8')
        if (/from\s+['"]vscode['"]|require\(\s*['"]vscode['"]\s*\)/.test(text)) offenders.push(p)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })

  /**
   * The LadybugDB runtime carries native bindings, and the extension inlines `core`, so
   * `core` reads a database only through a connection the command line hands it. A
   * type-only import counts too: it would make the package a build dependency of `core`.
   */
  it('core never imports the LadybugDB runtime', () => {
    const root = join(__dirname, '..', 'src')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry)
        if (statSync(p).isDirectory()) { walk(p); continue }
        if (!p.endsWith('.ts')) continue
        if (/['"]@ladybugdb\/[^'"]*['"]/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
