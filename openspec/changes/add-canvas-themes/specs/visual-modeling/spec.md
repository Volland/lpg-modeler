## ADDED Requirements

### Requirement: Canvas meets a contrast floor

Every element the canvas draws SHALL be distinguishable from what it is drawn on, under the default palette and under every built-in theme. Measured as WCAG 2.1 contrast ratio: primary text SHALL reach 7:1 against the canvas background, the box fill and the box header; secondary text and accent text SHALL reach 4.5:1 against the same three; box borders SHALL reach 3:1 against the canvas background and the box fill; edge strokes SHALL reach 3:1 against the canvas background. Every control on the canvas, including the key toggle on a property row, SHALL be drawn in a color from the active palette rather than a browser default.

#### Scenario: Built-in theme contrast

- **WHEN** any built-in theme is active
- **THEN** each of its color pairs above meets the stated ratio

#### Scenario: Default palette on a dark editor theme

- **WHEN** no theme is chosen and VS Code uses a dark theme whose panel border is translucent
- **THEN** box borders, edges and secondary text are derived from the editor's foreground and background rather than borrowed from panel or widget colors, and remain visible

#### Scenario: Key toggle is visible

- **WHEN** a node type is shown on the canvas under any palette
- **THEN** the key toggle on each property row is drawn in the palette's colors, not in the browser's default button text color

### Requirement: Built-in canvas themes

The extension SHALL offer a `lpg.canvas.theme` setting with the values `auto`, `solarizedLight`, `solarizedDark`, `black` and `white`. `auto` SHALL follow the VS Code theme's background and foreground. Every other value SHALL fix the canvas palette regardless of the VS Code theme. A change to the setting SHALL reach every open canvas without reopening it.

#### Scenario: Choosing a theme in settings

- **WHEN** a user sets `lpg.canvas.theme` to `solarizedDark` with a canvas open
- **THEN** the open canvas redraws in the Solarized Dark palette

#### Scenario: Theme independent of the editor

- **WHEN** `lpg.canvas.theme` is `white` and VS Code uses a dark theme
- **THEN** the canvas is drawn on a white background with dark text

### Requirement: Canvas colors are user-configurable

The extension SHALL offer one setting per canvas color token under `lpg.canvas.colors.*`: `background`, `foreground`, `muted`, `border`, `accent`, `box`, `boxHeader`, `edge`, `grid`, `nodeKind`, `edgeKind` and `mixinKind`. Each SHALL accept a hex color or be empty. A non-empty value SHALL override that token of the active theme, including `auto`; an empty value SHALL leave the theme's color. A value that is not a hex color SHALL be ignored rather than applied.

#### Scenario: Overriding one color

- **WHEN** a user sets `lpg.canvas.colors.edge` to `#ff0000` under the `black` theme
- **THEN** edges are drawn red and every other color remains the Black palette's

#### Scenario: A malformed value

- **WHEN** a color setting holds `red-ish`
- **THEN** the canvas uses the active theme's color for that token

### Requirement: Themes and colors are set from the canvas

The canvas toolbar SHALL offer a theme picker and a colors dialog. The dialog SHALL show every color token with a color picker set to its current color, SHALL offer a reset per token and a reset of all tokens, and SHALL write the chosen values to the same user settings the Settings UI edits. Neither the model file nor the layout or views sidecar SHALL change when a theme or color is chosen.

#### Scenario: Picking a theme from the toolbar

- **WHEN** a user selects Solarized Light in the canvas toolbar
- **THEN** `lpg.canvas.theme` becomes `solarizedLight` in user settings and the canvas redraws in it
- **AND** the model file is unchanged

#### Scenario: Resetting a color

- **WHEN** a user resets the `border` color in the colors dialog
- **THEN** `lpg.canvas.colors.border` is cleared and the theme's border color returns

### Requirement: Key is chosen in the inspector

The inspector for a node type SHALL list the type's properties with a key checkbox each, reflecting the current key. Checking or clearing a box SHALL set the node type's key to the checked properties in the order they are declared, so a composite key is authored without editing text.

#### Scenario: Setting a composite key

- **WHEN** a user checks `country` and `number` in the inspector for a node type with no key
- **THEN** the node type in the model file declares `key: [country, number]`

#### Scenario: Clearing the key

- **WHEN** a user clears the only checked key property
- **THEN** the node type declares no key and validation reports that a concrete type needs one
