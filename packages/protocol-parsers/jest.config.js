/** @type {import('jest').Config} */
module.exports = {
  displayName: 'protocol-parsers',
  rootDir: __dirname,
  testEnvironment: 'node',
  transform: { '\\.[jt]sx?$': ['babel-jest', { rootMode: 'upward' }] },
  moduleNameMapper: {
    '^@beacon/ble-contracts$': '<rootDir>/../ble-contracts/src/index.ts',
    '^@beacon/validation$': '<rootDir>/../validation/src/index.ts',
    '^@beacon/protocol-parsers$': '<rootDir>/../protocol-parsers/src/index.ts',
  },
  testMatch: ['**/*.test.ts'],
};
