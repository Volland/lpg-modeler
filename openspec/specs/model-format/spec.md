## Purpose

Defines the LPG model file: what a model may declare, how models compose, and how a
model resolves into the intermediate representation that every diagram and every
generated artifact is derived from.

## Requirements

### Requirement: Model file structure

A model SHALL be a YAML file declaring a namespace, optional imports, node types, and
edge types. The system SHALL publish a JSON Schema for model files so that structural
errors are reported in the editor without invoking the modeler.

#### Scenario: Structural error in a model file

- **WHEN** a model file declares a node type whose `props` value is a string
- **THEN** the editor reports a structural error on that line
- **AND** the modeler reports the same file as invalid rather than rendering it

#### Scenario: Namespace is required

- **WHEN** a model file omits its namespace declaration
- **THEN** validation reports an error identifying the file
- **AND** no artifact is generated for that model

### Requirement: Node types, hierarchy, and mixins

A node type SHALL declare properties and MAY declare an abstract parent and any number
of mixins. An abstract node type SHALL NOT be instantiable and SHALL contribute its
properties and its key to every descendant.

#### Scenario: Inherited properties resolve onto a subtype

- **WHEN** an abstract node type declares a property and a subtype declares another
- **THEN** the resolved subtype carries both properties
- **AND** the diagram shows the inherited property marked as inherited

#### Scenario: Cyclic inheritance

- **WHEN** two node types declare each other as parent
- **THEN** validation reports a cyclic-inheritance error naming both types
- **AND** resolution still returns a model so the remaining types stay visible

### Requirement: Identity

Every concrete node type SHALL have exactly one key, declared on itself or inherited
from an abstract parent. A key MAY name one or more properties.

#### Scenario: Missing key

- **WHEN** a concrete node type has no key on itself or any ancestor
- **THEN** validation reports an error on that node type
- **AND** generation for the `ladybug` target does not produce a table for it

#### Scenario: Key names an undeclared property

- **WHEN** a key names a property that the node type does not declare or inherit
- **THEN** validation reports an error naming the key and the missing property

### Requirement: Stable element identifiers

Every node type, edge type, and property SHALL carry a stable identifier that the
system assigns when absent and never changes thereafter. Identifiers SHALL be unique
within a model.

#### Scenario: Identifier is assigned on first save

- **WHEN** a model file contains a node type with no identifier and the model is saved
- **THEN** the file gains a generated identifier for that node type
- **AND** no other part of the file is reformatted

#### Scenario: Duplicate identifier after copy and paste

- **WHEN** two node types in one model carry the same identifier
- **THEN** validation reports a duplicate-identifier error naming both types

### Requirement: Sealed composition

A model MAY import another model under a local alias and MAY subtype an imported node
type, apply a mixin to its own types, or declare an edge type whose endpoint is an
imported type. A model SHALL NOT modify an imported definition.

#### Scenario: Subtyping an imported type

- **WHEN** a model imports another and declares a node type extending an imported type
- **THEN** the resolved type carries the imported type's properties and key

#### Scenario: Attempting to modify an imported type

- **WHEN** a model declares a node type whose name matches an imported type
- **THEN** validation reports an error stating imported definitions are sealed

#### Scenario: Same vocabulary imported by two paths

- **WHEN** one model transitively imports the same namespace through two different file
  paths
- **THEN** the two are resolved as one type rather than reported as a conflict

### Requirement: Namespaces determine global identity

A model's namespace SHALL consist of a prefix and a base IRI. Every type a model
declares SHALL have a global identity formed from that base IRI and its type name.
Import aliases SHALL be local bindings only.

#### Scenario: Two models declaring the same type name

- **WHEN** two models with different namespaces each declare a node type named `Party`
- **THEN** the two are distinct types
- **AND** each generated ontology term carries its own model's base IRI

### Requirement: Resolution is total

Resolution SHALL always return an intermediate representation together with a list of
diagnostics, and SHALL NOT abort on invalid input.

#### Scenario: Model with one broken type

- **WHEN** a model contains one node type with an unresolvable parent and three valid
  types
- **THEN** resolution returns the three valid types and a diagnostic for the broken one
- **AND** the diagram renders the three valid types
