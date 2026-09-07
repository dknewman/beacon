# ADR 0007: Native-timestamped notifications, buffered in JavaScript; subscriptions mirrored from native acknowledgements

Status: Accepted (M6)

## Context

M6 adds the first data that the peripheral pushes on its own: notifications and indications.
Unlike a read, whose one result answers one call, a subscribed characteristic delivers values
at whatever rate the peripheral chooses, from a battery level every few seconds to an inertial
sensor at 100 Hz or more. Four things had to be decided together:

1. how often the React tree may render for incoming values. PROJECT.md 17 requires incoming
   values to flow through a buffered event pipeline and forbids re-rendering the screen for
   every high frequency packet; PROJECT.md 37 asks for batching where appropriate. The
   characteristic screen shows the latest value in five encodings and the latest 20 packets,
   so a render per value would be the most expensive thing the app does, at the highest rate;
2. where a packet's time comes from. The bridge delivers events in batches and the JavaScript
   thread may be busy rendering the previous batch, so a burst of ten values 5 ms apart can
   reach JavaScript within one tick. A timestamp taken there would collapse the burst to one
   instant, and the packet inspector (PROJECT.md 18) and the recorder (M8) need the real
   spacing;
3. what "subscribed" means. Both platforms answer a subscription change asynchronously and can
   refuse it (insufficient authentication, a missing descriptor, status 133), and both drop
   every subscription when the link ends without any callback per characteristic;
4. how the two platforms subscribe. CoreBluetooth's `setNotifyValue(_:for:)` writes the Client
   Characteristic Configuration descriptor itself; Android's `setCharacteristicNotification`
   only routes callbacks locally and leaves the descriptor write to the app. The
   characteristic may offer `notify`, `indicate` or both, and the bridge exposes one boolean.

## Decision

### Native stamps the time

`onCharacteristicValueChanged` carries `{ deviceId, serviceUuid, characteristicUuid, bytes,
timestamp }`, and `timestamp` is taken natively at receipt: on the CoreBluetooth queue inside
`didUpdateValueFor`, on the binder thread inside `onCharacteristicChanged`, before the value
crosses the bridge, as ISO-8601 with millisecond precision. Buffering in JavaScript then
changes when a value is shown, never when it is recorded as having arrived, and a burst keeps
its order and spacing in the packet log. The wrapper validates every event with
`characteristicValueChangedEventSchema` (canonical UUIDs, bytes in `0..255`, an ISO
timestamp) like every other event.

### JavaScript buffers and flushes every 100 ms

`SubscriptionProvider` (`features/subscriptions`) is the only listener for
`characteristic.value_changed`. It turns each event into an `incoming` `BlePacket` with the
native timestamp, appends it to a ref buffer, which touches no React state, and arms one
timer per flush (`flushIntervalMs`, default `DEFAULT_FLUSH_INTERVAL_MS` = 100). When the timer
fires it empties the buffer with one `packets_recorded` batch into the packet log
(`PacketLogProvider.recordMany`, one dispatch for the whole batch, the ring buffer still
capped at 500 per device) and one `values_received` action carrying, per characteristic, the
count and the timestamp of the newest value. A 100 Hz stream therefore causes at most ten
renders per second, a 1 Hz stream still shows each value within 100 ms, and the screen's
value columns and packet list update from the same batched log rather than from a second
copy of the bytes. The flush is a plain timer so it is deterministic under Jest fake timers
and independent of the display refresh rate.

### Subscriptions are application state mirrored from native acknowledgements

`subscriptionsReducer` keeps one `CharacteristicSubscription` per
`deviceId/serviceUuid/characteristicUuid` with `phase: off | subscribing | on |
unsubscribing`, `notificationCount` (values since the subscription was last turned on),
`lastValueAt` and `lastError`. An entry moves to `subscribing` / `unsubscribing` when
`setNotify` is called and to `on` / `off` only when its promise settles, and the promise
settles only when the peripheral acknowledged the change: `didUpdateNotificationStateFor` on
iOS, the descriptor write callback on Android. A rejection returns the entry to where it was
with `lastError` set, so the screen never shows a subscription the peripheral did not accept.
Failures are reported in the entry, not logged as packets. Values that arrive for a
characteristic the app never subscribed to (another client on the same link, or a peripheral
that notifies unasked) are still logged and counted, so the screen shows what is actually
arriving.

Every subscription ends with the link. Native keeps a subscribed set per session for its own
bookkeeping but does not report subscriptions ending one by one, because the platforms do
not: CoreBluetooth forgets `isNotifying` with the connection and Android's descriptor state
lives on the closed client. `SubscriptionProvider` watches the connection machine and drops
every entry of a device (`link_ended`) when the device leaves `ready`, the same way
`GattProvider` drops the table. A `setNotify` in flight when the link ends rejects with
`disconnected`, after the `ble.error` and before the `disconnected` transition (ADR 0005).

