#!/usr/bin/env node
/**
 * Renders `article/*.md` into the blog section of the documentation site.
 *
 * The site itself still has no build step: GitHub Pages serves `docs/` verbatim, and this
 * generator's output is committed beside the hand-written pages, on the same footing as the
 * PNG exports beside the diagrams. A broken toolchain therefore cannot take the blog down —
 * it can only stop the next post from being rendered.
 *
 * `buildBlog()` returns the files rather than writing them, so a test can assert that what
 * is committed is what the articles currently render to. Running the script writes them.
 *
 *   node scripts/build-blog.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import MarkdownIt from 'markdown-it'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARTICLES = join(ROOT, 'article')
const DOCS = join(ROOT, 'docs')
const BLOG_DIR = 'blog'

/** The canonical origin, from `docs/CNAME`. Only used for absolute Open Graph image URLs. */
const ORIGIN = `https://${readFileSync(join(DOCS, 'CNAME'), 'utf8').trim()}`

/** Words per minute, for the reading estimate on the index. */
const WPM = 200

// ---------------------------------------------------------------------------- chrome

/** Every page of the site, in nav order. `blog` is matched on prefix so a post highlights it. */
const NAV = [
  ['index.html', 'Overview'],
  ['getting-started.html', 'Getting started'],
  ['examples.html', 'Examples'],
  ['model-format.html', 'Model format'],
  ['targets.html', 'Targets'],
  ['cli.html', 'CLI'],
  ['architecture.html', 'Architecture'],
  ['blog/index.html', 'Blog'],
]

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Nav for a page one directory below `docs/`, with `Blog` marked current. */
function nav(current) {
  const links = NAV.map(([href, label]) => {
    const active = href.startsWith(BLOG_DIR + '/') && current === 'blog'
    return `      <a href="../${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`
  })
  links.push('      <a href="https://github.com/Volland/lpg-modeler">GitHub</a>')
  return links.join('\n')
}

