package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothProfile
import org.junit.Assert.assertEquals
import org.junit.Test

class ConnectionStateMapperTest {

    @Test
    fun `wire values match the TypeScript ConnectionState union`() {
        val expected = listOf(
            "disconnected",
            "connecting",
            "connected",
            "discovering_services",
            "ready",
            "disconnecting",
            "failed",
        )
        assertEquals(expected, BleConnectionState.values().map { it.wireValue })
    }

    @Test
    fun `profile states map onto the vocabulary`() {
        assertEquals(BleConnectionState.CONNECTED, ConnectionStateMapper.fromProfileState(BluetoothProfile.STATE_CONNECTED))
        assertEquals(BleConnectionState.CONNECTING, ConnectionStateMapper.fromProfileState(BluetoothProfile.STATE_CONNECTING))
        assertEquals(BleConnectionState.DISCONNECTING, ConnectionStateMapper.fromProfileState(BluetoothProfile.STATE_DISCONNECTING))
        assertEquals(BleConnectionState.DISCONNECTED, ConnectionStateMapper.fromProfileState(BluetoothProfile.STATE_DISCONNECTED))
        assertEquals(BleConnectionState.DISCONNECTED, ConnectionStateMapper.fromProfileState(-1))
    }
}
