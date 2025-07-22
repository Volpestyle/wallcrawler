import baseConfig from '@wallcrawler/eslint-config';

export default [
  // Global ignores including stagehand (forked repo - keep untouched)
  {
    ignores: [
      '**/dist/**',
      '**/lib/dom/build/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/build/**',
      '**/cdk.out/**',
      '**/tmp/**',
      '**/*.log',
      '**/*.tmp',
      '**/generated-*/**',
      '**/coverage/**',
      '**/artifacts/**',
      '**/.vscode/**',
      '**/.git/**',
      '**/pnpm-lock.yaml',
      '**/*.d.ts',
      'packages/stagehand/**', // Exclude stagehand from this config
    ],
  },

  // Use shared base configuration
  ...baseConfig,

  // Monorepo-specific overrides
  {
    rules: {
      // Allow console in monorepo root scripts
      'no-console': 'off',
    },
  },
];
