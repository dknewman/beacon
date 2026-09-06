package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothProfile

/**
 * Connection vocabulary shared with TypeScript (`ConnectionState` in `@beacon/ble-contracts`).
 * Wire values must match that union exactly.
 */
enum class BleConnectionState(val wireValue: String) {
    DISCONNECTED("disconnected"),
    CONNECTING("connecting"),
    CONNECTED("connected"),
    DISCOVERING_SERVICES("discovering_services"),
    READY("ready"),
    DISCONNECTING("disconnecting"),
    FAILED("failed"),
}

/** Pure mapping from `BluetoothProfile` connection states, used for platform callbacks. */
object ConnectionStateMapper {
    fun fromProfileState(state: Int): BleConnectionState =
        when (state) {
            BluetoothProfile.STATE_CONNECTED -> BleConnectionState.CONNECTED
            BluetoothProfile.STATE_CONNECTING -> BleConnectionState.CONNECTING
            BluetoothProfile.STATE_DISCONNECTING -> BleConnectionState.DISCONNECTING
            else -> BleConnectionState.DISCONNECTED
        }
}
