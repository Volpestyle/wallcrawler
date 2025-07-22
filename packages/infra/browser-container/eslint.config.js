import nodeConfig from '@wallcrawler/eslint-config/node';
import { createTypeAwareConfig } from '@wallcrawler/eslint-config/base';

export default [
  ...nodeConfig,

  // Add explicit TypeScript configuration for this package
  createTypeAwareConfig('./tsconfig.json', import.meta.dirname),

  // Browser container specific overrides
  {
    rules: {
      // Container code often needs console for logging
      'no-console': 'off',

      // Browser automation may require flexible typing
      '@typescript-eslint/no-explicit-any': 'warn',

      // Docker and containerization patterns
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },
];
