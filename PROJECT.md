# Beacon

## Cross Platform BLE Device Manager

**Project Type:** Portfolio Project  
**Primary Goal:** Demonstrate senior level mobile engineering using React Native, TypeScript, Swift, Kotlin, native Bluetooth Low Energy integration, device discovery, connection management, GATT inspection, data streaming, persistence, testing, and production quality architecture.

---

# 1. Product Vision

Beacon is a cross platform Bluetooth Low Energy device manager and developer utility built for iOS and Android.

The application discovers nearby BLE peripherals, connects to devices, inspects GATT services and characteristics, subscribes to notifications, reads and writes values, records sessions, and visualizes live device data.

Beacon should feel like a polished mobile developer tool rather than a simple Bluetooth scanner.

The product should demonstrate deep mobile systems knowledge while using React Native and TypeScript as the primary application layer and native Swift and Kotlin for Bluetooth operations.

Example experience:

```text
Nearby Devices

QN Scale
-48 dBm
Connected

Omron BP Monitor
-61 dBm
Available

Unknown Device
-77 dBm
Available
```

After connecting:

```text
QN Scale

Connection
Connected

Signal
-46 dBm

Services
5

Notifications
2 active

[ Inspect Services ]
[ Start Session ]
[ Disconnect ]
```

Developer inspection:

```text
SERVICE
181D
Weight Scale

CHARACTERISTIC
2A9D
Weight Measurement

Properties
Notify

RAW
02 9A 1C 00 00

PARSED
Weight: 183.4 lb
```

---

# 2. Portfolio Goals

Beacon should demonstrate:

- React Native
- TypeScript
- Swift
- Kotlin
- Native modules
- iOS CoreBluetooth
- Android Bluetooth LE APIs
- Bluetooth permissions
- Device discovery
- Connection state management
- GATT service discovery
- Characteristic reads
- Characteristic writes
- Notifications and indications
- Byte parsing
- Binary protocols
- Async programming
- Concurrency
- Event streams
- App lifecycle handling
- Background and foreground behavior
- Local persistence
- Data visualization
- Exporting logs
- Error handling
- Accessibility
- Performance
- Unit testing
- Integration testing
- End to end testing
- Modular architecture
- Dependency boundaries
- Mobile observability

The repository should look like production engineering work, not a tutorial application.

---

# 3. Product Principles

## 3.1 Native BLE Core

Bluetooth logic must live in native platform layers.

Use:

```text
iOS
Swift
CoreBluetooth

Android
Kotlin
BluetoothManager
BluetoothAdapter
BluetoothLeScanner
BluetoothGatt
```

React Native should consume a narrow typed bridge.

Do not make a third party JavaScript BLE package the core implementation.

The purpose of Beacon is to visibly demonstrate native interoperability and mobile platform expertise.

## 3.2 Platform Differences Are Real

Do not pretend iOS and Android Bluetooth behavior is identical.

The architecture should expose a common domain model while allowing platform specific behavior where necessary.

Examples:

- Permission models differ
- Scan behavior differs
- Background behavior differs
- Connection timing differs
- Bonding and pairing differ
- MTU behavior differs
- Bluetooth state behavior differs

## 3.3 Explicit State

Bluetooth state must never be inferred from scattered booleans.

Use explicit state machines for:

- Bluetooth adapter state
- Scanning
- Device connection
- Service discovery
- Subscriptions
- Sessions

## 3.4 Reliability Over Flash

Prioritize connection reliability, clear state, error handling, and inspectability over excessive visual effects.

## 3.5 Developer Friendly

Beacon should make invisible Bluetooth activity visible.

Surface:

- Scan events
- Connection changes
- Service discovery
- Characteristic reads
- Writes
- Notifications
- RSSI
- Errors
- Timestamps
- Raw bytes
- Parsed values

---

# 4. Target Platforms

Primary targets:

```text
iOS
Android
```

Optional later target:

```text
macOS
```

Use the current stable React Native ecosystem when development begins.

Document exact minimum supported OS versions in the repository.

---

# 5. Recommended Stack

## Mobile

```text
React Native
TypeScript
React
```

Use a native capable React Native setup.

Expo development builds are acceptable only if they do not interfere with custom Swift and Kotlin modules.

Do not constrain development to Expo Go.

## Native

