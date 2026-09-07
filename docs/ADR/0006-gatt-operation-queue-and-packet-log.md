# ADR 0006: Native GATT operation queue per connection; bounded application-level packet log

Status: Accepted (M5)

## Context

M5 adds the first GATT operations that carry a value: `readCharacteristic` and
`writeCharacteristic`. Three things had to be decided together:

1. how operations are serialized. Neither platform stack tolerates a second read or write on
   the same peripheral before the first has been answered: CoreBluetooth delivers the callbacks
   out of step and Android's `BluetoothGatt` silently returns `false` and drops the second
   call. PROJECT.md 29 requires GATT operations to be serialized and stale work cancelled;
2. where the resulting bytes live. The characteristic screen needs the latest value, the
   packet inspector needs a history with direction and time, the protocol parsers (M7) need
   the same bytes to decode, and the session recorder (M8) needs one stream to persist. One
   history has to serve all four rather than each screen keeping its own;
3. how bytes cross the bridge. Codegen supports primitives, plain objects and arrays; neither
   `Uint8Array` nor `ArrayBuffer` is a spec type, and Hermes ships no `TextDecoder`, so the
   representation chosen here also fixes how the application layer encodes and decodes.

## Decision

### Queue in native, one per connection

Each connection owns a `GattOperationQueue` (`ios/BeaconBluetooth/GattOperationQueue.swift`,
`android/.../connection/GattOperationQueue.kt`). It is pure: an operation is a label plus a
`start` closure that performs the platform call, `enqueue` starts it immediately when nothing
is in flight, and the owner (`PeripheralSession` on iOS, `DeviceConnection` on Android) calls
`finish()` from the matching delegate or callback (`didUpdateValueFor`, `didWriteValueFor`,
`onCharacteristicRead`, `onCharacteristicWrite`). A `start` that returns `false` has already
settled its own completion and the queue moves on. When the link ends, `cancelAll()` hands
back the in-flight and pending operations so the owner settles every waiting promise with
`disconnected`; the error is emitted before the `disconnected` transition, as ADR 0005
requires. The owner keeps the in-flight read and write completions; the queue holds no
CoreBluetooth or Android types and is unit tested on both platforms.

Both platforms check the characteristic's property bits before touching the stack: a read on
a characteristic without `read`, or a write in a mode the characteristic does not offer,
rejects with `read_failed` / `write_failed` and the message "Read not permitted" / "Write not
permitted" without entering the queue.

### One operation at a time from the UI as well

`useCharacteristicOperations` runs one read or write per characteristic screen at a time
(`busy: idle | reading | writing`) and ignores a second tap while one is in flight. The native
queue is the guarantee; the UI gate exists so the screen can say "Reading…" and so a user
cannot pile up requests against a slow peripheral. Notifications (M6) and the recorder (M8)
will queue natively behind whatever the screen has started.

### Packet log above navigation, bounded, successes only

`PacketLogProvider` (`features/packets`) holds one `BlePacket[]` per device, newest first, in
a ring buffer of 500 packets (`DEFAULT_PACKET_LOG_CAPACITY`). It sits above the navigator like
the other coordinators (ADR 0005), so the history survives leaving and re-entering the
characteristic screen and is the same history the packet inspector, the parsers and the
recorder will read. A successful read is recorded as an `incoming` packet and a successful
write as an `outgoing` one, timestamped when the result reached JavaScript. Failures are not
packets: there are no bytes to show, and a failure belongs to the operation that caused it, so
it lives in that characteristic's `lastOutcome` with its contract code. The screen shows the
latest 20 packets of the log; the log keeps more.

### Bytes are `number[]` across the bridge

Values cross the bridge as arrays of integers in `0..255`, in both directions. The wrapper
validates every read result with `parseByteArray` (an out-of-range element rejects with
`invalid_payload`), and native rejects a write whose array holds anything else with
`invalid_payload` before the stack sees it (`ByteArrayMapper` on each platform, pure and unit
tested; React Native delivers every JavaScript number as a double, so fractional and non-finite
values are caught there too). `@beacon/ble-contracts/bytes.ts` owns the
encodings built on that representation (hex, decimal, binary, printable ASCII, a strict UTF-8
decoder and encoder, and the write-form parsers) so the screen, the parsers and the recorder
share one vocabulary.

## Alternatives considered

- A queue in JavaScript only: it would serialize what the app issues but not what native
  starts on its own (service discovery during connect, descriptor writes for M6
  subscriptions), and a JavaScript timer cannot know when the platform callback arrived. The
  native side has the callbacks, so the queue lives there; the UI gate is a courtesy, not the
  guarantee.
- An unbounded log: a notifying characteristic (M6) can deliver tens of packets a second, and
  the recorder is the place that persists. A fixed ring buffer keeps memory flat and makes
  "what the screen shows" independent of session length.
- Logging failures as packets with an empty value: they would need a third direction and
  every consumer would have to filter them out before decoding. Keeping them in the
  operation outcome keeps the log a list of bytes that actually crossed the link.
- `Uint8Array` across the bridge: not a codegen type, so it would have to be boxed anyway.
- Base64 strings across the bridge: compact, but every consumer would decode before it could
  show a single byte, the validation layer would be checking string shape rather than byte
  range, and Hermes has no native `atob`. Plain arrays are what codegen types, what zod can
  bound element by element, and what the JVM (signed `ByteArray`) and `Data` map to with one
  loop each.

## Consequences

- `BleClient` widens to `GattValueApi` after M5; `FakeBleClient` gains `resolveRead`,
  `rejectRead`, `resolveWrite` and `rejectWrite` so tests can hold an operation in flight
  while the link drops.
- The native owners must call `finish()` from every completion path, including errors and
  the property check, or the queue stalls; the queue tests cover the failed-start case and
  `cancelAll`, and the owner tests are hardware validation.
- The write-without-response promise resolves when the stack accepted the write, not when
  the peripheral received it (CoreBluetooth reports nothing for `.withoutResponse`;
  Android's `onCharacteristicWrite` confirms only local transmission). The screen labels the
  outcome "Wrote N bytes without response" for that reason.
- Each device's ring buffer is dropped only by `log_cleared`; leaving the screen or losing the
  link keeps the history, which is what the inspector expects.
- The UTF-8 codec is hand written and must stay strict (truncated sequences, overlong forms,
  surrogates and values above U+10FFFF decode to "Not valid UTF-8" rather than replacement
  characters), because the ASCII column is the lossless one.