function page({ title, description, ogTitle, ogImage, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${esc(ogImage)}">
<link rel="icon" href="../assets/icon.png">
<link rel="stylesheet" href="../assets/fonts.css">
<link rel="stylesheet" href="../assets/site.css">
</head>
<body>

<header class="top">
  <div class="wrap">
    <a class="brand" href="../index.html"><img src="../assets/icon.png" alt=""> LPG Modeler</a>
    <nav class="links">
${nav('blog')}
    </nav>
  </div>
</header>

<main>

${body}
</main>

<footer class="site">
  <div class="wrap">
    <span>LPG Modeler — MIT licensed</span>
    <span class="spacer"><a href="../impressum.html">Impressum</a></span>
    <span><a href="../datenschutz.html">Datenschutz</a></span>
    <span><a href="../agb.html">AGB</a></span>
    <span><a href="https://github.com/Volland/lpg-modeler">Source</a></span>
    <span><a href="https://github.com/Volland/lpg-modeler/issues">Issues</a></span>
  </div>
</footer>

</body>
</html>
`
}

// ---------------------------------------------------------------------------- markdown

/**
 * Languages in which a line beginning `#` or `//` is a comment. An unlabelled fence is
 * included because most of them hold generator output, which is where the comments matter.
 */
const COMMENT_LANGS = new Set(['', 'yaml', 'yml', 'turtle', 'ttl', 'cypher', 'sql', 'bash', 'sh'])

/**
 * The prefixes the emitters use to report, in the generated file itself, what a target could
 * not carry. Ambering them here is the same treatment the front page gives them by hand.
 */
const LOSS = /\b(UNENFORCED|DOWNGRADE|UNSTORABLE|SYNTHESIZED):/

/**
 * Comment lines only, which is all the site's own pages mark up by hand. Anything cleverer
 * would need a real grammar per language to avoid dimming a string that contains a `#`.
 */
function highlight(code, lang) {
  const escaped = esc(code.replace(/\n+$/, ''))
  if (!COMMENT_LANGS.has(lang)) return escaped
  return escaped
    .split('\n')
    .map((line) => {
      const trimmed = line.trimStart()
      if (!trimmed.startsWith('#') && !trimmed.startsWith('//')) return line
      return `<span class="${LOSS.test(line) ? 'c-warn' : 'c-com'}">${line}</span>`
    })
    .join('\n')
}

/**
 * Rewrites a path written for the repository into one that resolves from `docs/blog/`.
 * Asset paths are repointed at the site's single copy; a model file an article is built
 * around is copied in beside the post, since `docs/` has to stand on its own.
 */
function rewriteHref(href, slugs, models) {
  if (!href || /^(https?:|mailto:|#)/.test(href)) return href
  if (href.startsWith('../docs/')) return '../' + href.slice('../docs/'.length)
  if (href.endsWith('.lpg.yaml')) {
    const file = basename(href)
    models.add(file)
    return `models/${file}`
  }
  if (href.endsWith('.md')) {
    // An article the manifest does not publish is still worth linking, just not here.
    const name = basename(href, '.md')
    if (slugs.has(name)) return `${name}.html`
    return `https://github.com/Volland/lpg-modeler/blob/main/article/${basename(href)}`
  }
  return href
}

/** A heading id: lowercase, words joined by hyphens, suffixed if the title repeats. */
function slug(text, seen) {
  const base =
    text
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  let id = base
  for (let n = 2; seen.has(id); n++) id = `${base}-${n}`
  seen.add(id)
  return id
}

function renderer(slugs, models) {
  const md = MarkdownIt({ html: false, linkify: false, typographer: false })

  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]
    const lang = (token.info || '').trim().split(/\s+/)[0]
    return `<pre><code>${highlight(token.content, lang)}</code></pre>\n`
  }

  // A long read is quoted section by section, so every heading is addressable. The `#`
  // beside it appears on hover: an anchor nobody can see is an anchor nobody uses.
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const level = Number(tokens[idx].tag.slice(1))
    if (level > 3) return self.renderToken(tokens, idx, options)
    const text = tokens[idx + 1]?.content ?? ''
    const id = slug(text, env.ids)
    tokens[idx].attrSet('id', id)
    env.lastId = id
    return self.renderToken(tokens, idx, options)
  }
  md.renderer.rules.heading_close = (tokens, idx, options, env, self) => {
    const level = Number(tokens[idx].tag.slice(1))
    if (level > 3) return self.renderToken(tokens, idx, options)
    const id = env.lastId
    return `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` +
      self.renderToken(tokens, idx, options)
  }

  // A table on this site scrolls rather than squeezing, because the narrow column would
  // otherwise wrap a capability cell into unreadability on a phone.
  md.renderer.rules.table_open = () => '<div class="table-scroll">\n<table>\n'
  md.renderer.rules.table_close = () => '</table>\n</div>\n'

  // The alt text in these articles is written as a caption, so it becomes one. `alt` is
  // then left empty deliberately: a screen reader that announced both would read it twice.
  md.renderer.rules.image = (tokens, idx) => {
    const token = tokens[idx]
    const src = rewriteHref(token.attrGet('src'), slugs, models)
    const cls = src.includes('/screenshots/') ? ' class="shot"' : ''
    return `<img src="${esc(src)}"${cls} alt="" data-caption="${esc(token.content)}">`
  }

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const href = rewriteHref(token.attrGet('href'), slugs, models)
    token.attrSet('href', href)
    if (/^https?:/.test(href)) token.attrSet('rel', 'noopener')
    return self.renderToken(tokens, idx, options)
  }

  return md
}

