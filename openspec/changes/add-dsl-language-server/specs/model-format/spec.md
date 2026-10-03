## ADDED Requirements

### Requirement: A DSL surface round-trips with the YAML form

If a concise `.lpg` surface syntax ships, every model expressible in it SHALL convert losslessly to the YAML form and back, including element ids, and both surfaces SHALL resolve to the same IR. The YAML form SHALL remain fully supported.

#### Scenario: Round trip preserves identity

- **WHEN** a YAML model is converted to the DSL and back
- **THEN** the resulting file resolves to the same IR and every element keeps its element id

#### Scenario: Diagnostics match

- **WHEN** the same mistake is written in both surfaces
- **THEN** both report the same diagnostic code