```text
iOS
Swift
CoreBluetooth

Android
Kotlin
Android Bluetooth LE APIs
```

## Navigation

Use a mature React Native navigation library.

Required navigation destinations:

```text
Device List
Device Detail
GATT Inspector
Characteristic Detail
Session Detail
Saved Devices
Settings
About
```

## State Management

Separate state by responsibility.

Recommended categories:

```text
Bluetooth adapter state
Scan state
Connection state
Device cache
Session state
UI state
Persistent preferences
```

Avoid one giant global store.

## Persistence

Use SQLite for:

```text
Saved devices
Connection history
BLE sessions
Recorded packets
Known services
Known characteristic metadata
User labels
```

Use lightweight key value storage for preferences.

## Validation

Validate all data crossing native and JavaScript boundaries.

Use runtime schemas for:

```text
Native BLE events
Persisted JSON
Imported logs
Protocol parser output
```

## Testing

Recommended:

```text
Jest
React Native Testing Library
Maestro or Detox
XCTest
Kotlin/JUnit
```

---

# 6. High Level Architecture

```text
┌───────────────────────────────────────┐
│            React Native UI            │
│            TypeScript                 │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│          Application Layer            │
│                                       │
│ Scan Service                          │
│ Connection Coordinator                │
│ Session Manager                       │
│ Parser Registry                       │
│ Repository Layer                      │
└───────────────────┬───────────────────┘
                    │
                    ▼
┌───────────────────────────────────────┐
│         Typed Native BLE API          │
└───────────────────┬───────────────────┘
                    │
          ┌─────────┴─────────┐
          │                   │
          ▼                   ▼
┌─────────────────┐   ┌─────────────────┐
│      iOS        │   │     Android     │
│ Swift           │   │ Kotlin          │
│ CoreBluetooth   │   │ BluetoothGatt   │
└─────────────────┘   └─────────────────┘
```

---

# 7. Repository Structure

Prefer a monorepo.

```text
beacon/
├── apps/
│   └── mobile/
│       ├── src/
│       │   ├── app/
│       │   ├── components/
│       │   ├── features/
│       │   │   ├── bluetooth/
│       │   │   ├── devices/
│       │   │   ├── gatt/
│       │   │   ├── sessions/
│       │   │   ├── parsers/
│       │   │   └── settings/
│       │   ├── hooks/
│       │   ├── navigation/
│       │   ├── native/
│       │   ├── repositories/
│       │   ├── storage/
│       │   ├── theme/
│       │   ├── types/
│       │   └── utils/
│       ├── ios/
│       ├── android/
│       └── tests/
├── packages/
│   ├── ble-contracts/
│   ├── protocol-parsers/
│   ├── validation/
│   ├── test-utils/
│   └── design-tokens/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BLE_STATE_MODEL.md
│   ├── NATIVE_BRIDGE.md
│   ├── PERMISSIONS.md
│   ├── TESTING.md
│   ├── SECURITY.md
│   └── ADR/
├── README.md
├── PROJECT.md
└── package.json
```

---

# 8. Core Domain Models

```typescript
export interface BleDevice {
  id: string;
  name?: string;
  localName?: string;
  rssi?: number;
  connectable?: boolean;
  manufacturerData?: string;
  serviceUuids: string[];
  lastSeenAt: string;
}

export type BluetoothState =
  | "unknown"
  | "unsupported"
  | "unauthorized"
  | "powered_off"
  | "powered_on"
  | "resetting";

export type ScanState =
  | "idle"
  | "starting"
  | "scanning"
  | "stopping"
  | "failed";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "discovering_services"
  | "ready"
  | "disconnecting"
  | "failed";

export interface GattService {
  uuid: string;
  primary: boolean;
  characteristics: GattCharacteristic[];
}

export interface GattCharacteristic {
  serviceUuid: string;
  uuid: string;
  properties: CharacteristicProperty[];
}

export type CharacteristicProperty =
  | "read"
  | "write"
  | "write_without_response"
  | "notify"
  | "indicate";

export interface BlePacket {
  id: string;
  deviceId: string;
  serviceUuid: string;
  characteristicUuid: string;
  direction: "incoming" | "outgoing";
  bytes: number[];
  timestamp: string;
}
```

---

# 9. MVP

The MVP must support:

