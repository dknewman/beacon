export const CHARACTERISTIC_PROPERTIES = [
  'read',
  'write',
  'write_without_response',
  'notify',
  'indicate',
] as const;

export type CharacteristicProperty = (typeof CHARACTERISTIC_PROPERTIES)[number];

export interface GattCharacteristic {
  serviceUuid: string;
  uuid: string;
  properties: CharacteristicProperty[];
}

export interface GattService {
  uuid: string;
  primary: boolean;
  characteristics: GattCharacteristic[];
}
