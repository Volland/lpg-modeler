# Design

The metamodel does not change, and neither does the IR, so the lockfile, diffing and rename detection are untouched. All work lands in the `vscode` package; `core` gains nothing and so gains no `vscode` import. Depends on `lat.md/architecture#Rendering`, `lat.md/architecture#Rendering#Exporting the diagram`, `lat.md/architecture#Editing Surface#Inspector` and `lat.md/architecture#Source of Truth`.

## 1. Tokens

The stylesheet stops reading `--vscode-*` colors directly. Every color it uses is one of twelve tokens, or derived from them:

| Token (setting) | CSS variable | Drawn as |
| --- | --- | --- |
| `background` | `--bg` | canvas, panels, dialogs |
| `foreground` | `--fg` | primary text |
| `muted` | `--muted` | secondary text: types, badges, hints |
| `border` | `--line` | box borders, separators, control borders |
| `accent` | `--accent` | flags, handles, links, primary button |
| `box` | `--box` | box body |
| `boxHeader` | `--box-head` | box title bar |
| `edge` | `--edge` | edge strokes |
| `grid` | `--grid` | canvas dots |
| `nodeKind`, `edgeKind`, `mixinKind` | `--kind-node`, `--kind-edge`, `--kind-mixin` | inspector heading per selection kind |

Controls (buttons, inputs, selects, hover rows, error and warning banners) are derived with `color-mix()` from `--fg`, `--bg` and `--accent`, so a preset or an override recolors them without a thirteenth setting. React Flow's own variables (edge stroke and label, controls, background pattern, handles) are pointed at the tokens, so nothing on the canvas keeps a library default.

## 2. `auto`

`auto` takes `--bg` from `editor.background` and `--fg` from `editor.foreground`, and derives the rest by mixing the two: border at 45% foreground, edge at 65%, muted at 72%, box fill at 5%, box header at 12%, grid at 22%. Accent is `textLink.foreground`, which themes design to be read as text, rather than `focusBorder`, which they design as a thin highlight. The kinds keep `charts.blue/orange/purple`.

Mixing guarantees distance from the background for any theme whose foreground reads against its background, which is the one thing every theme guarantees. Borrowing `panel.border` or `editorWidget.background` guarantees nothing, which is the bug.

A custom property holding `color-mix(var(--fg) …)` is computed where it is declared, not where it is used. Overrides are therefore set on the document element — the same element the derived tokens are declared on — so overriding `foreground` alone re-derives everything mixed from it. The print-safe `.export-light` class, applied to a descendant, has to pin every token explicitly for the same reason.

## 3. Presets

Each preset is a full twelve-token palette in `vscode/src/theme.ts`, a module with no `vscode` import. The Solarized presets keep Solarized's base tones and accent hues but take foreground from the high-contrast end of the scale (`base02` on light, `base2` on dark) and darken or lighten accents until they clear 4.5:1: stock Solarized puts body text at about 4.9:1 and blue at 3.3:1, which is the complaint this change answers. A unit test computes WCAG contrast for every pair the spec names over every preset.

## 4. Settings as the single store

`lpg.canvas.theme` and twelve `lpg.canvas.colors.<token>` string settings, each with a hex `pattern` so the Settings UI validates as the user types. Twelve flat settings rather than one object: an object setting in the Settings UI is only an "Edit in settings.json" link, which is exactly the text editing the user asked not to need.

The host resolves theme plus overrides into a token map (a preset fills all twelve; `auto` fills only what is overridden) and posts a `theme` message on `ready` and on every `onDidChangeConfiguration` touching `lpg.canvas`. A malformed value is dropped in resolution, so a half-typed hex never reaches CSS.

The toolbar picker and the colors dialog post `setTheme` / `setColor` intents; the host writes them with `ConfigurationTarget.Global` and the configuration event sends the new palette back, so the canvas never styles itself ahead of the setting it claims to reflect. The dialog's pickers need hex; under `auto` the current color of an unoverridden token is read from the computed style and converted by painting one pixel onto a canvas.

## 5. The key in the inspector

The inspector's node section gains a key list: one checkbox per property the type has (declared or inherited, since a key may name either), ticked when the property is in the key. A change emits the existing `setKey` intent with the ticked names in property order. List and composite properties are shown disabled with the reason, because validation rejects them as key parts. The row toggle on the box stays, now drawn in `--accent` / `--muted`.
