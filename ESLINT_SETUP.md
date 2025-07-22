# ESLint Configuration for Wallcrawler Monorepo

## Overview

This monorepo uses a modern, relaxed ESLint configuration that follows industry standards while providing flexibility for different types of packages.

## Architecture

### Shared Configuration Package

- **Location**: `packages/eslint-config/`
- **Package**: `@wallcrawler/eslint-config`
- **Type**: ESM module with modular exports

### Available Configurations

- `@wallcrawler/eslint-config` (base) - Basic TypeScript/JavaScript rules
- `@wallcrawler/eslint-config/react` - React-specific rules (placeholder for plugins)
- `@wallcrawler/eslint-config/nextjs` - Next.js-specific rules (placeholder for plugins)
- `@wallcrawler/eslint-config/node` - Node.js-specific rules

## Key Features

### Modern & Relaxed Approach

- Uses `@typescript-eslint/recommended` instead of strict rules
- Type-aware linting only for `.ts` and `.tsx` source files
- Config files (eslint.config.js, etc.) are excluded from type checking
- Warnings instead of errors for most issues

### Package-Specific Configurations

Each workspace has its own `eslint.config.js` that extends the shared configuration:

- **Components** (`@wallcrawler/components`): React configuration
- **Utils** (`@wallcrawler/utils`): Node.js configuration
- **Infrastructure packages**: Node.js configuration with CDK-specific overrides
- **Demos** (`@wallcrawler/demos-nextjs-local`): Next.js configuration
- **Stagehand** (`@wallcrawler/stagehand`): **Left untouched** (forked repo)

### Modern Patterns

- ESM modules with `"type": "module"` in package.json
- ESLint flat config format (v9+)
- Workspace dependencies using `workspace:*` protocol
- Proper hoisting configuration for plugin resolution

## Usage

### Running Lints

```bash
# Lint entire monorepo (excludes stagehand)
pnpm lint

# Lint specific package
pnpm --filter @wallcrawler/utils run lint

# Lint and fix
pnpm --filter @wallcrawler/utils run lint:fix

# Lint stagehand separately (uses its own config)
pnpm lint:stagehand
```

### Adding New Packages

1. Add `eslint.config.js` to your package
2. Import appropriate shared configuration
3. Add package-specific overrides if needed
4. Add lint scripts to package.json

Example:

```javascript
import nodeConfig from '@wallcrawler/eslint-config/node';

export default [
  ...nodeConfig,
  {
    rules: {
      // Package-specific overrides
    },
  },
];
```

## Configuration Details

### Dependency Management

- ESLint dependencies installed at monorepo root
- Shared config uses peer dependencies
- Hoisting configured in `.npmrc` for proper plugin resolution

### Type Checking

- Type-aware rules only enabled for TypeScript source files
- Config files excluded from type checking to avoid parsing issues
- Select type-aware rules: `await-thenable`, `no-floating-promises`, `no-misused-promises`

### Excluded from Linting

- `packages/stagehand/**` (forked repository)
- `**/dist/**`, `**/.next/**`, `**/node_modules/**`
- Build artifacts and temporary files

## Extension Points

### Adding React/Next.js Rules

The React and Next.js configurations are currently placeholders. To enable full React linting:

1. Install plugins:

   ```bash
   pnpm add -Dw eslint-plugin-react eslint-plugin-react-hooks @next/eslint-plugin-next
   ```

2. Uncomment rules in:
   - `packages/eslint-config/react.js`
   - `packages/eslint-config/nextjs.js`

### Package-Specific Rules

Each package can override shared rules by adding them to their `eslint.config.js` file.

## Maintenance

### Updating Rules

1. Modify shared configuration in `packages/eslint-config/`
2. Run `pnpm install` to propagate changes
3. Test across all packages

### Adding New Configurations

1. Create new file in `packages/eslint-config/`
2. Export from `package.json` exports field
3. Document usage patterns