```text
Bluetooth state
Permissions
Scan
Device discovery
Connect
Disconnect
Service discovery
Characteristic inspection
Read
Write
Subscribe
Unsubscribe
Live packet log
RSSI
Session recording
Local persistence
Export
```

---

# 10. Device Discovery

Main screen:

```text
Beacon

Bluetooth
ON

[ Scan ]

Nearby Devices

QN Scale
-47 dBm
Last seen now

Omron HEM
-59 dBm
Last seen 2 sec ago

Unknown
-81 dBm
Last seen 5 sec ago
```

Requirements:

- Start scan
- Stop scan
- Deduplicate devices
- Update RSSI
- Show last seen
- Sort intelligently
- Hide stale devices after configurable time
- Show unnamed devices
- Show service UUIDs
- Show manufacturer data
- Filter by device name
- Filter by service UUID
- Filter by RSSI

---

# 11. Scan Architecture

```text
User taps Scan
      │
      ▼
Scan Coordinator
      │
      ▼
Native Bridge
      │
      ▼
CoreBluetooth / Android Scanner
      │
      ▼
Native Discovery Event
      │
      ▼
Runtime Validation
      │
      ▼
Device Cache
      │
      ▼
UI
```

Native scan events must be normalized before entering application state.

---

# 12. Permissions

Centralize permissions.

```typescript
export type BlePermissionState =
  | "unknown"
  | "not_requested"
  | "granted"
  | "denied"
  | "blocked";
```

iOS considerations:

```text
Bluetooth authorization
Bluetooth powered state
Info.plist usage descriptions
Background mode only if intentionally implemented
```

Android considerations:

```text
BLUETOOTH_SCAN
BLUETOOTH_CONNECT
```

Request only what the current Android version actually requires.

---

# 13. Device Connection

Device detail:

```text
QN Scale

Signal
-46 dBm

Status
Connected

Services
5

Session
Not recording

[ Inspect GATT ]
[ Start Session ]
[ Disconnect ]
```

Requirements:

- Connect
- Cancel connection
- Disconnect
- Detect remote disconnect
- Timeouts
- Retry
- Connection events
- Service discovery
- Characteristic discovery
- Cleanup
- App lifecycle handling

---

# 14. Connection State Machine

```text
DISCONNECTED
     │
     ▼
CONNECTING
     │
     ▼
CONNECTED
     │
     ▼
DISCOVERING_SERVICES
     │
     ▼
READY
```

Failure:

```text
ANY STATE
   │
   ▼
FAILED
   │
   ▼
DISCONNECTED
```

Do not use multiple booleans as the source of truth.

---

# 15. GATT Inspector

Example:

```text
GATT Services

1800
Generic Access

1801
Generic Attribute

181D
Weight Scale

180F
Battery Service
```

Characteristic detail:

```text
2A9D
Weight Measurement

Properties
Notify

Subscription
Active

Last Value

HEX
02 9A 1C 00 00

DECIMAL
2 154 28 0 0

ASCII
.. ...

[ Subscribe ]
[ Read ]
```

---

# 16. Reads and Writes

Support manual reads and writes.

Write modes:

```text
HEX
Decimal bytes
UTF-8 text
```

Validation:

- Reject invalid hex
- Reject bytes above 255
- Respect characteristic properties
- Record outgoing writes
- Surface native errors

---

# 17. Notifications and Indications

Support:

```text
Subscribe
Unsubscribe
Notification count
Live packet stream
```

Incoming values must flow through a buffered event pipeline.

Do not rerender the full screen for every high frequency packet.

---

# 18. Packet Inspector

Each packet should expose:

```text
Timestamp
Direction
Service UUID
Characteristic UUID
HEX
Decimal
Binary
ASCII
Parsed Value
```

Example:

```text
Packet

10:32:14.241

INCOMING

Service
181D

Characteristic
2A9D

HEX
02 9A 1C 00 00

Parsed
Weight: 183.4 lb
```

---

# 19. Protocol Parser System

```typescript
export interface BleParser<T = unknown> {
  id: string;
  matches(context: ParserContext): boolean;
  parse(bytes: Uint8Array, context: ParserContext): T;
}
```

Initial parsers:

```text
Battery Level
Heart Rate Measurement
Weight Measurement
Blood Pressure
Generic UTF-8
Raw Bytes
```

Keep parsers outside UI code.

---

# 20. Session Recording

