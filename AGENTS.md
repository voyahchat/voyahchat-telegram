# A MUST RULES
- Use English for code, comments and documentation
- Keep docs brief and technical (NO EMOJI)
- Use temporary files for complex script validation, not `node -c`

# Backward Compatibility & Build Artifacts
- DO NOT maintain backward compatibility - breaking changes are acceptable

# Code Style
- Follow JavaScript Style Guide from config/config-eslint.mjs
- End files with a single empty line
- Run `npm run lint` before task is done; never use `eslint-disable`

# Development & Build
- Use NPM scripts exclusively; they should be silent on success
- Use `mv` to move files, not read/write operations

# Testing
- Tests use AVA in `test/` (`*.test.js`), run via `npm test`
- MUST use TestDir for test isolation - creates isolated directories in `.test/`
- Test naming: `ClassName.method() - should do X when Y`
- Use AAA pattern: Arrange-Act-Assert with clear separation
- Use strict assertions: `t.is()`, `t.deepEqual()` not `t.truthy()`

# Module Organization
- Large modules can be split into focused submodules with a common prefix (e.g., download-*.js)
- Each submodule should have proper JSDoc documentation with @module tag
- Create an index file (e.g., download-index.js) to export all functions from submodules
- Keep related functionality together in the same submodule group
