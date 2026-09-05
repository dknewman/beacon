/** @type {import('jest').Config} */
module.exports = {
  projects: [
    '<rootDir>/apps/mobile',
    '<rootDir>/packages/ble-contracts',
    '<rootDir>/packages/validation',
  ],
  collectCoverageFrom: [
    'apps/*/src/**/*.{ts,tsx}',
    'packages/*/src/**/*.{ts,tsx}',
    '!**/specs/**',
    '!**/index.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
};
