import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative, sep } from 'node:path'

const ROOT = resolve(__dirname, '..', '..', '..')
const DOCS = join(ROOT, 'docs')

/**
 * Every page of the site, as a `docs/`-relative path. The walk is recursive because the
 * blog lives a directory down, and a page that escaped these checks by being nested is
 * exactly the page that would quietly break one of them.
 */
const pages = (): string[] => {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.html')) out.push(relative(DOCS, full).split(sep).join('/'))
    }
  }
  walk(DOCS)
  return out.sort()
}

const read = (f: string) => readFileSync(join(DOCS, f), 'utf8')

/** How many `../` a page needs to reach the site root. */
const upTo = (page: string) => '../'.repeat(page.split('/').length - 1)

/**
 * Hosts a page may link to. A link is a navigation the reader chooses; what matters
 * for the privacy statement is what the browser fetches on its own. Outbound links are
 * covered by the "Haftung für Links" section of the Impressum.
 */
const LINKABLE = [
  'github.com',
  'docs.github.com',
  'www.datenschutz-berlin.de',
  'ai.plainenglish.io',
]

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

/** Every local `src`/`href` a page points at, resolved against the page's own directory. */
const localRefs = (attr: 'src' | 'href') => {
  const out: { page: string; url: string; target: string }[] = []
  for (const page of pages()) {
    const pattern = new RegExp(`<(?:link|script|img|iframe|source|a)\\b[^>]*?${attr}="([^"]+)"`, 'g')
    for (const m of read(page).matchAll(pattern)) {
      const url = m[1]!
      if (/^(https?:|mailto:|#)/.test(url)) continue
      out.push({ page, url, target: resolve(dirname(join(DOCS, page)), url) })
    }
  }
  return out
}

// @lat: [[architecture#Distribution#Documentation site#Screenshots]]
describe('the site shows the canvas, and shows a model it still ships', () => {
  it('resolves every image it renders', () => {
    // A missing image degrades to alt text rather than to an error, so nothing but a
    // test notices it. Covers the diagrams as well as the screenshots.
    const missing = localRefs('src')
      .filter(({ target }) => !existsSync(target))
      .map(({ page, url }) => `${page}: ${url}`)
    expect(missing).toEqual([])
  })

  it('keeps every relative path inside the published folder', () => {
    // A `../` too many resolves outside `docs/`, which works locally and 404s once Pages
    // has published the folder on its own.
    const escaped = [...localRefs('src'), ...localRefs('href')]
      .filter(({ target }) => !target.startsWith(DOCS + sep))
      .map(({ page, url }) => `${page}: ${url}`)
    expect(escaped).toEqual([])
  })

  it('renders every screenshot it carries', () => {
    // The other direction: an image nothing references is a file that stopped being
    // shown, which is how a page quietly loses the picture it was built around.
    const shots = readdirSync(join(DOCS, 'assets', 'screenshots'))
    expect(shots.length).toBeGreaterThan(0)
    const html = pages().map(read).join('\n')
    expect(shots.filter((f) => !html.includes(`assets/screenshots/${f}`))).toEqual([])
  })

  it('offers for download every example model it names', () => {
    // The screenshots are captured from a published example, and the captions say so.
    // The promise only holds while that file is still there to download.
    const named = localRefs('href').filter(({ url }) => url.endsWith('.lpg.yaml'))
    expect(named.length).toBeGreaterThan(0)
    const missing = named
      .filter(({ target }) => !existsSync(target))
      .map(({ page, url }) => `${page}: ${url}`)
    expect(missing).toEqual([])
  })
})

// @lat: [[architecture#Distribution#Legal pages]]
describe('legal pages', () => {
  it('is reachable from every page, which is what an Impressum has to be', () => {
    for (const page of pages()) {
      const html = read(page)
      for (const target of ['impressum.html', 'datenschutz.html', 'agb.html']) {
        expect(html.includes(`href="${upTo(page)}${target}"`)).toBe(true)
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

// @lat: [[architecture#Distribution#Documentation site#Blog]]
describe('the blog is the articles, rendered', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'article', 'posts.json'), 'utf8')) as {
    posts: { slug: string; source: string; date: string }[]
  }

  /** The generator, imported rather than run, so a mismatch is a diff rather than a rebuild. */
  const build = async () => {
    const mod = (await import(join(ROOT, 'scripts', 'build-blog.mjs'))) as {
      buildBlog: () => { files: Map<string, string>; models: string[] }
    }
    return mod.buildBlog()
  }

  it('is committed in the state the articles currently render to', async () => {
    // The site has no build step: Pages serves `docs/` verbatim, so what is committed is
    // what is served. An article edited without regenerating would otherwise publish the
    // previous version indefinitely.
    const { files } = await build()
    const stale: string[] = []
    for (const [rel, html] of files) {
      if (!existsSync(join(DOCS, rel)) || read(rel) !== html) stale.push(rel)
    }
    expect(stale, 'run `npm run build:blog`').toEqual([])
  })

  it('publishes exactly the articles the manifest names', () => {
    const published = pages()
      .filter((p) => p.startsWith('blog/') && p !== 'blog/index.html')
      .map((p) => p.slice('blog/'.length, -'.html'.length))
      .sort()
    expect(published).toEqual(manifest.posts.map((p) => p.slug).sort())
  })

  it('carries every post on the index, and every source beside it', () => {
    const index = read('blog/index.html')
    for (const post of manifest.posts) {
      expect(index).toContain(`href="${post.slug}.html"`)
      expect(existsSync(join(ROOT, 'article', post.source))).toBe(true)
    }
  })

  it('ships the model an article is built around', async () => {
    // An article's model lives in `article/`, not `docs/examples/`, so the post links to
    // a copy. The copy is generated, and has to still match the source it was taken from.
    const { models } = await build()
    expect(models.length).toBeGreaterThan(0)
    for (const model of models) {
      const copy = join(DOCS, 'blog', 'models', model)
      expect(existsSync(copy)).toBe(true)
      expect(readFileSync(copy, 'utf8')).toBe(readFileSync(join(ROOT, 'article', model), 'utf8'))
    }
  })

  it('is reachable from every page of the site', () => {
    // A section nothing links to is a section nobody reads.
    for (const page of pages()) {
      expect(read(page)).toContain(`href="${upTo(page)}blog/index.html"`)
    }
  })
})
