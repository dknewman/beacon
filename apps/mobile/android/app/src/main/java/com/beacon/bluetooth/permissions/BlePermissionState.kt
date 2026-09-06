package com.beacon.bluetooth.permissions

/**
 * Permission vocabulary shared with TypeScript (`BlePermissionState` in
 * `@beacon/ble-contracts`). Wire values must match that union exactly.
 */
enum class BlePermissionState(val wireValue: String) {
    UNKNOWN("unknown"),
    NOT_REQUESTED("not_requested"),
    GRANTED("granted"),
    DENIED("denied"),
    BLOCKED("blocked"),
}