### Subscribing goes through the GATT queue; Android writes the CCCD itself

`setNotify` is a GATT operation and queues behind reads, writes and other subscription
changes on the same peripheral (ADR 0006). On iOS `PeripheralSession` records the pending
change, calls `setNotifyValue(_:for:)`, and `didUpdateNotificationStateFor` settles it and
finishes the queue. On Android `DeviceConnection` calls `setCharacteristicNotification`,
which only tells the stack to deliver `onCharacteristicChanged` locally, and then writes the
Client Characteristic Configuration descriptor (`0x2902`) with `ENABLE_NOTIFICATION_VALUE`,
`ENABLE_INDICATION_VALUE` or `DISABLE_NOTIFICATION_VALUE`; the peripheral learns of the
subscription only through that write, and `onDescriptorWrite` settles the promise and finishes
the queue. Choosing the descriptor value from the property bits is a pure helper
(`NotificationDescriptorMapper`) with JUnit coverage. A characteristic without the descriptor
cannot be configured remotely, so the request is refused with `subscription_failed` rather
than reported as a subscription that never delivers, matching CoreBluetooth's refusal on iOS;
a descriptor write the stack or the peripheral refuses flips the local switch back so the two
never disagree.

### Notification when offered, indication only otherwise

The bridge exposes `enabled: boolean`, not the transport, because the app is an inspector and
a user cannot choose per value how the peripheral confirms delivery. Native picks a
notification when the characteristic has `notify` and an indication only when it has
`indicate` alone: notifications cost no acknowledgement per value and are what streaming
characteristics offer, indications are what measurement characteristics such as Weight
Measurement (`2A9D`) and Blood Pressure Measurement (`2A35`) offer instead. A characteristic
with neither rejects with `subscription_failed` and the message "Notifications not supported"
without entering the queue, matching the "Read not permitted" / "Write not permitted" checks.
On iOS the choice is CoreBluetooth's inside `setNotifyValue`; on Android it is the descriptor
value. The stack acknowledges an indication on both platforms and the app sees no difference
between the two.

## Alternatives considered

- Rendering per event: one dispatch and one render of the characteristic screen per value,
  including labelling the latest 20 packets again. Fine at 1 Hz, and exactly what PROJECT.md
  17 forbids at 100 Hz. The reducer would also run once per value against a 500-entry ring
  buffer.
- Batching natively and emitting arrays of values: it would move a rendering concern into two
  native codebases that must then agree on a cadence, hide per-value arrival from the bridge,
  and still need a JavaScript flush for the two platforms' batches to reach React at one rate.
  One value per event is the natural bridge unit and a single JavaScript buffer serves both
  platforms with one implementation and one test.
- Flushing on `requestAnimationFrame`: ties the flush to the display (60 or 120 Hz), which is
  more renders than the screen needs, stops while the app is in the background so the buffer
  grows unbounded, and is awkward under fake timers. A fixed 100 ms `setTimeout` bounds the
  render rate explicitly.
- Timestamping in JavaScript when the event arrives: one less field on the bridge, but bursts
  collapse to the tick they were delivered in and the packet inspector would show ten packets
  at the same millisecond.
- Marking a subscription `on` when `setNotify` is called: simpler, and wrong whenever the
  descriptor write fails or the peripheral refuses; the screen would show a live subscription
  that delivers nothing. Connection state is mirrored from native (ADR 0005) for the same
  reason.
- Keeping a per-subscription value history in the subscription state: the packet log already
  is that history (ADR 0006) and is what the inspector, the parsers (M7) and the recorder (M8)
  read; a second copy would double the memory per value.

## Consequences

- `BleClient` is now the whole `NativeBleClient` contract; `FakeBleClient` keeps `setNotify`
  pending like every other call so tests can hold a subscription change in flight while the
  link drops, and emits `characteristic.value_changed` events directly to exercise the flush.
- A value is shown up to 100 ms after it arrived; its packet timestamp is exact because native
  stamped it. `notificationCount` grows by the batch size per flush, so it is accurate at every
  render but does not tick once per value.
- CoreBluetooth reports read results and notifications through the same `didUpdateValueFor`.
  While a read of a subscribed characteristic is in flight, the first value for that
  characteristic settles the read; every value with no read pending is a notification. The
  platform offers no way to tell them apart.
- `PacketLogProvider` gains `recordMany`; the reducer applies the capacity cap once per batch,
  so a burst larger than 500 keeps the newest 500 in arrival order.
- Subscriptions are dropped from application state on every exit from `ready`, including a
  disconnect the user asked for; reconnecting starts with no subscriptions, as native does.
- The mock client scripts notifiers per characteristic (interval and value producer) and
  stops them with the link, so the flush cadence and the drop-with-link rule are exercised
  without hardware; whether a real peripheral acknowledges and streams is hardware validation.
- Indications are acknowledged by the platform stack, not by the app, so a slow flush never
  delays an acknowledgement.
