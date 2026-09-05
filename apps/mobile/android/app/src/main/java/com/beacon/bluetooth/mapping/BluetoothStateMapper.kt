package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothAdapter

/**
 * Adapter state vocabulary shared with TypeScript (`BluetoothState` in
 * `@beacon/ble-contracts`). The wire values must match that union exactly;
 * the JavaScript side validates them at runtime and rejects anything else.
 */
enum class BleAdapterState(val wireValue: String) {
    UNKNOWN("unknown"),
    UNSUPPORTED("unsupported"),
    UNAUTHORIZED("unauthorized"),
    POWERED_OFF("powered_off"),
    POWERED_ON("powered_on"),
    RESETTING("resetting"),
}

/** Pure mapping from Android adapter states to the shared vocabulary. Unit tested without a device. */
object BluetoothStateMapper {

    /**
     * Maps `BluetoothAdapter.getState()` values.
     *
     * `STATE_TURNING_ON` and `STATE_TURNING_OFF` are reported as `POWERED_OFF`: the radio is not
     * usable until `STATE_ON` arrives, and Android broadcasts again when the transition finishes.
     * `RESETTING` is an iOS-only state and is never produced here.
     */
    fun fromAdapterState(state: Int): BleAdapterState =
        when (state) {
            BluetoothAdapter.STATE_ON -> BleAdapterState.POWERED_ON
            BluetoothAdapter.STATE_OFF,
            BluetoothAdapter.STATE_TURNING_ON,
            BluetoothAdapter.STATE_TURNING_OFF -> BleAdapterState.POWERED_OFF
            else -> BleAdapterState.UNKNOWN
        }
}
