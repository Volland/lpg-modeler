## 1. Emitter

- [x] 1.1 `emit/typescript.ts`: capability set, scalar map and aliases, enum unions, mixin and node interfaces (`extends`, own props only), edge interfaces with collision suffix, `SCHEMA` const, JSDoc downgrades.
- [x] 1.2 Register the target; extend CLI usage text.

## 2. Tests

- [x] 2.1 Golden file `social.typescript.ts`; regenerate-and-compare like the other targets.
- [x] 2.2 Compile test: `ts.createProgram` with `strict: true` over the emitted artifact of every fixture; zero diagnostics.
- [x] 2.3 Unit tests: optionality, enum union, composite mapping, open-type index signature, collision suffix, downgrade diagnostics.

## 3. Documentation

- [x] 3.1 `lat.md/emitters.md`: TypeScript Target section.
- [x] 3.2 CHANGELOG; Marketplace/docs follow-up noted.

## 4. Verification

- [x] 4.1 `npm run build`, `npm test`, `npm run lint`; existing goldens unchanged.
- [x] 4.2 `lat check`.
