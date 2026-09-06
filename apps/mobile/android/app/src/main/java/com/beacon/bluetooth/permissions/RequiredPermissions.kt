package com.beacon.bluetooth.permissions

import android.Manifest
import android.os.Build

/**
 * The runtime permissions Beacon needs on a given API level (PROJECT.md §12: request only
 * what the running Android version actually requires).
 *
 * - API 31+: the scoped Bluetooth permissions. BLUETOOTH_SCAN is declared with
 *   `neverForLocation` in the manifest, so no location permission is involved.
 * - API 30 and below: BLE scan results are gated on fine location; the legacy BLUETOOTH
 *   permissions are install-time and need no runtime request.
 */
object RequiredPermissions {
    fun forApiLevel(sdkInt: Int): List<String> =
        if (sdkInt >= Build.VERSION_CODES.S) {
            listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
}
