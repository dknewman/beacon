# Architecture Decision Records

| ADR                                                         | Title                                                     | Status   |
| ----------------------------------------------------------- | --------------------------------------------------------- | -------- |
| [0001](0001-react-native-with-native-ble-core.md)           | React Native UI with a native BLE core                    | Accepted |
| [0002](0002-native-bridge-contract.md)                      | Codegen Turbo Module bridge with runtime validation       | Accepted |
| [0003](0003-monorepo-workspace-layout.md)                   | yarn workspaces monorepo with node-resolved native paths  | Accepted |
| [0004](0004-scan-duplicates-and-device-cache.md)            | Duplicate advertisements, native throttling, JS cache     | Accepted |
| [0005](0005-navigation-and-connection-promise-semantics.md) | React Navigation; connect() resolves at ready; JS timeout | Accepted |
| [0006](0006-gatt-operation-queue-and-packet-log.md)         | Native GATT operation queue; bounded packet log           | Accepted |
| [0007](0007-buffered-notification-pipeline.md)              | Buffered notification pipeline; subscriptions from acks   | Accepted |
| [0008](0008-parser-registry.md)                             | Parser package; ordered registry with raw fallback        | Accepted |
| [0009](0009-session-persistence.md)                         | Sessions in SQLite behind a repository; activity bus      | Accepted |
| [0010](0010-export-formats-and-share-pipeline.md)           | JSON and CSV exports; a separate share Turbo Module       | Accepted |

Planned: mock peripheral environment (M10).
