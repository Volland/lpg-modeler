## ADDED Requirements

### Requirement: TypeScript target generates compiling type declarations

The system SHALL provide a `typescript` target that generates, for the **typescript** target, a single self-contained `.ts` artifact: one `interface` per node type, mixin and edge type, one string-literal union type per enum, and named type aliases for the scalars drivers disagree on (`decimal`, `date`, `datetime`, `zoneddatetime`, `duration`). The artifact SHALL import nothing and SHALL type-check under `strict` TypeScript.

#### Scenario: Hierarchy and mixins become extends

- **WHEN** a model declares `Person extends Party` with mixin `Timestamped`
- **THEN** the artifact declares `interface Person extends Party, Timestamped` carrying only the properties `Person` itself declares

#### Scenario: Required and optional properties

- **WHEN** a node type declares a required property and an optional one
- **THEN** the required property is a plain member and the optional one is marked `?`

#### Scenario: Enum property compiles to a union

- **WHEN** a property is limited to enum `Status` with values `active` and `retired`
- **THEN** the artifact declares `type Status = 'active' | 'retired'` and the property's type is `Status`

#### Scenario: Composite types are carried natively

- **WHEN** a property's type is `STRUCT(street STRING, zip STRING)`
- **THEN** the member's type is an object type with those fields, and no downgrade is reported for it

#### Scenario: Open type gains an index signature

- **WHEN** a node type is declared open
- **THEN** its interface carries a `[key: string]: unknown` index signature

### Requirement: TypeScript target carries runtime facts in a SCHEMA const

The artifact SHALL export a `SCHEMA` const, `as const`, holding for every node type its labels (own name plus ancestors), its key and whether it is abstract, and for every edge type its endpoints and cardinality.

#### Scenario: Labels and key in the manifest

- **WHEN** `Person extends Party` declares key `email`
- **THEN** `SCHEMA.nodes.Person` holds `labels: ['Person', 'Party']` and `key: ['email']`

#### Scenario: Edge endpoints in the manifest

- **WHEN** an edge type `DRIVES` runs from `Person` to `Car` with many-to-many cardinality
- **THEN** `SCHEMA.edges.DRIVES` holds `from: 'Person'`, `to: 'Car'` and the cardinality's name

### Requirement: TypeScript target reports what a type cannot enforce

For the **typescript** target, uniqueness, value bounds, patterns, length bounds and named constraints SHALL be written as JSDoc at the member or interface they belong to and reported as downgrade diagnostics. They SHALL NOT be silently dropped.

#### Scenario: Unique property

- **WHEN** a non-key property is declared unique
- **THEN** its member carries a JSDoc note naming the uniqueness and a downgrade diagnostic is reported

#### Scenario: Value bounds

- **WHEN** a property declares `min` and `max`
- **THEN** the bounds appear in the member's JSDoc and a `downgrade-value-constraint` diagnostic is reported
