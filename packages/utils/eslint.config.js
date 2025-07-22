import nodeConfig from '@wallcrawler/eslint-config/node';
import { createTypeAwareConfig } from '@wallcrawler/eslint-config/base';

export default [
  ...nodeConfig,

  // Add explicit TypeScript configuration for this package
  createTypeAwareConfig('./tsconfig.json', import.meta.dirname),

  // Package-specific overrides
  {
    rules: {
      // Utilities often need flexible any types for generic functions
      '@typescript-eslint/no-explicit-any': 'warn',

      // AWS SDK and Redis often require specific patterns
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
];
