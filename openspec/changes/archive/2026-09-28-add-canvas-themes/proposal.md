## Why

A user reported that the canvas is unreadable — "light-mode, dark-mode, doesn't matter. Can't see anything" — and that they could not find where a key is set, so they gave up and edited the file by hand.

Both have one cause. The canvas takes its colors straight from VS Code theme variables that were designed for other surfaces: `panel.border` is a faint translucent line, `focusBorder` is a thin highlight, `descriptionForeground` is translucent, and the box background is `editorWidget.background`, which in most themes is within a few percent of the editor background. Boxes, borders and edges therefore dissolve into the canvas. The key toggle on each property row is a button with no color set, so it renders in the browser's default black — invisible on any dark theme. That is the control the user could not find.

A diagram is also a thing people present and screenshot, and "whatever the editor theme is" is not always the palette they want on a projector.

## What Changes

- **Contrast floor for the default.** The default (`auto`) palette still follows the VS Code theme's background and foreground, but derives borders, box fills, edges, grid and secondary text from those two, so every element is drawn at a guaranteed distance from the canvas rather than at whatever a borrowed variable happens to be.
- **Four built-in presets.** Solarized Light, Solarized Dark, Black and White, each meeting the WCAG contrast floors in the spec, independent of the editor theme.
- **Every color overridable.** Twelve color tokens, each a plain setting with a hex value, editable in the Settings UI without touching `settings.json`.
- **Configured from the canvas.** A toolbar theme picker and a colors dialog with a color picker per token write those same settings, so nobody has to know the settings exist.
- **Key in the inspector.** A node type's key is chosen in the inspector with a checkbox per property, which also allows a composite key; the row toggle on the box becomes visible.

## Non-goals

- Theming anything outside the canvas webview.
- Storing colors in the model file or a sidecar. A palette is a viewer's preference, not part of the model.
- Per-model or per-workspace palettes in the canvas UI; the dialog writes user settings. A workspace setting still works if written by hand.
- Changing the print-safe `light` export palette.

## Locked decisions

None touched. Decision 1 is upheld: the palette lives in editor settings, never in the model or the layout sidecar.

## Targets affected

None. No emitter, importer or IR change.

## Capabilities

### Modified Capabilities
- `visual-modeling`: canvas contrast floor, themes, color overrides, key editing in the inspector.

## Impact

- `vscode`: `theme.ts` (presets, contrast), settings contribution, host relays settings to the canvas, webview toolbar and colors dialog, stylesheet rewritten onto tokens, inspector key section.
- `core`: untouched.
- Tests: preset contrast floors, settings reaching the canvas, the canvas writing settings, key intent from the inspector.
- `lat.md/architecture.md`: a `Canvas Theme` section under Rendering; Inspector gains the key.
