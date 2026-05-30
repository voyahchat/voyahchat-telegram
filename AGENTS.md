# MUST
- English for code, comments, docs; brief and technical; NO EMOJI
- No backward compatibility — breaking changes OK
- Run `npm run lint` before finishing; never `eslint-disable`

# Code Style
- Follow config/config-eslint.mjs
- End files with a single empty line

# Build
- Use NPM scripts only; silent on success
- Move files with `mv`, not read/write
- Validate complex scripts via temp files, not `node -c`

# Testing
- AVA in `test/*.test.js`, run `npm test`
- Use TestDir for isolation (creates dirs in `.test/`)
- Naming: `ClassName.method() - should do X when Y`
- AAA pattern (Arrange-Act-Assert)
- Strict assertions: `t.is()`, `t.deepEqual()`, not `t.truthy()`

# Modules
- Split large modules into prefixed submodules (e.g. download-*.js)
- Each submodule: JSDoc with @module
- Index file (e.g. download-index.js) re-exports submodules
