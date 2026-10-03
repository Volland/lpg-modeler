## ADDED Requirements

### Requirement: Context target generates a compact schema card

The system SHALL provide a `context` target that generates, for the **context** target, a deterministic Markdown artifact holding every node type (with hierarchy, mixins, key, abstract and open marks, and every property with its type, requiredness, uniqueness, bounds and enum), every edge type (with endpoints and cardinality), every enum with its values, every mixin, and every named constraint in words. Nothing in the model SHALL be omitted, and no downgrade SHALL be reported.

#### Scenario: A node type is one line

- **WHEN** the card is generated for a model where `Person extends Party` applies mixin `Timestamped`, declares key `email`, and has a unique property
- **THEN** one bullet names `Person`, its parent, its mixin, its key, and the property with a uniqueness mark

#### Scenario: Card is deterministic

- **WHEN** the card is generated twice from the same model
- **THEN** both artifacts are byte-identical

#### Scenario: Everything appears

- **WHEN** the card is generated for a model with enums and named constraints
- **THEN** every enum value and every constraint name in the resolved IR appears in the artifact

#### Scenario: Raw SHACL is carried

- **WHEN** a node type carries a raw SHACL fragment
- **THEN** the fragment appears verbatim under that type and no `downgrade-raw-shacl` diagnostic is reported