Record sessions containing:

```text
Connection events
RSSI updates
Service discovery
Reads
Writes
Notifications
Errors
Disconnect
```

Session model:

```typescript
export interface BleSession {
  id: string;
  deviceId: string;
  startedAt: string;
  endedAt?: string;
  packetCount: number;
}
```

Timeline example:

```text
10:31:02.102
CONNECTED

10:31:02.341
SERVICES DISCOVERED
5 services

10:31:03.008
SUBSCRIBED
181D / 2A9D

10:31:08.522
NOTIFICATION
02 9A 1C 00 00
```

---

# 21. Export

Support:

```text
JSON
CSV
```

Use native share sheets.

JSON should preserve full fidelity.

CSV should be human readable.

---

# 22. RSSI Monitoring

Optional connected device polling.

Show:

```text
Current RSSI
Signal quality
History chart
```

Avoid excessive polling.

---

# 23. Reliability

Handle:

```text
Bluetooth turns off
Permission changes
Device out of range
Remote disconnect
Connection timeout
Service discovery failure
Read failure
Write failure
Subscription failure
Background
Foreground
```

---

# 24. Error Model

```typescript
export type BleErrorCode =
  | "bluetooth_unsupported"
  | "bluetooth_powered_off"
  | "permission_denied"
  | "scan_failed"
  | "device_not_found"
  | "connection_timeout"
  | "connection_failed"
  | "disconnected"
  | "service_not_found"
  | "characteristic_not_found"
  | "read_failed"
  | "write_failed"
  | "subscription_failed"
  | "invalid_payload"
  | "native_failure"
  | "unknown";
```

---

# 25. Native Bridge Contract

```typescript
export interface NativeBleClient {
  getBluetoothState(): Promise<BluetoothState>;
  startScan(options?: ScanOptions): Promise<void>;
  stopScan(): Promise<void>;
  connect(deviceId: string): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  discoverServices(deviceId: string): Promise<GattService[]>;
  readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string
  ): Promise<number[]>;
  writeCharacteristic(
    request: WriteCharacteristicRequest
  ): Promise<void>;
  setNotify(
    request: NotificationRequest
  ): Promise<void>;
  readRssi(deviceId: string): Promise<number>;
}
```

---

# 26. Native Event Protocol

```typescript
export type NativeBleEvent =
  | {
      type: "bluetooth.state_changed";
      state: BluetoothState;
    }
  | {
      type: "scan.device_discovered";
      device: BleDevice;
    }
  | {
      type: "connection.state_changed";
      deviceId: string;
      state: ConnectionState;
    }
  | {
      type: "characteristic.value_changed";
      deviceId: string;
      serviceUuid: string;
      characteristicUuid: string;
      bytes: number[];
      timestamp: string;
    }
  | {
      type: "ble.error";
      deviceId?: string;
      error: BleError;
    };
```

Validate every native event before application logic consumes it.

---

# 27. iOS Native Architecture

Suggested Swift structure:

```text
BeaconBluetooth/
├── BeaconBluetoothModule.swift
├── BluetoothManager.swift
├── PeripheralSession.swift
├── Models/
├── Errors/
├── Mapping/
└── Tests/
```

Responsibilities:

```text
CBCentralManager ownership
Scanning
Peripheral caching
Connections
CBPeripheral delegates
Service discovery
Characteristic discovery
Read/write
Notifications
RSSI
Event emission
Error mapping
```

Do not put all BLE logic inside the React Native bridge class.

---

# 28. Android Native Architecture

Suggested Kotlin structure:

```text
bluetooth/
├── BeaconBluetoothModule.kt
├── BluetoothController.kt
├── DeviceConnection.kt
├── Scanner.kt
├── models/
├── errors/
├── mapping/
└── tests/
```

Responsibilities:

```text
BluetoothManager
BluetoothAdapter
BluetoothLeScanner
BluetoothGatt
Gatt callbacks
Connection lifecycle
Service discovery
Reads
Writes
Notifications
RSSI
Permissions
Event emission
Error mapping
```

---

# 29. Concurrency and GATT Queue

BLE operations are asynchronous and stateful.

Rules:

- Serialize GATT operations where required
- Prevent duplicate connections
- Clean up callbacks
- Cancel stale work
- Ignore events from stale sessions
- Keep native state authoritative

