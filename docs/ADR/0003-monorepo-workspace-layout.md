# ADR 0003: yarn workspaces monorepo with node-resolved native paths

Status: Accepted (M0)

## Context

PROJECT.md prefers a monorepo with the app under `apps/mobile` and shared packages under
`packages/`. React Native's templates assume `node_modules` sits next to `ios/` and `android/`.

## Decision

- yarn 1 workspaces (`apps/*`, `packages/*`), dependencies hoisted to the repository root.
- Shared packages are consumed as TypeScript source (`main: src/index.ts`); no build step.
- Metro watches the repository root and resolves from both the app and root `node_modules`.
- Gradle locates `react-native`, `@react-native/codegen`, `hermes-compiler` and the RN Gradle
  plugin via `node --print "require.resolve(...)"` so no path assumes a hoisting layout. The
  Podfile already does the same for `react_native_pods.rb`.
- Tooling is configured once at the root: `tsconfig.json`, `eslint.config.js` (flat, ESLint 9),
  `babel.config.js`, `.prettierrc.js`, and a Jest `projects` list.

## Alternatives considered

- pnpm with `node-linker=hoisted`: viable, but yarn 1 has the longest track record with Metro.
- Separate repositories per package: contradicts the specification and slows contract changes.
- Committing `nohoist` rules for React Native: fragile across RN upgrades.

## Consequences

- Contributors must run `yarn install` at the root, not in `apps/mobile`.
- The community ESLint config's Flow block is filtered out because Beacon has no Flow code and
  the plugin is incompatible with ESLint 9.
- Adding a package means adding it to the Jest projects list and the root `paths` map.
