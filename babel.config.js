module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // zod 4 ships `export * as ns from` in its ESM entry. Metro's production
    // transform runs the CommonJS module plugin, which requires this syntax to be
    // lowered first; the React Native preset does not include the plugin.
    '@babel/plugin-transform-export-namespace-from',
  ],
};
