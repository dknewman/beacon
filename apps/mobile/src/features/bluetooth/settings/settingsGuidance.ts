import { Linking, Platform } from 'react-native';

/**
 * Deep links into system settings. Kept in one place because the platforms
 * differ: Android exposes an intent for the Bluetooth screen, iOS only allows
 * opening the app's own settings page.
 */

/** Opens the app's settings page (permission toggles live here on both platforms). */
export function openAppSettings(): Promise<void> {
  return Linking.openSettings();
}

/** Opens the system Bluetooth screen on Android; falls back to app settings on iOS. */
export function openBluetoothSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    return Linking.sendIntent('android.settings.BLUETOOTH_SETTINGS');
  }
  return Linking.openSettings();
}
