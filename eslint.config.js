// ESLint flat config for the Beacon monorepo.
// Extends the React Native community config and layers strict TypeScript rules
// that enforce the PROJECT.md code quality rules (no `any`, no unsafe casts,
// exhaustive state machine switches).
const babelParser = require('@babel/eslint-parser');
const reactNative = require('@react-native/eslint-config/flat');
const tseslint = require('typescript-eslint');

// Beacon has no Flow code. The community config's Flow block relies on
// eslint-plugin-ft-flow, which is incompatible with ESLint 9, so it is
// replaced with a plain Babel-parsed block for the few JS config files.
const reactNativeWithoutFlow = reactNative.filter(
  block => !(block.plugins && 'ft-flow' in block.plugins),
);

module.exports = [
  {
    ignores: [
      '**/node_modules/**',
      '**/build/**',
      '**/coverage/**',
      '**/ios/**',
      '**/android/**',
      '**/vendor/**',
      '**/.yarn/**',
    ],
  },
  ...reactNativeWithoutFlow,
  {
    files: ['**/*.js'],
    languageOptions: {
      parser: babelParser,
      parserOptions: { requireConfigFile: false },
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-shadow': 'off',
      'no-console': 'error',
    },
  },
  {
    // Test files may use Jest globals and relaxed unsafe rules for fixtures.
    files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**', '**/tests/**'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
];
