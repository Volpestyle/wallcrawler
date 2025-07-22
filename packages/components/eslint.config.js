import reactConfig from '@wallcrawler/eslint-config/react';
import { createTypeAwareConfig } from '@wallcrawler/eslint-config/base';

export default [
  ...reactConfig,

  // Add explicit TypeScript configuration for this package
  createTypeAwareConfig('./tsconfig.json', import.meta.dirname),

  // Package-specific overrides
  {
    rules: {
      // Allow console in development components
      'no-console': 'warn',

      // React components often use forwardRef
      'react/display-name': 'off',
    },
  },
];
