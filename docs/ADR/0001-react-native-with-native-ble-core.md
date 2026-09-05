# ADR 0001: React Native UI with a native BLE core

Status: Accepted (M0)

## Context

Beacon must demonstrate cross platform mobile engineering including native Bluetooth expertise.
Third party JavaScript BLE libraries exist, but they hide exactly the platform behaviour the
project is meant to show, and they make JavaScript the de facto owner of connection state.

## Decision

- React Native 0.87 with TypeScript strict mode is the application layer.
- All Bluetooth behaviour is implemented in Swift (CoreBluetooth) and Kotlin (Android BLE APIs)
  inside the app, not in a dependency.
- Native state is authoritative. JavaScript receives validated events and never infers state.
- No third party BLE package is used as the engine. Utility libraries (navigation, SQLite, safe
  area) remain acceptable.

## Consequences

- More native code to write and test, which is the point.
- Platform differences are modelled explicitly instead of being papered over.
- The bridge must be designed carefully (ADR 0002); a mock client is required for hardware
  independent development (M10).
