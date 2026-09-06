import React from 'react';
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { DeviceDetailScreen } from '../../features/connection/DeviceDetailScreen';
import { DeviceListScreen } from '../../features/scan/DeviceListScreen';

/**
 * Navigation destinations (PROJECT.md 5). Screens receive identifiers, never
 * objects, so a route stays valid when the device cache updates underneath it.
 */
export type RootStackParamList = {
  DeviceList: undefined;
  DeviceDetail: { deviceId: string };
};

export type RootNavigation = NativeStackNavigationProp<RootStackParamList>;
export type DeviceDetailRoute = RouteProp<RootStackParamList, 'DeviceDetail'>;

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator initialRouteName="DeviceList" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="DeviceList" component={DeviceListScreen} />
      <Stack.Screen name="DeviceDetail" component={DeviceDetailScreen} />
    </Stack.Navigator>
  );
}
