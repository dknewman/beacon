/** @type {import('jest').Config} */
module.exports = {
  displayName: 'mobile',
  preset: '@react-native/jest-preset',
  rootDir: __dirname,
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleNameMapper: {
    '^@beacon/ble-contracts$': '<rootDir>/../../packages/ble-contracts/src/index.ts',
    '^@beacon/validation$': '<rootDir>/../../packages/validation/src/index.ts',
  },
  setupFiles: ['<rootDir>/tests/setup/jest.setup.ts'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
