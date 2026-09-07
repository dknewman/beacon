# ADR 0008: Protocol parsers in their own package; ordered registry with a raw fallback; failures as outcomes

Status: Accepted (M7)

## Context

M7 turns the bytes the packet log already holds into readings a person can interpret. Four
things had to be decided together:

1. the parser interface. PROJECT.md 19 fixes it: `BleParser<T>` with an `id`,
   `matches(context)` and `parse(bytes: Uint8Array, context)`, six initial parsers (Battery
   Level, Heart Rate Measurement, Weight Measurement, Blood Pressure, Generic UTF-8, Raw
   Bytes) and the rule that parsers stay outside UI code. `Uint8Array` is the input the
   interface names, while every value in the app is a `number[]`, because that is what
   crosses the bridge and what the packet log stores (ADR 0006);
2. what a parser is allowed to return. PROJECT.md lists "Protocol parser output" among the
   data that must pass a runtime schema, next to native events and persisted JSON. A parser
   is application code, not a boundary, but it is the one place where a hand-written decoder
   could push a malformed value into the packet inspector or a recorded session;
3. what the packet inspector shows. PROJECT.md 18 asks for a "Parsed Value" next to the HEX,
   decimal, binary and ASCII columns, and gives an example: `02 9A 1C 00 00` on `2A9D` shown
   as "Weight: 183.4 lb". The example is illustrative and does not follow the Weight
   Measurement characteristic definition (see below);
4. what happens when a value does not parse. Real peripherals send truncated, vendor-extended
   or plainly wrong values, and the inspector's job is to show what arrived, not to hide it.
   The session export (M9) also needs the parsed reading with full fidelity, so a parser's
   output has to be a plain, serializable value rather than a rendered string.

## Decision

### A workspace package with no UI imports

`packages/protocol-parsers` (`@beacon/protocol-parsers`) holds the reader, the parsers and the
registry. It depends on `@beacon/ble-contracts` (the `BleParser`, `ParsedValue`,
`ParserContext` types and the byte codecs) and `@beacon/validation` (the output schema) and
on nothing else: no React, no React Native, no application module. The dependency direction
is `ble-contracts` ← `validation` ← `protocol-parsers` ← `apps/mobile`, and `packages/*` still
never import from the app. The package is wired like the other two: a root `tsconfig` path, a
Jest project in the root `projects` list, a dependency and Jest module mapping in the mobile
app. The app's own `features/parsers/` holds only the glue (`parsePacket`, `presentableValue`,
`packetSummary`, `formatField`) and the view.

A parser's output is a `ParsedValue`: `parserId`, a `label` ("Heart rate"), a one-line
`summary` ("80 bpm") for lists and packet rows, and `fields` of `{ name, value, unit? }` with
`value` a number, string or boolean. It is display-ready without being rendered, so the same
value serves the characteristic screen today and the recorder and exporter later.

### `number[]` in, `Uint8Array` to the parsers

The registry's `parse` accepts `readonly number[] | Uint8Array` and hands the parser a
`Uint8Array`, converting when needed. Callers keep working on the array representation the
bridge and the packet log use; parsers get the interface PROJECT.md 19 specifies and a
`ByteReader` over it with bounds-checked little-endian `uint8` / `uint16`, the IEEE
11073-20601 SFLOAT with its NaN, NRes and ±infinity specials, and the seven-byte Bluetooth
Date Time with year 0 meaning unknown. Every read names its field, so a short packet fails
with "Missing heart rate: needed 2 byte(s) at offset 1, 1 left" rather than `undefined`.

### First match wins; the raw fallback always succeeds

`createParserRegistry(parsers)` keeps the parsers in the order given and appends the raw
bytes parser when it is not already last. `resolve(context)` returns the first parser whose
`matches` accepts the context, and the raw parser matches every context, so `resolve` always
returns something and a caller can register a more specific parser ahead of a standard one.
`standardParsers` lists the SIG parsers first, then the UTF-8 parser, then raw;
`defaultParserRegistry` is built from it. The raw parser never throws: an empty value is
summarized as "(empty)", anything else as its hex, with the length, hex and ASCII as fields.

### Failures are outcomes, not exceptions

