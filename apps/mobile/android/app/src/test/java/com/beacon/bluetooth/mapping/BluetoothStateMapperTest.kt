package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothAdapter
import org.junit.Assert.assertEquals
import org.junit.Test

class BluetoothStateMapperTest {

    @Test
    fun `STATE_ON maps to powered_on`() {
        assertEquals(BleAdapterState.POWERED_ON, BluetoothStateMapper.fromAdapterState(BluetoothAdapter.STATE_ON))
    }

    @Test
    fun `off and transitional states map to powered_off`() {
        listOf(
            BluetoothAdapter.STATE_OFF,
            BluetoothAdapter.STATE_TURNING_ON,
            BluetoothAdapter.STATE_TURNING_OFF,
        ).forEach { raw ->
            assertEquals("raw=$raw", BleAdapterState.POWERED_OFF, BluetoothStateMapper.fromAdapterState(raw))
        }
    }

    @Test
    fun `unrecognized values map to unknown`() {
        assertEquals(BleAdapterState.UNKNOWN, BluetoothStateMapper.fromAdapterState(BluetoothAdapter.ERROR))
        assertEquals(BleAdapterState.UNKNOWN, BluetoothStateMapper.fromAdapterState(-42))
    }

    @Test
    fun `wire values match the TypeScript BluetoothState union`() {
        val expected = listOf("unknown", "unsupported", "unauthorized", "powered_off", "powered_on", "resetting")
        assertEquals(expected, BleAdapterState.values().map { it.wireValue })
    }
}
