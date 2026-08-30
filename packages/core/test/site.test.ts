import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DOCS = resolve(__dirname, '..', '..', '..', 'docs')
const pages = () => readdirSync(DOCS).filter((f) => f.endsWith('.html'))
const read = (f: string) => readFileSync(join(DOCS, f), 'utf8')

/**
 * Hosts a page may link to. A link is a navigation the reader chooses; what matters
 * for the privacy statement is what the browser fetches on its own.
 */
const LINKABLE = ['github.com', 'docs.github.com', 'www.datenschutz-berlin.de']

// @lat: [[architecture#Distribution#Documentation site]]
describe('the documentation site makes no third-party request', () => {
  it('fetches no subresource from another origin', () => {
    // The Datenschutzerklaerung states that nothing is loaded from a third party. That
    // is only true while it is true, so it is asserted rather than trusted.
    const offenders: string[] = []
    for (const page of pages()) {
      const html = read(page)
      // Anything the browser fetches without being asked: stylesheets, scripts, images,
      // preconnects. Plain <a href> links are navigations and do not count.
      for (const m of html.matchAll(/<(?:link|script|img|iframe|source)\b[^>]*?(?:src|href)="([^"]+)"/g)) {
        const url = m[1]!
        if (/^https?:\/\//.test(url)) offenders.push(`${page}: ${url}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never reaches Google Fonts, which is the claim most likely to regress', () => {
    for (const page of pages()) {
      expect(read(page)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    }
    for (const css of readdirSync(join(DOCS, 'assets')).filter((f) => f.endsWith('.css'))) {
      expect(readFileSync(join(DOCS, 'assets', css), 'utf8'))
        .not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
    }
  })

  it('sets no cookie and touches no client-side storage', () => {
    for (const page of pages()) {
      const html = read(page)
      expect(html).not.toMatch(/document\.cookie|localStorage|sessionStorage|indexedDB/)
    }
  })

  it('serves every declared font from this origin', () => {
    const css = readFileSync(join(DOCS, 'assets', 'fonts.css'), 'utf8')
    const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map((m) => m[1]!)
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url.startsWith('http')).toBe(false)
      expect(existsSync(join(DOCS, 'assets', url))).toBe(true)
    }
  })

  it('links only to hosts the legal pages account for', () => {
    const seen = new Set<string>()
    for (const page of pages()) {
      for (const m of read(page).matchAll(/href="https?:\/\/([^/"]+)/g)) seen.add(m[1]!)
    }
    expect([...seen].filter((h) => !LINKABLE.includes(h))).toEqual([])
  })
})

// @lat: [[architecture#Distribution#Legal pages]]
describe('legal pages', () => {
  it('is reachable from every page, which is what an Impressum has to be', () => {
    for (const page of pages()) {
      const html = read(page)
      for (const target of ['impressum.html', 'datenschutz.html', 'agb.html']) {
        expect(html.includes(`href="${target}"`)).toBe(true)
      }
    }
  })

  it('names the responsible party and is written in German', () => {
    for (const page of ['impressum.html', 'datenschutz.html', 'agb.html']) {
      expect(read(page)).toContain('<html lang="de">')
    }
    for (const page of ['impressum.html', 'datenschutz.html']) {
      const html = read(page)
      expect(html).toContain('Wolodymyr Pawlyshyn')
      expect(html).toContain('Franz-Jacob-Straße 1')
      expect(html).toContain('10369 Berlin')
      expect(html).toContain('pavlyshyn@gmail.com')
    }
  })

  it('cites the statutes that are actually in force', () => {
    const impressum = read('impressum.html')
    // The TMG was replaced by the DDG in May 2024, and the EU ODR platform closed in
    // July 2025. Boilerplate that still cites either is out of date.
    expect(impressum).toContain('§ 5 Digitale-Dienste-Gesetz')
    expect(impressum).not.toMatch(/§\s*5\s*TMG/)
    expect(impressum).not.toMatch(/ec\.europa\.eu\/consumers\/odr/)
  })
})
