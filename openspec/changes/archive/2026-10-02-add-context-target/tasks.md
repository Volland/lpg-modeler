## 1. Emitter

- [x] 1.1 `emit/context.ts`: legend header, node/edge/mixin/enum/constraint lines, raw SHACL passthrough.
- [x] 1.2 Register the target; extend CLI usage text.

## 2. Tests

- [x] 2.1 Golden file `social.context.md`.
- [x] 2.2 Unit tests: determinism; completeness over the features fixture; raw SHACL carried without a downgrade.

## 3. Documentation

- [x] 3.1 `lat.md/emitters.md`: Context Target section.
- [x] 3.2 CHANGELOG.

## 4. Verification

- [x] 4.1 `npm run build`, `npm test`, `npm run lint`; existing goldens unchanged.
- [x] 4.2 `lat check`.
