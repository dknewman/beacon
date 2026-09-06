import { toShortUuid } from './uuid';

/**
 * Known UUID registry (PROJECT.md 34): Bluetooth SIG assigned numbers plus a
 * few widely deployed vendor services. Keys are the 16-bit short form for SIG
 * identifiers and the canonical 128-bit form for vendor UUIDs.
 */
export const KNOWN_SERVICES: Readonly<Record<string, string>> = {
  '1800': 'Generic Access',
  '1801': 'Generic Attribute',
  '1802': 'Immediate Alert',
  '1803': 'Link Loss',
  '1804': 'Tx Power',
  '1805': 'Current Time',
  '180A': 'Device Information',
  '180D': 'Heart Rate',
  '180F': 'Battery Service',
  '1810': 'Blood Pressure',
  '1812': 'Human Interface Device',
  '1814': 'Running Speed and Cadence',
  '1816': 'Cycling Speed and Cadence',
  '1818': 'Cycling Power',
  '1819': 'Location and Navigation',
  '181A': 'Environmental Sensing',
  '181B': 'Body Composition',
  '181C': 'User Data',
  '181D': 'Weight Scale',
  '181E': 'Bond Management',
  '181F': 'Continuous Glucose Monitoring',
  '1822': 'Pulse Oximeter',
  '1826': 'Fitness Machine',
  FE95: 'Xiaomi',
  FEAA: 'Eddystone',
  FE59: 'Nordic DFU',
  '6E400001-B5A3-F393-E0A9-E50E24DCCA9E': 'Nordic UART Service',
};

export const KNOWN_CHARACTERISTICS: Readonly<Record<string, string>> = {
  '2A00': 'Device Name',
  '2A01': 'Appearance',
  '2A04': 'Peripheral Preferred Connection Parameters',
  '2A05': 'Service Changed',
  '2A06': 'Alert Level',
  '2A07': 'Tx Power Level',
  '2A19': 'Battery Level',
  '2A23': 'System ID',
  '2A24': 'Model Number String',
  '2A25': 'Serial Number String',
  '2A26': 'Firmware Revision String',
  '2A27': 'Hardware Revision String',
  '2A28': 'Software Revision String',
  '2A29': 'Manufacturer Name String',
  '2A2B': 'Current Time',
  '2A35': 'Blood Pressure Measurement',
  '2A36': 'Intermediate Cuff Pressure',
  '2A37': 'Heart Rate Measurement',
  '2A38': 'Body Sensor Location',
  '2A39': 'Heart Rate Control Point',
  '2A49': 'Blood Pressure Feature',
  '2A53': 'RSC Measurement',
  '2A5B': 'CSC Measurement',
  '2A63': 'Cycling Power Measurement',
  '2A6D': 'Pressure',
  '2A6E': 'Temperature',
  '2A6F': 'Humidity',
  '2A9B': 'Body Composition Feature',
  '2A9C': 'Body Composition Measurement',
  '2A9D': 'Weight Measurement',
  '2A9E': 'Weight Scale Feature',
  '2AA6': 'Central Address Resolution',
  '2AB6': 'URI',
  '2B29': 'Client Supported Features',
  '2B2A': 'Database Hash',
  '6E400002-B5A3-F393-E0A9-E50E24DCCA9E': 'Nordic UART RX',
  '6E400003-B5A3-F393-E0A9-E50E24DCCA9E': 'Nordic UART TX',
};

export interface UuidLabel {
  /** The short form for SIG UUIDs ("180D"), the canonical form otherwise. */
  display: string;
  /** Human readable name when the UUID is known. */
  name?: string;
}

function describe(uuid: string, registry: Readonly<Record<string, string>>): UuidLabel {
  const short = toShortUuid(uuid);
  const key = short ?? uuid.toUpperCase();
  const name = registry[key];
  return name === undefined ? { display: key } : { display: key, name };
}

/** Label for a service UUID in canonical form. */
export function describeServiceUuid(uuid: string): UuidLabel {
  return describe(uuid, KNOWN_SERVICES);
}

/** Label for a characteristic UUID in canonical form. */
export function describeCharacteristicUuid(uuid: string): UuidLabel {
  return describe(uuid, KNOWN_CHARACTERISTICS);
}
