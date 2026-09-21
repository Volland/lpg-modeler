## 1. Opening a database read-write

- [x] 1.1 Generalise the CLI's database open so read-only is a per-command decision, keeping the bounded buffer pool and max size the import uses. Confirm the import path still opens read-only, with a test that a write through an imported connection is refused.
- [x] 1.2 `--database <path>` and `--no-create` in the argument parser and the usage text; `--uri` stays for the networked engines.

## 2. Apply

- [x] 2.1 `apply --target ladybug`: the existing header, destructive and splitting checks, then open (creating unless `--no-create`), run one statement at a time, print progress, stop at the first failure with its position, and close in `finally`.
- [x] 2.2 Report a created database, a path that is not a database, and an unopenable one; name `apply` rather than `import` in the missing-runtime hint.

## 3. Tests

- [x] 3.1 Without the runtime or a database: target mismatch, the destructive gate, `--dry-run`, `--no-create` on an empty path, the missing-runtime hint.
- [x] 3.2 In-process: apply the generated schema for `social` to a temporary database, then import it back and assert the node types, keys and endpoints.
- [x] 3.3 In-process: build a database from the earlier revision, seed rows, apply the migration, and assert the later schema and the surviving rows.
- [x] 3.4 In-process: a script whose third statement the engine refuses — assert the first two applied, the count reported, and a non-zero exit.

## 4. Documentation

- [x] 4.1 `lat.md/architecture.md#Distribution`: apply reaches every database target, and a database is opened read-write only by apply. `lat.md/emitters.md#Migrations`: how a migration reaches a database.
- [x] 4.2 Docs site (`cli.html`, `migrations.html`), README, CHANGELOG, CLI usage text.

## 5. Verification

- [x] 5.1 `npm run build`, `npm test`, `npm run lint`; every existing golden file unchanged.
- [x] 5.2 `lat check`.
