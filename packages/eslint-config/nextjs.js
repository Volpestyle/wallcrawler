import react from './react.js';

export default [
  ...react,
  {
    files: ['**/app/**/*.{js,ts,jsx,tsx}', '**/pages/**/*.{js,ts,jsx,tsx}'],
    rules: {
      // Next.js specific rules (placeholder for when Next.js ESLint plugin is added)
      // To use Next.js rules, install @next/eslint-plugin-next and uncomment:
      // '@next/next/no-html-link-for-pages': 'off',
      // '@next/next/no-img-element': 'warn',

      // General Next.js patterns without plugins
      'no-console': 'warn', // Warn about console usage in pages
    },
  },

  // API routes specific rules
  {
    files: ['**/api/**/*.{js,ts}', '**/pages/api/**/*.{js,ts}'],
    rules: {
      // API routes can be more relaxed
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off', // Logging in API routes is common
    },
  },
];
