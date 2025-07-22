import base from './base.js';
import globals from 'globals';

export default [
  ...base,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Node.js specific rules
      'no-process-env': 'off', // Allow process.env usage
      'no-process-exit': 'warn', // Warn about process.exit

      // Allow require in Node.js files
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',

      // Console is normal in Node.js
      'no-console': 'off',

      // Buffer and other Node.js globals
      'no-undef': 'off',
    },
  },

  // Lambda functions and serverless
  {
    files: ['**/lambda/**/*.{js,ts}', '**/functions/**/*.{js,ts}'],
    rules: {
      // Lambda functions often have specific patterns
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off', // CloudWatch logs
    },
  },
];
