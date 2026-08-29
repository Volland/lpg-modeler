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
})
