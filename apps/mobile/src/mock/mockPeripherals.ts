/**
 * Scripted peripherals for the mock BLE layer (PROJECT.md 39). Values mirror
 * what real hardware advertises so the list, filters and later the parsers see
 * realistic data: standard service UUIDs, manufacturer prefixes with the
 * little-endian company identifier, and mixed name availability.
 */
import type { GattService } from '@beacon/ble-contracts';

export interface MockPeripheral {
  id: string;
  name?: string;
  localName?: string;
  /** Typical RSSI when the phone is a few meters away. */
  baseRssi: number;
  /** How far the simulated RSSI is allowed to drift from `baseRssi`. */
  rssiJitter: number;
  connectable: boolean;
  manufacturerData?: string;
  serviceUuids: string[];
  /** Milliseconds between advertisements. Real devices range from 20 ms to several seconds. */
  advertisingIntervalMs: number;
  /** GATT table reported once connected (canonical UUIDs). */
  services: GattService[];
  /**
   * Initial characteristic values keyed by canonical characteristic UUID.
   * Reads return these (writes replace them for the session); a readable
   * characteristic without an entry reads as empty.
   */
  values?: Record<string, number[]>;
  /**
   * Characteristics that push values once subscribed, keyed by canonical UUID:
   * how often, and what the n-th value is. Used for notify and indicate alike.
   */
  notifiers?: Record<string, MockNotifier>;
}

export interface MockNotifier {
  intervalMs: number;
  /** Builds the value for the `sequence`-th notification (0-based) with a random source. */
  produce: (sequence: number, random: () => number) => number[];
}

const utf8 = (text: string): number[] => Array.from(text, char => char.charCodeAt(0));
const clampByte = (value: number): number => Math.min(255, Math.max(0, value));
/** An SFLOAT with exponent 0 for a whole number 0..2047, little-endian. */
const sfloat = (value: number): number[] => [value % 256, Math.floor(value / 256)];

export const HEART_RATE_SERVICE = '0000180D-0000-1000-8000-00805F9B34FB';
export const BATTERY_SERVICE = '0000180F-0000-1000-8000-00805F9B34FB';
export const WEIGHT_SCALE_SERVICE = '0000181D-0000-1000-8000-00805F9B34FB';
export const BODY_COMPOSITION_SERVICE = '0000181B-0000-1000-8000-00805F9B34FB';
export const BLOOD_PRESSURE_SERVICE = '00001810-0000-1000-8000-00805F9B34FB';
export const NORDIC_UART_SERVICE = '6E400001-B5A3-F393-E0A9-E50E24DCCA9E';
export const GENERIC_ACCESS_SERVICE = '00001800-0000-1000-8000-00805F9B34FB';
export const DEVICE_INFORMATION_SERVICE = '0000180A-0000-1000-8000-00805F9B34FB';

const sig = (short: string) => `0000${short}-0000-1000-8000-00805F9B34FB`;

function service(
  uuid: string,
  primary: boolean,
  characteristics: Array<
    [uuid: string, properties: GattService['characteristics'][number]['properties']]
  >,
): GattService {
  return {
    uuid,
    primary,
    characteristics: characteristics.map(([characteristicUuid, properties]) => ({
      serviceUuid: uuid,
      uuid: characteristicUuid,
      properties,
    })),
  };
}

const genericAccess = service(GENERIC_ACCESS_SERVICE, true, [
  [sig('2A00'), ['read']],
  [sig('2A01'), ['read']],
]);

const deviceInformation = service(DEVICE_INFORMATION_SERVICE, true, [
  [sig('2A29'), ['read']],
  [sig('2A24'), ['read']],
  [sig('2A26'), ['read']],
]);

const battery = service(BATTERY_SERVICE, true, [[sig('2A19'), ['read', 'notify']]]);