Possible operation states:

```text
Queued
Executing
Completed
Failed
Cancelled
```

---

# 30. Persistence

Suggested SQLite tables:

```text
devices
sessions
session_events
known_services
device_aliases
settings
```

Support schema migrations from the beginning.

---

# 31. Saved Devices

Allow bookmarking and labeling.

Example:

```text
Saved Devices

Office Scale
QN Scale
Last connected yesterday

Blood Pressure Monitor
Omron HEM
Last connected 4 days ago
```

---

# 32. Developer Mode

Developer mode exposes:

```text
Raw advertisements
Manufacturer data
Service UUIDs
Raw packet logging
Hex views
Native error codes
Operation timing
Verbose connection timeline
```

---

# 33. Advertisement Inspector

Show:

```text
Local name
Connectable
RSSI
Service UUIDs
Manufacturer data
Service data
```

Only display fields exposed by the platform.

---

# 34. Known UUID Registry

Map Bluetooth SIG UUIDs to readable names.

```typescript
const knownServices = {
  "1800": "Generic Access",
  "1801": "Generic Attribute",
  "180D": "Heart Rate",
  "180F": "Battery Service",
  "1810": "Blood Pressure",
  "181D": "Weight Scale"
};
```

---

# 35. Security and Privacy

Rules:

- Never perform destructive writes automatically
- Require deliberate user action for writes
- Display target characteristic
- Display outgoing bytes
- Do not upload BLE data by default
- Export only after explicit user action
- Sanitize logs
- Avoid storing sensitive health data unnecessarily

Document assumptions in:

```text
docs/SECURITY.md
```

---

# 36. Accessibility

Support:

```text
Screen readers
Dynamic type
Large touch targets
Text labels for status
Accessible packet rows
Accessible chart summaries
```

Do not communicate connection state using color alone.

---

# 37. Performance

Watch:

```text
High frequency notifications
Large packet logs
Long sessions
Rapid RSSI updates
Hex rendering
Charts
```

Use batching and virtualization where appropriate.

---

# 38. Testing

TypeScript tests:

```text
UUID normalization
Hex parsing
Decimal parsing
Parser registry
Standard parsers
Error mapping
State reducers
Session aggregation
Filter logic
```

Native tests:

```text
Swift model/error mapping
Swift state transitions
Kotlin error mapping
Kotlin operation queue
Kotlin state transitions
Byte conversions
```

Integration tests should mock native events.

---

# 39. Mock BLE Layer

Create:

```text
MockBleClient
```

Support:

```text
Simulated scanning
Mock devices
Connection success
Connection failure
Service discovery
Reads
Writes
Notifications
RSSI changes
Disconnects
Bluetooth powered off
```

Demo peripherals:

```text
Mock Heart Rate Monitor
Mock Battery Device
Mock Weight Scale
```

This allows recruiters to run the app without real hardware.

---

# 40. CI

Required:

```text
Install
Typecheck
Lint
Unit tests
Component tests
```

Where practical:

```text
iOS build
Android build
Swift tests
Kotlin tests
```

---

# 41. Code Quality Rules

All production code must:

- Use TypeScript strict mode
- Avoid `any`
- Avoid unsafe casts
- Use explicit domain models
- Separate UI from BLE orchestration
- Keep native bridges narrow
- Validate native events
- Clean up subscriptions
- Handle cancellation
- Handle timeouts
- Handle platform differences explicitly
- Add tests for meaningful logic
- Avoid unnecessary dependencies

---

# 42. AI Coding Assistant Rules

This project will be speed developed with AI assistance.

Before implementing:

1. Read this file completely.
2. Inspect the repository.
3. Identify the current milestone.
4. Follow existing patterns.
5. Decide whether the change belongs in TypeScript, Swift, Kotlin, or shared contracts.
6. Identify tests required.
7. Avoid unnecessary dependencies.

While implementing:

- Make small coherent changes
- Preserve architecture
- Write production quality TypeScript
- Write production quality Swift
- Write production quality Kotlin
- Add tests with features
- Handle BLE failures explicitly
- Avoid fake implementations presented as complete
- Avoid rewriting unrelated code
- Keep platform behavior isolated
- Keep native bridge APIs narrow
- Never claim hardware behavior was validated unless it was actually tested

After implementing:

