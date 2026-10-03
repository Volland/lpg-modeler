## Purpose

Lets a target or a source live outside this repository while keeping the capability rule: nothing is dropped silently, whoever wrote the emitter.

## Requirements

### Requirement: Plugins register through the existing seam

A plugin module SHALL register targets and importers through the same registration shape the built-ins use — a capability set plus an emit function, an importer plus its extensions — and `lpg targets` SHALL mark plugin-provided names. A plugin target's diagnostics SHALL flow through the same reporting as built-in downgrades.

#### Scenario: A plugin target emits

- **WHEN** `lpg --plugin ./my-target.js emit model.lpg.yaml --target mytarget` is run
- **THEN** the artifact is written and any downgrade the plugin reports appears exactly as a built-in target's would

#### Scenario: A plugin without a capability set

- **WHEN** a module registers a target with no capability set
- **THEN** registration is refused with an error naming the contract
