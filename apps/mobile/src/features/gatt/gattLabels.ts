import {
  describeCharacteristicUuid,
  describeServiceUuid,
  type CharacteristicProperty,
  type GattCharacteristic,
  type GattService,
} from '@beacon/ble-contracts';

export interface GattEntryLabel {
  /** Short display form of the UUID. */
  code: string;
  /** Known name, or a neutral placeholder so the row always has a title. */
  title: string;
  known: boolean;
}

export function labelService(service: GattService): GattEntryLabel {
  const label = describeServiceUuid(service.uuid);
  return {
    code: label.display,
    title:
      label.name ?? (service.primary ? 'Unknown service' : 'Unknown secondary service'),
    known: label.name !== undefined,
  };
}

export function labelCharacteristic(characteristic: GattCharacteristic): GattEntryLabel {
  const label = describeCharacteristicUuid(characteristic.uuid);
  return {
    code: label.display,
    title: label.name ?? 'Unknown characteristic',
    known: label.name !== undefined,
  };
}

const PROPERTY_LABELS: Record<CharacteristicProperty, string> = {
  read: 'Read',
  write: 'Write',
  write_without_response: 'Write without response',
  notify: 'Notify',
  indicate: 'Indicate',
};

/** Comma separated property names in contract order, or "None". */
export function describeProperties(properties: CharacteristicProperty[]): string {
  return properties.length === 0
    ? 'None'
    : properties.map(property => PROPERTY_LABELS[property]).join(', ');
}
