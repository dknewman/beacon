import React from 'react';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { DeviceDetailScreen } from '../../features/connection/DeviceDetailScreen';
import { CharacteristicDetailScreen } from '../../features/gatt/CharacteristicDetailScreen';
import { GattInspectorScreen } from '../../features/gatt/GattInspectorScreen';
import { DeviceListScreen } from '../../features/scan/DeviceListScreen';
import { SessionDetailScreen } from '../../features/sessions/SessionDetailScreen';
import { SessionHistoryScreen } from '../../features/sessions/SessionHistoryScreen';

/**
 * Navigation destinations (PROJECT.md 5). Screens receive identifiers, never
 * objects, so a route stays valid when the caches update underneath it.
 */
export type RootStackParamList = {
  DeviceList: undefined;
  DeviceDetail: { deviceId: string };
  GattInspector: { deviceId: string };
  CharacteristicDetail: {
    deviceId: string;
    serviceUuid: string;
    characteristicUuid: string;
  };
  /** All recorded sessions, or only one device's when `deviceId` is given. */
  SessionHistory: { deviceId?: string };
  SessionDetail: { sessionId: string };
};

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
export type DeviceDetailRoute = RouteProp<RootStackParamList, 'DeviceDetail'>;
export type GattInspectorRoute = RouteProp<RootStackParamList, 'GattInspector'>;
export type CharacteristicDetailRoute = RouteProp<
  RootStackParamList,
  'CharacteristicDetail'
>;
export type SessionHistoryRoute = RouteProp<RootStackParamList, 'SessionHistory'>;
export type SessionDetailRoute = RouteProp<RootStackParamList, 'SessionDetail'>;

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator initialRouteName="DeviceList" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DeviceList" component={DeviceListScreen} />
      <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
      <Stack.Screen name="GattInspector" component={GattInspectorScreen} />
      <Stack.Screen name="CharacteristicDetail" component={CharacteristicDetailScreen} />
      <Stack.Screen name="SessionHistory" component={SessionHistoryScreen} />
      <Stack.Screen name="SessionDetail" component={SessionDetailScreen} />
    </Stack.Navigator>
  );
}
