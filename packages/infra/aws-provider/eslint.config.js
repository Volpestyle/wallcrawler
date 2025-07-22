import nodeConfig from '@wallcrawler/eslint-config/node';
import { createTypeAwareConfig } from '@wallcrawler/eslint-config/base';

export default [
  ...nodeConfig,

  // Add explicit TypeScript configuration for this package
  createTypeAwareConfig('./tsconfig.json', import.meta.dirname),

  // AWS Provider specific overrides
  {
    rules: {
      // AWS SDK often requires flexible typing
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',

      // Provider code often needs console for debugging
      'no-console': 'warn',
    },
  },
];
