# Design

The metamodel and the IR do not change; lockfile, diffing and rename detection are untouched. Work lands in `core` (`emit/context.ts`); no `vscode` import. Depends on `lat.md/emitters#Emitters#Capability Matrix` and `lat.md/metamodel#Metamodel`.

## Capability set

Every capability is declared carried: the artifact is writing, not enforcement, and it loses nothing — the same reading under which the SHACL target declares constraints carried. `rawPassthrough` is true: a raw fragment is included verbatim under the type that declares it.

## Decisions

### 1. One line per element

A node type is one bullet: name, `(abstract)`/`(open)` marks, `< Parent`, `+Mixin` chips, key, then properties inline as `name: type` with `!` for required, `^` for unique, bounds in brackets and the enum by name. The legend at the top of the card defines the marks once, so the lines themselves stay short. Constraints are a sub-line in words (`lifespan: birthDate lessThan deathDate`). The format optimises tokens over looks; the `docs` target is the one for humans.

### 2. Model order, not alphabetical

Elements appear in model order, like the generated DDL, so the card diffs minimally when the model file changes and reads in the order the author chose.

### 3. Header states what the card is

The first lines name the model, the namespace, the generator, and that the card describes the schema rather than enforcing it — the one piece of framing an LLM consumer needs.

## Verification

A golden file pins the social fixture. Unit tests assert determinism (two emits are byte-identical) and completeness (every type, property, enum value and constraint name in the IR appears in the card).
