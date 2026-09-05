// Shared Jest setup for the mobile app project.
// react-native-safe-area-context ships a Jest mock (default export) that
// provides zero insets and a pass-through SafeAreaProvider.
jest.mock('react-native-safe-area-context', () => {
  const mock: unknown = require('react-native-safe-area-context/jest/mock');
  return (mock as { default: unknown }).default;
});
