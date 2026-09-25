import * as React from 'react'
import {
  COLOR_TOKENS, CSS_VARIABLE, TOKEN_LABELS,
  type ColorToken, type Palette,
} from '../theme'
import { Modal } from './dialogs'

/**
 * Set the palette on the document element -- the element the stylesheet declares its
 * tokens and their mixes on, so a mix recomputes from an overridden `--fg` or `--bg`.
 * A token the message leaves out falls back to the stylesheet, which under `auto`
 * derives it from the editor theme. See lat.md/architecture#Rendering#Canvas Theme.
 */
export function applyTheme(colors: Partial<Palette>): void {
  const style = document.documentElement.style
  for (const token of COLOR_TOKENS) {
    const value = colors[token]
    if (value) style.setProperty(CSS_VARIABLE[token], value)
    else style.removeProperty(CSS_VARIABLE[token])
  }
}

/**
 * The color a token currently resolves to, as `#rrggbb` for a color picker. Under `auto`
 * it is a VS Code variable or a `color-mix()`, which computed style reports in whatever
 * notation the engine prefers; painting one pixel normalizes every notation.
 */
export function currentHex(token: ColorToken): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(CSS_VARIABLE[token]).trim()
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx || !raw) return '#000000'
  ctx.fillStyle = '#000000'
  ctx.fillStyle = raw
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((c) => (c ?? 0).toString(16).padStart(2, '0')).join('')}`
}

/**
 * A color picker that previews while the user drags and commits once, when the picker
 * closes. React's `onChange` is the native `input` event, which fires on every movement;
 * committing on it would rewrite the settings file dozens of times a second.
 */
function ColorInput(
  { token, value, onCommit }: { token: ColorToken; value: string; onCommit: (v: string) => void },
): React.ReactElement {
  // Keyed on `value` by the caller, so a new color from the host remounts it.
  const ref = React.useRef<HTMLInputElement>(null)
  const commit = React.useRef(onCommit)
  commit.current = onCommit
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const onChange = () => commit.current(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [])
  return (
    <input ref={ref} type="color" defaultValue={value}
      aria-label={TOKEN_LABELS[token]}
      onInput={(e) => document.documentElement.style.setProperty(
        CSS_VARIABLE[token], (e.target as HTMLInputElement).value)} />
  )
}

/**
 * Every token with a picker set to its current color. The choices are written to user
 * settings by the host -- the same settings the Settings UI edits -- and come back as a
 * `theme` message, so the dialog never shows a color the settings do not hold.
 */
export function ColorsDialog(
  { overridden, revision, onSet, onClose }: {
    overridden: ColorToken[]
    /** Bumped on each `theme` message, so the pickers re-read what is now applied. */
    revision: number
    onSet: (token: ColorToken, value: string | undefined) => void
    onClose: () => void
  },
): React.ReactElement {
  const [current, setCurrent] = React.useState<Partial<Palette>>({})
  React.useEffect(() => {
    const next: Partial<Palette> = {}
    for (const t of COLOR_TOKENS) next[t] = currentHex(t)
    setCurrent(next)
  }, [revision])

  return (
    <Modal title="Canvas colors" onCancel={onClose}>
      <p className="modal-text">
        Overrides the theme, one color at a time. Saved to your user settings as
        <code> lpg.canvas.colors.*</code>, so every canvas uses them.
      </p>
      <div className="color-grid">
        {COLOR_TOKENS.map((t) => {
          const isSet = overridden.includes(t)
          return (
            <React.Fragment key={t}>
              <span className={isSet ? 'color-overridden' : undefined}>{TOKEN_LABELS[t]}</span>
              {current[t]
                ? <ColorInput key={current[t]} token={t} value={current[t]} onCommit={(v) => onSet(t, v)} />
                : <span />}
              <code>{current[t] ?? ''}</code>
              <button className="reset" disabled={!isSet}
                title={isSet ? 'Use the theme\'s color' : 'Already the theme\'s color'}
                onClick={() => onSet(t, undefined)}>reset</button>
            </React.Fragment>
          )
        })}
      </div>
      <div className="modal-actions">
        <button disabled={overridden.length === 0}
          onClick={() => { for (const t of overridden) onSet(t, undefined) }}>
          Reset all
        </button>
        <button className="primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  )
}
