/**
 * The canvas palette: twelve color tokens, four built-in presets, and how a theme and a
 * user's overrides combine. No `vscode` import, so the host and the tests share it.
 * See lat.md/architecture#Rendering#Canvas Theme.
 */

export const COLOR_TOKENS = [
  'background', 'foreground', 'muted', 'border', 'accent', 'box', 'boxHeader',
  'edge', 'grid', 'nodeKind', 'edgeKind', 'mixinKind',
] as const
export type ColorToken = (typeof COLOR_TOKENS)[number]
export type Palette = Record<ColorToken, string>

export const THEME_NAMES = ['auto', 'solarizedLight', 'solarizedDark', 'black', 'white'] as const
export type ThemeName = (typeof THEME_NAMES)[number]

export const THEME_LABELS: Record<ThemeName, string> = {
  auto: 'Follow VS Code',
  solarizedLight: 'Solarized Light',
  solarizedDark: 'Solarized Dark',
  black: 'Black',
  white: 'White',
}

/** The CSS custom property each token sets on the canvas. */
export const CSS_VARIABLE: Record<ColorToken, string> = {
  background: '--bg',
  foreground: '--fg',
  muted: '--muted',
  border: '--line',
  accent: '--accent',
  box: '--box',
  boxHeader: '--box-head',
  edge: '--edge',
  grid: '--grid',
  nodeKind: '--kind-node',
  edgeKind: '--kind-edge',
  mixinKind: '--kind-mixin',
}

export const TOKEN_LABELS: Record<ColorToken, string> = {
  background: 'Background',
  foreground: 'Text',
  muted: 'Secondary text',
  border: 'Borders',
  accent: 'Accent',
  box: 'Type box',
  boxHeader: 'Type box header',
  edge: 'Edge lines',
  grid: 'Grid dots',
  nodeKind: 'Node type heading',
  edgeKind: 'Edge type heading',
  mixinKind: 'Mixin heading',
}

/**
 * The Solarized presets keep Solarized's base tones and accent hues, but take text from
 * the high-contrast end of the scale and shift accents until they read: stock Solarized
 * puts body text near 4.9:1 and blue near 3.3:1, which is the complaint these answer.
 */
export const PRESETS: Record<Exclude<ThemeName, 'auto'>, Palette> = {
  solarizedLight: {
    background: '#fdf6e3', foreground: '#073642', muted: '#4a5d63', border: '#6f8589',
    accent: '#1a5e8f', box: '#eee8d5', boxHeader: '#e8e1cb', edge: '#657b83', grid: '#d6ceb5',
    nodeKind: '#1f6fa8', edgeKind: '#a93c0f', mixinKind: '#5b5fae',
  },
  solarizedDark: {
    background: '#002b36', foreground: '#eee8d5', muted: '#a9b6b6', border: '#6c8a92',
    accent: '#62b3f0', box: '#073642', boxHeader: '#0a3f4c', edge: '#93a1a1', grid: '#1a4a56',
    nodeKind: '#4aa3e8', edgeKind: '#e8743c', mixinKind: '#a3a7f0',
  },
  black: {
    background: '#000000', foreground: '#ffffff', muted: '#b8b8b8', border: '#8c8c8c',
    accent: '#5cabff', box: '#0f0f0f', boxHeader: '#242424', edge: '#c8c8c8', grid: '#333333',
    nodeKind: '#6cb6ff', edgeKind: '#ffa657', mixinKind: '#d2a8ff',
  },
  white: {
    background: '#ffffff', foreground: '#000000', muted: '#4a4a4a', border: '#6e6e6e',
    accent: '#0050b3', box: '#fafafa', boxHeader: '#e8e8e8', edge: '#3d3d3d', grid: '#c4c4c4',
    nodeKind: '#0b5fa5', edgeKind: '#a34800', mixinKind: '#7030b0',
  },
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX.test(v.trim())

export const isThemeName = (v: unknown): v is ThemeName =>
  typeof v === 'string' && (THEME_NAMES as readonly string[]).includes(v)

/**
 * The colors a canvas should set. A preset fills every token; `auto` fills only what the
 * user overrode and leaves the rest to the stylesheet, which derives them from the
 * editor's own background and foreground. A value that is not a hex color is dropped, so
 * a half-typed setting never reaches CSS.
 */
export function resolveTheme(
  theme: unknown, overrides: Partial<Record<ColorToken, unknown>>,
): { theme: ThemeName; colors: Partial<Palette>; overridden: ColorToken[] } {
  const name = isThemeName(theme) ? theme : 'auto'
  const colors: Partial<Palette> = name === 'auto' ? {} : { ...PRESETS[name] }
  const overridden: ColorToken[] = []
  for (const token of COLOR_TOKENS) {
    const value = overrides[token]
    if (!isHexColor(value)) continue
    colors[token] = value.trim().toLowerCase()
    overridden.push(token)
  }
  return { theme: name, colors, overridden }
}

function channels(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 contrast ratio between two hex colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
