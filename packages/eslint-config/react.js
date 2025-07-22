import base from './base.js';

export default [
  ...base,
  {
    files: ['**/*.{jsx,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // React-specific rules (placeholder for when React plugins are added)
      // To use React rules, install eslint-plugin-react and eslint-plugin-react-hooks
      // and uncomment the rules below:

      // 'react/react-in-jsx-scope': 'off',
      // 'react/jsx-uses-react': 'off',
      // 'react/prop-types': 'off',
      // 'react/display-name': 'off',
      // 'react-hooks/exhaustive-deps': 'warn',
      // 'react/jsx-curly-brace-presence': ['warn', { props: 'never', children: 'never' }],
      // 'react/jsx-filename-extension': ['warn', { extensions: ['.tsx'] }],

      // Basic JSX rules without plugins
      'no-unused-vars': 'off', // TypeScript handles this better for React components
    },
  },
];