Parsers throw `ParseError` on malformed input, as the interface allows; the registry never
lets that reach the caller. `parse` returns a `ParseOutcome`: `{ ok: true, value }` or
`{ ok: false, parserId, reason, fallback }`, where `fallback` is the raw parser's reading of
the same bytes. The screen therefore always has something to show, and when the matched
parser gave up it can say which one and why ("heart-rate-measurement could not parse this
value: Missing heart rate …") above the raw stand-in. A failed parse is not a failed
operation and is not logged as an error: the packet is intact and the reason is derived
from it on every render.

### Output is validated by schema

What a parser returns is checked with `parsedValueSchema` (`@beacon/validation`,
`parseParsedValue`) before the registry hands it on: non-empty `parserId`, `label` and
`summary`, finite numbers, non-empty units. A parser that returns the wrong shape yields the
same failed outcome as one that throws, with "Invalid parser output" as the reason. The
check costs one small object per parse and buys the guarantee PROJECT.md asks for: nothing
the parsers produce reaches the inspector, the recorder or the exporter unvalidated.

### Parsers follow the SIG characteristic definitions, not the illustrative example

Each SIG parser decodes the characteristic as the Bluetooth SIG defines it: Battery Level
(`2A19`) one byte in `0..100`; Heart Rate Measurement (`2A37`) flags, an 8- or 16-bit rate,
sensor contact, energy expended in kJ and RR intervals converted from 1/1024 s to
milliseconds; Weight Measurement (`2A9D`) flags, weight in 5 g or 0.01 lb units with `0xFFFF`
meaning an unsuccessful measurement, then the optional timestamp, user id, and BMI with
height; Blood Pressure Measurement (`2A35`) flags, systolic, diastolic and mean arterial
pressure as SFLOATs in mmHg or kPa, then the optional timestamp, pulse rate, user id and
measurement status. Fixed-size values must be consumed exactly (`expectEnd`), so a trailing
byte is a failure rather than silently ignored.

The PROJECT.md 18 example, `02 9A 1C 00 00` shown as "Weight: 183.4 lb", is not a valid
Weight Measurement: its flags byte `0x02` says SI units and a timestamp follows, and no
seven-byte timestamp does. The weight parser fails it ("Missing timestamp") and the registry
falls back to raw, which is what the inspector shows. Producing "183.4 lb" from those bytes
would need a decoder that contradicts the characteristic definition and every conformant
scale, so the example is treated as an illustration of the column, not as a test vector; the
test vectors are spec-shaped, and the mock scale and blood pressure monitor now emit
spec-shaped measurements so the mock environment parses with the same code as hardware.

### UTF-8 keyed by known string characteristics

"Generic UTF-8" cannot match every characteristic, or it would claim every value that happens
to be valid UTF-8, including single-byte battery levels. The parser matches the SIG string
characteristics (Device Name, Model Number, Serial Number, Firmware, Hardware and Software
Revision, Manufacturer Name) and the Nordic UART RX and TX lines, labels the value by
characteristic ("Device name", "UART TX"), keeps the full text as the field and strips one
trailing newline from the summary so a UART line reads as one row. Invalid UTF-8 is a
failure, decoded by the strict decoder in `@beacon/ble-contracts`, not a lossy replacement.

## Alternatives considered

- Parsing inside the screen or the packet row component: the shortest path to the "Parsed"
  column, and the arrangement PROJECT.md 19 forbids. The recorder and exporter would then
  re-implement or import UI code, and the parsers could not be tested without rendering.
- One parser per service rather than per characteristic: a Heart Rate Service parser would
  have to switch on the characteristic anyway, and the same characteristic (Battery Level,
  the Device Information strings) appears under more than one service. Matching on the
  characteristic in a context that also carries the service and device name keeps the
  common case one line and leaves room for a vendor parser to look at all three.
- Throwing to the caller: honest, and every call site would need the same try/catch and the
  same raw fallback; a forgotten one would crash the characteristic screen on the first
  non-conformant peripheral, which is exactly the peripheral an inspector exists to show.
- Returning `unknown` (or `T` per parser, as the interface's generic suggests) and letting
  each consumer interpret it: flexible, and the inspector, the recorder and the exporter would
  each need to know every parser's shape. One `ParsedValue` shape, validated once, is what
  makes the "Parsed" column, the row summary and a future export generic over parsers. The
  generic is kept, bounded to `ParsedValue`, so a parser can declare a narrower return type.
- Matching the UTF-8 parser on "decodes cleanly" rather than on a known characteristic: it
  would win for any short numeric value that happens to be printable, which is most of them.
- Decoding the PROJECT.md 18 example as written: see above; the parsers would then disagree
  with the characteristic definition and with every real scale.

## Consequences

- Parsing is stateless and happens at render time over the packet log: the characteristic
  screen parses the latest packet for the value card and each of the 20 listed packets for
  its row summary. There is no parsed-value state to keep in sync with the log and no new
  reducer; the cost is bounded by the 20 rows the screen lists and is small next to the
  five encodings the value columns already compute.
- The raw fallback is hidden on the characteristic screen (`presentableValue`,
  `packetSummary`), because the HEX column already shows it; a failed parse stays visible
  with its reason and the raw stand-in, so a broken or non-conformant peripheral is shown
  rather than silently treated as unknown. A write to a control point, or any characteristic
  no parser knows, shows nothing parsed.
- Parser output is available to the M8 recorder and the M9 export as a plain validated value;
  neither has to run the parsers again or know their shapes.
- Adding a parser is one file in `packages/protocol-parsers/src/parsers/`, an entry in
  `standardParsers` ahead of the raw fallback, and spec-shaped test vectors; nothing in the
  app changes. A vendor parser can be registered ahead of a standard one through
  `createParserRegistry`.
- The `ParseError` message is shown to the user as the reason, so parsers name fields in
  plain words ("battery level", "mean arterial pressure") rather than by offset alone.
- The mock blood pressure monitor gained an indication and the mock scale's indication was
  kept spec-shaped; a mock test asserts every scripted notifier parses with a non-raw parser,
  so the mock environment and the parsers cannot drift apart.
- M7 changes no native code and no bridge payload, so it has nothing to validate on hardware
  beyond what M5 and M6 already owe; whether a real Polar strap or a real scale sends what the
  specification says is still a hardware question.
