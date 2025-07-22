import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  // Base JavaScript rules
  js.configs.recommended,

  // TypeScript rules - basic recommended without type checking
  ...tseslint.configs.recommended,

  // Language options
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2022,
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },

  // Modern, relaxed rules (but NO automatic type checking)
  {
    rules: {
      // Relaxed unused vars - allow underscore prefix
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],

      // Relaxed any usage - warn instead of error
      '@typescript-eslint/no-explicit-any': 'warn',

      // Disable overly strict rules for modern development
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',

      // Allow empty interfaces for extending
      '@typescript-eslint/no-empty-interface': 'off',

      // Modern import/export patterns
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'inline-type-imports',
        },
      ],

      // Relaxed function rules
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',

      // Allow console for debugging in development
      'no-console': 'warn',

      // Prefer const for immutable values
      'prefer-const': 'warn',

      // Allow both == and === (modern JS handles this well)
      eqeqeq: ['warn', 'smart'],

      // Relaxed object rules
      'no-prototype-builtins': 'off',
    },
  },

  // Config files can be more relaxed
  {
    files: [
      '**/*.config.{js,mjs,ts}',
      '**/tailwind.config.{js,ts}',
      '**/eslint.config.{js,mjs,ts}',
      'eslint.config.js',
      '**/*.d.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      'no-undef': 'off',
    },
  },

  // Test files can be more relaxed
  {
    files: ['**/*.test.{js,ts,tsx}', '**/*.spec.{js,ts,tsx}', '**/test/**', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  }
);

// Export a function to create type-aware configuration
export function createTypeAwareConfig(tsconfigPath, rootDir = process.cwd()) {
  return {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: tsconfigPath,
        tsconfigRootDir: rootDir,
      },
    },
    rules: {
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  };
}
