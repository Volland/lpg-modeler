## ADDED Requirements

### Requirement: Applying a script to a running FalkorDB

`lpg apply <script> --target falkordb --uri redis://host:port` SHALL read each `$REDIS_CLI` line of a generated falkordb script back into the Redis command it invokes, substituting the script's graph key, and send each command in file order, printing each as it succeeds. It SHALL stop at the first command the server refuses, report its position, its text and the server's message, report how many commands had already been sent, and exit non-zero. The password SHALL be taken from `FALKORDB_PASSWORD`, never from a flag.

#### Scenario: Applying a generated schema to an empty graph

- **WHEN** the falkordb script generated for a model is applied to an empty graph
- **THEN** every command is sent, the command exits zero, and the graph holds the indexes and constraints the script declares

#### Scenario: The graph key comes from the flag, not the file

- **WHEN** a script is applied with `--graph-key` naming a different key from the one written into it
- **THEN** every command is sent against the named key, exactly as overriding `GRAPH_KEY` in the shell would

#### Scenario: A command the server refuses

- **WHEN** a script creates a constraint that already exists
- **THEN** that command is reported with the server's message, no later command is sent, and the command exits non-zero

### Requirement: Apply reads only the shapes the generator writes

`lpg apply --target falkordb` SHALL refuse a line that is not one of the command forms this tool generates, rather than interpreting it. Comments, blank lines and the generated preamble assignments SHALL be skipped.

#### Scenario: A hand-edited script

- **WHEN** a falkordb script carrying a shell loop, a pipe or an unrecognised command is applied
- **THEN** an `apply-unreadable-line` error names the line and its number, nothing is sent, and the command exits non-zero

### Requirement: Apply reports what a constraint's reply does not

Because a FalkorDB constraint is created asynchronously, `lpg apply --target falkordb` SHALL state that a `PENDING` reply is not yet enforcement, and SHALL read the constraints back after the last command to report any that settled `FAILED`.

#### Scenario: A constraint the stored data defeats

- **WHEN** a script is applied to a graph whose stored data violates one of its unique constraints
- **THEN** every command is sent, and the run reports that the constraint settled `FAILED` and is not enforcing, and exits non-zero
