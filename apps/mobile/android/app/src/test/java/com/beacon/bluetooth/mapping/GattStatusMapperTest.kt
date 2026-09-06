package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothGatt
import com.beacon.bluetooth.errors.BleErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GattStatusMapperTest {

    @Test
    fun `connection failures distinguish timeouts from other errors`() {
        assertEquals(BleErrorCode.CONNECTION_TIMEOUT, GattStatusMapper.connectionFailure(GattStatusMapper.GATT_CONN_TIMEOUT).code)
        assertEquals(BleErrorCode.CONNECTION_TIMEOUT, GattStatusMapper.connectionFailure(GattStatusMapper.GATT_CONN_FAIL_ESTABLISH).code)
        val generic = GattStatusMapper.connectionFailure(GattStatusMapper.GATT_ERROR)
        assertEquals(BleErrorCode.CONNECTION_FAILED, generic.code)
        assertEquals("133", generic.nativeCode)
        assertEquals("android.bluetooth.BluetoothGatt", generic.nativeDomain)
    }

    @Test
    fun `remote disconnects always map to disconnected with a readable reason`() {
        val closed = GattStatusMapper.remoteDisconnect(BluetoothGatt.GATT_SUCCESS)
        assertEquals(BleErrorCode.DISCONNECTED, closed.code)
        assertTrue(closed.message!!.contains("closed"))
        val timeout = GattStatusMapper.remoteDisconnect(GattStatusMapper.GATT_CONN_TIMEOUT)
        assertEquals(BleErrorCode.DISCONNECTED, timeout.code)
        assertTrue(timeout.message!!.contains("out of range"))
        assertEquals("8", timeout.nativeCode)
    }

    @Test
    fun `operation failures carry the operation and status`() {
        val error = GattStatusMapper.operationFailure(BleErrorCode.SERVICE_NOT_FOUND, "Service discovery", 129)
        assertEquals(BleErrorCode.SERVICE_NOT_FOUND, error.code)
        assertEquals("Service discovery failed (status 129)", error.message)
        assertEquals("129", error.nativeCode)
    }
}
