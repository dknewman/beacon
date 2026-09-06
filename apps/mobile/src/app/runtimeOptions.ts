/**
 * Build-time switches read by the composition root.
 *
 * `USE_MOCK_BLE_CLIENT` replaces the native bridge with the scripted mock
 * (src/mock), so the app can be exercised on a simulator, on a phone without
 * peripherals nearby, or by a reviewer without hardware. Flip it locally; it
 * must stay `false` on main so CI builds always exercise the real bridge.
 */
export const USE_MOCK_BLE_CLIENT = false;