export const defaultMockPeripherals: MockPeripheral[] = [
  {
    id: 'MOCK-HRM-0001',
    name: 'Polar H10 1A2B3C',
    baseRssi: -52,
    rssiJitter: 6,
    connectable: true,
    manufacturerData: '6B00010203',
    serviceUuids: [HEART_RATE_SERVICE, BATTERY_SERVICE],
    advertisingIntervalMs: 500,
    services: [
      genericAccess,
      deviceInformation,
      service(HEART_RATE_SERVICE, true, [
        [sig('2A37'), ['notify']],
        [sig('2A38'), ['read']],
        [sig('2A39'), ['write']],
      ]),
      battery,
    ],
    values: {
      [sig('2A00')]: utf8('Polar H10 1A2B3C'),
      [sig('2A01')]: [0x41, 0x03],
      [sig('2A29')]: utf8('Polar Electro Oy'),
      [sig('2A24')]: utf8('H10'),
      [sig('2A26')]: utf8('5.1.0'),
      [sig('2A38')]: [0x01],
      [sig('2A19')]: [0x5c],
    },
    notifiers: {
      [sig('2A37')]: {
        intervalMs: 1_000,
        // Flags 0x10 (energy expended absent, contact detected) then an 8-bit BPM that
        // drifts around a resting rate.
        produce: (sequence, random) => [
          0x00,
          clampByte(72 + Math.round(Math.sin(sequence / 5) * 6 + (random() - 0.5) * 4)),
        ],
      },
      [sig('2A19')]: {
        intervalMs: 5_000,
        produce: sequence => [clampByte(0x5c - Math.floor(sequence / 12))],
      },
    },
  },
  {
    id: 'MOCK-SCALE-0002',
    localName: 'QN-Scale',
    baseRssi: -64,
    rssiJitter: 8,
    connectable: true,
    manufacturerData: 'FFFF0A1B2C3D4E5F',
    serviceUuids: [WEIGHT_SCALE_SERVICE, BODY_COMPOSITION_SERVICE],
    advertisingIntervalMs: 800,
    services: [
      genericAccess,
      service(WEIGHT_SCALE_SERVICE, true, [
        [sig('2A9E'), ['read']],
        [sig('2A9D'), ['indicate']],
      ]),
      service(BODY_COMPOSITION_SERVICE, true, [
        [sig('2A9B'), ['read']],
        [sig('2A9C'), ['indicate']],
      ]),
      battery,
    ],
    values: {
      [sig('2A00')]: utf8('QN-Scale'),
      [sig('2A9E')]: [0x38, 0x00, 0x00, 0x00],
      [sig('2A9B')]: [0xff, 0x0f, 0x00, 0x00],
      [sig('2A19')]: [0x2d],
    },
    notifiers: {
      // Weight Measurement indication: flags 0x00 (SI, no timestamp), weight in
      // units of 5 g little-endian; 72.5 kg = 14500 = 0x38A4.
      [sig('2A9D')]: {
        intervalMs: 2_000,
        produce: (sequence, random) => {
          const grams = 14_500 + Math.round((random() - 0.5) * 20) + (sequence % 3);
          return [0x00, grams % 256, Math.floor(grams / 256)];
        },
      },
    },
  },
  {
    id: 'MOCK-BPM-0003',
    name: 'Omron HEM-7361T',
    baseRssi: -71,
    rssiJitter: 5,
    connectable: true,
    serviceUuids: [BLOOD_PRESSURE_SERVICE],
    advertisingIntervalMs: 1_200,
    services: [
      genericAccess,
      deviceInformation,
      service(BLOOD_PRESSURE_SERVICE, true, [
        [sig('2A35'), ['indicate']],
        [sig('2A36'), ['notify']],
        [sig('2A49'), ['read']],
      ]),
    ],
    values: {
      [sig('2A00')]: utf8('Omron HEM-7361T'),
      [sig('2A29')]: utf8('OMRON HEALTHCARE'),
      [sig('2A24')]: utf8('HEM-7361T'),
      [sig('2A26')]: utf8('2.3'),
      [sig('2A49')]: [0x1f, 0x00],
    },
    notifiers: {
      // Blood Pressure Measurement indication: flags 0x04 (mmHg, pulse rate present),
      // then systolic, diastolic, mean arterial pressure and pulse as SFLOATs with
      // exponent 0, so the value is the little-endian mantissa itself.
      [sig('2A35')]: {
        intervalMs: 4_000,
        produce: (sequence, random) => {
          const systolic = 118 + (sequence % 3) + Math.round((random() - 0.5) * 4);
          const diastolic = 78 + (sequence % 2);
          const mean = Math.round(diastolic + (systolic - diastolic) / 3);
          const pulse = 70 + (sequence % 4);
          return [
            0x04,
            ...sfloat(systolic),
            ...sfloat(diastolic),
            ...sfloat(mean),
            ...sfloat(pulse),
          ];
        },
      },
    },
  },
  {
    id: 'MOCK-UART-0004',
    name: 'Nordic_UART',
    baseRssi: -58,
    rssiJitter: 4,
    connectable: true,
    serviceUuids: [NORDIC_UART_SERVICE],
    advertisingIntervalMs: 300,
    services: [
      genericAccess,
      service(NORDIC_UART_SERVICE, true, [
        ['6E400002-B5A3-F393-E0A9-E50E24DCCA9E', ['write', 'write_without_response']],
        ['6E400003-B5A3-F393-E0A9-E50E24DCCA9E', ['notify']],
      ]),
    ],
    values: {
      [sig('2A00')]: utf8('Nordic_UART'),
    },
    notifiers: {
      ['6E400003-B5A3-F393-E0A9-E50E24DCCA9E']: {
        intervalMs: 300,
        produce: sequence => utf8(`tick ${sequence}\n`),
      },
    },
  },
  {
    id: 'MOCK-BEACON-0005',
    baseRssi: -83,
    rssiJitter: 10,
    connectable: false,
    manufacturerData: '4C000215',
    serviceUuids: [],
    advertisingIntervalMs: 1_000,
    services: [],
  },
];
