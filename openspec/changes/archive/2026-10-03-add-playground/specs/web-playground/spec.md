## Purpose

Lets a visitor try the modeler in the browser — edit YAML, see the diagram and the generated artifacts — with nothing installed.

## ADDED Requirements

### Requirement: The playground runs core in the browser

The playground page SHALL parse, resolve, validate and emit entirely in the browser, offering every emit-only target, showing diagnostics as the CLI would print them, and loading any published example model. It SHALL fetch no cross-origin subresource, like every other page of the site.

#### Scenario: Editing shows diagnostics live

- **WHEN** a visitor removes a key from a node type
- **THEN** the missing-key error appears without a page reload

#### Scenario: Example round trip

- **WHEN** a visitor loads the fleet example and selects the shacl target
- **THEN** the generated artifact equals what the CLI generates for the same file
