## 1. Emitter

- [x] 1.1 `emit/docs.ts`: page skeleton and inline styles, TOC, node/edge/mixin/enum sections, property tables with provenance, constraints in words.
- [x] 1.2 Feature detection plus the enforcement matrix over the sibling capability constants.
- [x] 1.3 Register the target; extend CLI usage text.

## 2. Tests

- [x] 2.1 Golden file `social.docs.html`.
- [x] 2.2 Unit tests: no external subresource; every element anchored and in the TOC; matrix rows equal the used features.

## 3. Documentation

- [x] 3.1 `lat.md/emitters.md`: Docs Target section.
- [x] 3.2 CHANGELOG.

## 4. Verification

- [x] 4.1 `npm run build`, `npm test`, `npm run lint`; existing goldens unchanged.
- [x] 4.2 `lat check`.
