---
inclusion: manual
---

# ESLint + Prettier Configuration Audit

## Configuration Status: ✅ CONSOLIDATED

### Root Configuration
- **`.eslintrc.json`**: Centralized config with `"root": true` acts as authority for all packages
- **`.prettierrc.json`**: Single formatting standard (100 char width, 2 spaces, single quotes, trailing commas)
- **`.prettierignore`**: Shared ignore patterns (dist/, node_modules/, coverage/, *.md)

### Package Configuration
All three packages inherit root configuration with no local overrides:
- `sep10-auth`: No local ESLint/Prettier config
- `sanctions-oracle`: No local ESLint/Prettier config
- `horizon-listener`: No local ESLint/Prettier config

### Linting Rules
- `@typescript-eslint/no-explicit-any`: `off`
- `@typescript-eslint/no-unused-vars`: `warn` (ignores parameters starting with `_`)
- `@typescript-eslint/no-namespace`: `error` with `allowDeclarations: true`

### Formatting Standards
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

### CI Integration
- GitHub Actions workflow enforces `npm run lint` on all PRs and pushes to main
- Build step follows linting to catch errors early
- Tests run after successful build

## No Drift Detected
All packages follow the shared configuration consistently.
