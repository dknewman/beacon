/** @type {import('jest').Config} */
module.exports = {
  displayName: 'mobile',
  preset: '@react-native/jest-preset',
  rootDir: __dirname,
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  moduleNameMapper: {
    '^@beacon/ble-contracts$': '<rootDir>/../../packages/ble-contracts/src/index.ts',
    '^@beacon/validation$': '<rootDir>/../../packages/validation/src/index.ts',
    '^@beacon/protocol-parsers$':
      '<rootDir>/../../packages/protocol-parsers/src/index.ts',
  },
  // React Navigation and react-native-screens ship ES modules only; the preset's
  // pattern would leave them untransformed and Jest cannot parse `export`.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-navigation|react-native-screens|react-native-safe-area-context)/)',
  ],
  setupFiles: ['<rootDir>/tests/setup/jest.setup.ts'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
};
