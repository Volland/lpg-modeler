## 1. Palette

- [x] 1.1 `vscode/src/theme.ts`: token list, the four presets, `resolveTheme(name, overrides)` dropping malformed hex, and a WCAG contrast function.
- [x] 1.2 Unit tests: every preset meets every contrast floor in the spec; `auto` yields only overrides; a malformed override is ignored; an override replaces one token of a preset.

## 2. Stylesheet

- [x] 2.1 Rewrite `styles.css` onto the tokens; derive `auto` from `editor.background` / `editor.foreground` with `color-mix`; derive controls and banners; point React Flow's variables at the tokens.
- [x] 2.2 Style the key toggle and every bare button explicitly; extend `.export-light` to pin all twelve tokens.

## 3. Settings and host

- [x] 3.1 Contribute `lpg.canvas.theme` and the twelve `lpg.canvas.colors.*` settings with hex patterns and descriptions.
- [x] 3.2 Host posts `theme` on `ready` and on configuration change; handles `setTheme` / `setColor` by writing user settings.
- [x] 3.3 Stub: configuration store with `update` and `onDidChangeConfiguration`. Tests: theme reaches the canvas on ready and on change; toolbar intents write settings and leave the model file unchanged.

## 4. Webview

- [x] 4.1 Apply the `theme` message to the document element; toolbar theme picker; colors dialog with pickers, per-token reset and reset all.
- [x] 4.2 Inspector key checklist emitting `setKey`; list and composite properties disabled. Test: a composite key set through the intent path lands in the file.

## 5. Documentation

- [x] 5.1 `lat.md/architecture.md`: `Canvas Theme` section under Rendering with `@lat:` refs from the tests; Inspector mentions the key.
- [x] 5.2 README, CHANGELOG, extension README settings table.
- [x] 5.3 `lat check`.
