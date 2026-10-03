# Audit

`lpg audit` generates one read-only query per constraint a target leaves unenforced, each returning a `violations` count — the [[emitters#Capability Matrix]] turned into questions the data has to answer. Planned by [[packages/core/src/audit.ts#planAudit]].

Every downgrade the emitters report ends, today, at a diagnostic: LadybugDB cannot enforce a non-key `required`, Community Neo4j cannot enforce existence, nobody enforces an enum or a value bound. Audit is the next sentence — what the engine cannot refuse on write, the tool counts after the fact. A constraint the target genuinely enforces is not audited, because the engine already refused those writes; the selector starts from the target's capability set (and `--edition` for Neo4j) and encodes the per-entity exceptions the emitters already encode, such as Memgraph enforcing node constraints but nothing on relationships. The audit script and the schema artifact therefore tell one story: a constraint is in one or the other, and the matrix says which.

The checks are plain openCypher — `IS NULL` for presence, `NOT … IN` for enums, grouped counts for uniqueness, `OPTIONAL MATCH` plus `count()` for cardinality and edge-count assertions, CASE sums for `atLeastOne` and `exactlyOne`, `UNWIND keys(n)` for closed types on the label engines. Engine differences live in one spelling table per target: `size()` and `=~` are measured on LadybugDB 0.19.1, and a check an engine has no measured spelling for (a pattern or a length on FalkorDB) is an `audit-unsupported` diagnostic plus an `UNCHECKED` line in the script, never a guess. A composite key is audited for part presence and tuple uniqueness on LadybugDB, where only the synthesized column is enforced and the application fills it.

On the label engines a type is matched by its own label, which inherited properties make correct; a closed-type check pins the most specific type by its label count, because an abstract label's extension legitimately carries subtype properties. On LadybugDB an abstract endpoint expands to concrete tables exactly as [[emitters#Ladybug Target|the emitter]] expands them.

## Running

Without a connection the script is written for review, like any artifact. With `--uri` or `--database` the CLI runs each check through a read-only channel and exits non-zero on any positive count, so audit cannot write anywhere, by construction.

The channel is the safety property, not a preference: it is the same read-only discipline the importers established, reused. Counts may arrive as BigInt from the embedded driver, so the CLI converts before comparing.

## Verification

The LadybugDB checks are executed in-process: generate the schema, plant one row per violation kind, and assert each check counts it — then delete the rows and assert every check reads zero.

This is the same standard the Ladybug emitter is held to: a golden file proves the script has not changed, and only execution proves it is true. The golden audit scripts pin all four targets; the three server engines' scripts run in the live suites behind the `LPG_*_URI` gates.