/** Splits `# title`, `### subtitle` and the rule beneath them off the body. */
function frontMatter(markdown) {
  const lines = markdown.split('\n')
  const titleAt = lines.findIndex((l) => /^# \S/.test(l))
  if (titleAt < 0) throw new Error('no `# title` heading')
  const subtitleAt = lines.findIndex((l, i) => i > titleAt && /^### \S/.test(l))
  if (subtitleAt < 0) throw new Error('no `### subtitle` line beneath the title')
  const ruleAt = lines.findIndex((l, i) => i > subtitleAt && l.trim() === '---')
  if (ruleAt < 0) throw new Error('no `---` rule beneath the subtitle')
  return {
    title: lines[titleAt].slice(2).trim(),
    subtitle: lines[subtitleAt].slice(4).trim(),
    body: lines.slice(ruleAt + 1).join('\n').trim(),
  }
}

/** Markdown emphasis stripped, for a `<meta>` value that cannot carry it. */
const plain = (s) => s.replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/`([^`]+)`/g, '$1')

const readingMinutes = (markdown) =>
  Math.max(1, Math.round(markdown.split(/\s+/).filter(Boolean).length / WPM))

const formatDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })

// ---------------------------------------------------------------------------- build

/**
 * Renders every published post plus the index, returning `docs/`-relative paths mapped to
 * their contents, and the model files that have to be copied in beside them.
 */
export function buildBlog() {
  const manifest = JSON.parse(readFileSync(join(ARTICLES, 'posts.json'), 'utf8'))
  const slugs = new Set(manifest.posts.map((p) => p.slug))
  const files = new Map()
  const models = new Set()
  const cards = []

  for (const post of manifest.posts) {
    const markdown = readFileSync(join(ARTICLES, post.source), 'utf8')
    let meta
    try {
      meta = frontMatter(markdown)
    } catch (err) {
      throw new Error(`article/${post.source}: ${err.message}`)
    }

    const md = renderer(slugs, models)
    let body = md.render(meta.body, { ids: new Set() })

    // A paragraph holding nothing but an image is a figure; anything else keeps its alt.
    body = body.replace(
      /<p>(<img [^>]*?)\s*data-caption="([^"]*)"([^>]*>)<\/p>/g,
      (_, head, caption, tail) => `<figure>${head}${tail}<figcaption>${caption}</figcaption></figure>`,
    )
    body = body.replace(/<img ([^>]*?)alt=""\s*data-caption="([^"]*)"([^>]*)>/g, '<img $1alt="$2"$3>')

    const firstImage = body.match(/<img src="([^"]+)"/)
    const ogImage = firstImage
      ? `${ORIGIN}/${firstImage[1].replace(/^\.\.\//, '')}`
      : `${ORIGIN}/assets/diagrams/pipeline.png`

    const minutes = readingMinutes(meta.body)
    const description = plain(meta.subtitle)

    files.set(
      `${BLOG_DIR}/${post.slug}.html`,
      page({
        title: `${plain(meta.title)} — LPG Modeler`,
        description,
        ogTitle: plain(meta.title),
        ogImage,
        body: `<div class="wrap post-head">
  <a class="back" href="index.html">← Blog</a>
  <h1>${md.renderInline(meta.title)}</h1>
  <p class="lede">${md.renderInline(meta.subtitle)}</p>
  <p class="post-meta"><time datetime="${post.date}">${formatDate(post.date)}</time> · ${minutes} min read</p>
</div>

<hr class="rule">

<div class="wrap">
  <article class="post">
${body.trimEnd()}
  </article>

  <p class="post-source">
    This post is <a href="https://github.com/Volland/lpg-modeler/blob/main/article/${post.source}" rel="noopener"><code>article/${post.source}</code></a>
    in the repository, so a correction to the tool and a correction to the post travel together.
  </p>

  <div class="next">
    <a href="index.html"><div class="k">All posts</div><div class="v">Everything written about the tool, longest first.</div></a>
    <a href="../getting-started.html"><div class="k">Getting started</div><div class="v">Install, write your first model, open the canvas, generate.</div></a>
  </div>
</div>
`,
      }),
    )

    cards.push({
      slug: post.slug,
      date: post.date,
      minutes,
      title: md.renderInline(meta.title),
      subtitle: md.renderInline(meta.subtitle),
    })
  }

  const list = cards
    .map(
      (c) => `    <a class="post-card" href="${c.slug}.html">
      <div class="meta"><time datetime="${c.date}">${formatDate(c.date)}</time> · ${c.minutes} min read</div>
      <div class="k">${c.title}</div>
      <div class="v">${c.subtitle}</div>
    </a>`,
    )
    .join('\n')

  files.set(
    `${BLOG_DIR}/index.html`,
    page({
      title: 'Blog — LPG Modeler',
      description:
        'Long-form writing about modelling property graphs: frames and slots, conceptual graphs, and why the choice between RDF and a property graph is a compilation target rather than a commitment.',
      ogTitle: 'LPG Modeler — Blog',
      ogImage: `${ORIGIN}/assets/diagrams/pipeline.png`,
      body: `<div class="wrap hero">
  <span class="eyebrow">Blog</span>
  <h1>Long reads about modelling, and what they compile to.</h1>
  <p class="lede">
    Each post is a worked model rather than an overview: every generated excerpt is pasted
    from a real run, and every count in it is countable from the model beside it. They live
    in the repository with the tool, so a claim that stops being true shows up as a diff.
  </p>
</div>

<hr class="rule">

<section class="wrap">
  <div class="posts">
${list}
  </div>
</section>
`,
    }),
  )

  return { files, models: [...models].sort() }
}

// ---------------------------------------------------------------------------- main

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const { files, models } = buildBlog()
  const dir = join(DOCS, BLOG_DIR)

  // Rewritten wholesale, so a post removed from the manifest leaves no orphan page behind.
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'models'), { recursive: true })

  for (const [rel, html] of files) writeFileSync(join(DOCS, rel), html)
  for (const model of models) {
    writeFileSync(join(dir, 'models', model), readFileSync(join(ARTICLES, model), 'utf8'))
  }

  const written = readdirSync(dir).filter((f) => f.endsWith('.html')).length
  console.log(`docs/${BLOG_DIR}: ${written} pages, ${models.length} model files`)
}