1. Run typecheck.
2. Run lint.
3. Run tests.
4. Run iOS build validation.
5. Run Android build validation.
6. Review the diff.
7. Remove temporary logging.
8. Report files created.
9. Report files modified.
10. Report commands executed.
11. Report failures.
12. Report known limitations.
13. Mark the milestone GREEN or BLOCKED.

---

# 43. Definition of Done

A feature is complete only when:

- Implementation exists
- State behavior is explicit
- Loading states exist
- Error states exist
- Permission behavior exists
- Native cleanup exists
- Tests exist
- Tests pass
- Typecheck passes
- Lint passes
- Relevant native build passes
- Documentation is updated where needed
- No fake success states exist
- Hardware validation status is reported accurately

---

# 44. Development Milestones

## M0: Foundation

Deliver:

```text
React Native app
TypeScript strict mode
Swift native module
Kotlin native module
Shared BLE contracts
Linting
Testing
CI
Architecture docs
```

Gate:

```text
iOS app launches
Android app launches
Typecheck passes
Lint passes
Tests pass
Swift bridge callable
Kotlin bridge callable
CI passes
```

Do not start scanning before M0 is green.

## M1: Bluetooth State and Permissions

Deliver:

```text
Bluetooth state API
Permission abstraction
iOS authorization mapping
Android permission mapping
Settings guidance
UI state
Tests
```

Gate:

```text
Powered on
Powered off
Unauthorized
Unsupported
```

## M2: Device Scanning

Deliver:

```text
Native scanning
Discovery events
Device cache
RSSI updates
Deduplication
Scan controls
Device list
Filters
Mock scanner
```

Gate:

```text
Start scan
Devices appear
RSSI updates
No duplicate rows
Stop scan
Events stop
```

## M3: Connection Lifecycle

Deliver:

```text
Connect
Disconnect
Timeout
Remote disconnect
State machine
Native connection events
Device detail
```

## M4: GATT Discovery

Deliver:

```text
Service discovery
Characteristic discovery
UUID labels
GATT inspector
Characteristic properties
```

## M5: Read and Write

Deliver:

```text
Reads
Write with response
Write without response
HEX input
Decimal input
UTF-8 input
Validation
Packet logging
```

## M6: Notifications

Deliver:

```text
Subscribe
Unsubscribe
Incoming values
Buffered UI updates
Packet log
```

## M7: Parser System

Deliver:

```text
Parser registry
Battery parser
Heart rate parser
Weight parser
Blood pressure parser
Raw fallback
Tests
```

## M8: Session Recording

Deliver:

```text
SQLite
Session timeline
Statistics
Session history
Persistence
```

## M9: Export

Deliver:

```text
JSON export
CSV export
Share sheet
```

## M10: Mock Peripheral Environment

Deliver:

```text
MockBleClient
Heart rate mock
Battery mock
Weight scale mock
Failure scenarios
```

## M11: Reliability

Test:

```text
Bluetooth off during scan
Bluetooth off while connected
Permission denied
Device disappears
Connection timeout
Read timeout
Write failure
Notification failure
Rapid connect/disconnect
Background
Foreground
```

## M12: Polish

Deliver:

```text
Dark mode
Accessibility
Performance pass
Developer mode
Settings
App icon
Launch screen
```

## M13: Portfolio Release

Deliver:

```text
README
Architecture diagram
Screenshots
Demo video
Real device demo
Mock device demo
CI badge
Native bridge docs
BLE state docs
Tradeoffs
Roadmap
```

---

# 45. ADRs

Use:

```text
docs/ADR/
```

Recommended:

```text
0001-react-native-with-native-ble-core.md
0002-native-bridge-contract.md
0003-connection-state-machine.md
0004-gatt-operation-queue.md
0005-session-persistence.md
0006-parser-registry.md
```

---

# 46. README Requirements

Suggested structure:

```text
Beacon

Demo

What It Is

Why I Built It

Features

Architecture

React Native / Native Boundary

iOS CoreBluetooth

Android BLE

GATT Inspector

Protocol Parsers

Session Recording

Testing

Mock BLE Environment

Tech Stack

Running Locally

Project Structure

Technical Decisions

Roadmap
```

Avoid generic marketing copy.

Explain the engineering.

---

# 47. Portfolio Demo Script

