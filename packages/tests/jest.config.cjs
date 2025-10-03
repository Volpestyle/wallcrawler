module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/src/**/*.test.ts'],
  moduleNameMapper: {
    '^@wallcrawler/sdk$': '<rootDir>/../sdk-node/src/index.ts',
    '^@wallcrawler/sdk/(.*)$': '<rootDir>/../sdk-node/src/$1',
    '^@wallcrawler/stagehand$': '<rootDir>/../stagehand/lib/index.ts',
    '^@wallcrawler/stagehand/(.*)$': '<rootDir>/../stagehand/$1.ts',
    '^@/(.*)$': '<rootDir>/../stagehand/$1.ts',
    '^\.\./lib/version\.js$': '<rootDir>/../stagehand/lib/version.ts'
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }]
  }
};
