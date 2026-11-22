module.exports = {
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  testEnvironment: 'node',
  modulePathIgnorePatterns: ['<rootDir>/lib/'],
  // Sources import siblings with a `.js` extension so the ES module build
  // runs in Node; Jest resolves them to the TypeScript files.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};