1. Launch Beacon.
2. Show Bluetooth state.
3. Start scan.
4. Connect to a device.
5. Show connection state transitions.
6. Open GATT inspector.
7. Subscribe to a characteristic.
8. Show incoming packets.
9. Switch between HEX, Decimal, and Parsed.
10. Show RSSI.
11. Start a session.
12. Perform reads and writes.
13. Stop and inspect session.
14. Export JSON.
15. Switch to mock mode.
16. Briefly show TypeScript, Swift, Kotlin, and tests.

---

# 48. Stretch Goals

```text
Background scanning
Background reconnect
Bonding and pairing UI
MTU inspection
Connection priority
Android PHY selection
Descriptor reads
Descriptor writes
Advertisement parser
Manufacturer specific parsers
BLE UART terminal
Sensor charts
Multiple simultaneous connections
macOS support
Protocol replay
Virtual peripheral mode
```

---

# 49. Explicit Non Goals for MVP

Do not build early:

```text
Firmware updates
Mesh networking
BLE peripheral mode
Cloud accounts
Remote management
IoT backend
Mass provisioning
Large analytics platform
Dozens of proprietary parsers
```

---

# 50. Interview Talking Points

Beacon should demonstrate:

```text
Why BLE remains native
How Swift CoreBluetooth delegates are wrapped
How Kotlin BluetoothGatt callbacks are managed
How native events are typed and validated
How connection state machines prevent invalid states
How GATT operations are serialized
How packet streams are buffered
How mock BLE enables deterministic testing
How disconnects and permission changes are handled
```

---

# 51. Success Criteria

A reviewer should quickly see:

```text
React Native
+
TypeScript
+
Swift
+
Kotlin
+
CoreBluetooth
+
Android BLE
+
Native Modules
+
State Machines
+
Binary Protocols
+
Persistence
+
Testing
+
Production Engineering
```

The goal is not simply to prove Bluetooth scanning works.

The goal is to demonstrate a serious cross platform mobile architecture with native integrations.

---

# 52. Initial AI Development Instruction

Use this when handing the repo to an AI coding assistant:

```text
You are the lead engineer responsible for implementing Beacon.

PROJECT.md is the authoritative product and engineering specification.

Before writing code:

1. Read PROJECT.md completely.
2. Inspect the repository.
3. Do not assume files, dependencies, APIs, or architecture exist.
4. Report the current repository state.
5. Compare it against Milestone M0.
6. Produce a concise implementation plan for M0 only.
7. Identify any decisions that genuinely block M0.
8. Do not ask questions whose answers can reasonably be determined from PROJECT.md or the repository.
9. Use current stable libraries and verify compatibility before adding dependencies.
10. Do not begin later milestones until the current milestone gate passes.

Engineering requirements:

- React Native with TypeScript strict mode.
- Swift owns iOS BLE implementation.
- Kotlin owns Android BLE implementation.
- CoreBluetooth is used directly on iOS.
- Native Android BLE APIs are used directly on Android.
- JavaScript must not become the source of truth for native connection state.
- Native bridge contracts must be narrow and typed.
- Native events must be validated.
- Connection state must use an explicit state machine.
- Async BLE operations must support cleanup.
- Android GATT operations must be serialized where required.
- Platform differences must be explicit.
- Do not introduce a third party BLE library as the core BLE engine.
- Tests must accompany meaningful logic.
- A mock BLE implementation must support hardware independent development.
- Never claim hardware validation unless it actually occurred.
- Never hide failing commands.
- Never claim a milestone is complete unless every required gate passes.

When you finish a development pass, report:

1. Files created.
2. Files modified.
3. Architecture decisions made.
4. Tests added.
5. Commands executed.
6. Exact validation results.
7. Hardware validation performed, if any.
8. Remaining issues.
9. Whether the milestone gate is GREEN or BLOCKED.

If blocked, explain exactly what is blocking it.

Begin with M0 only.
```

---

# 53. Final Development Rule

**Do not optimize Beacon for how quickly an AI assistant can generate code. Optimize it for what a senior mobile engineer can confidently defend during a technical interview.**

When choosing between:

```text
More BLE features
```

and:

```text
Clearer state management
Better native boundaries
Better failure handling
Better tests
Better protocol parsing
Better lifecycle management
Better documentation
```

choose the second option.

Beacon should demonstrate engineering judgment as much as technical implementation.
