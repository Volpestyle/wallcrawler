import nextConfig from '@wallcrawler/eslint-config/nextjs';

export default [
  ...nextConfig,

  // Demo-specific overrides
  {
    rules: {
      // Demos can be more relaxed for experimentation
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',

      // Demo code often has temporary implementations
      '@typescript-eslint/no-unused-vars': 'warn',
    },
  },

  // Allow more relaxed rules in demo pages
  {
    files: ['**/app/**/*.tsx', '**/pages/**/*.tsx'],
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
];
