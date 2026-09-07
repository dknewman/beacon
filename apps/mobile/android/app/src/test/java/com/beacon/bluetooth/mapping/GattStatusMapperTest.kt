package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothStatusCodes
import com.beacon.bluetooth.errors.BleErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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

    @Test
    fun `characteristic read and write failures keep their own codes`() {
        val read = GattStatusMapper.operationFailure(BleErrorCode.READ_FAILED, "Characteristic read", BluetoothGatt.GATT_READ_NOT_PERMITTED)
        assertEquals(BleErrorCode.READ_FAILED, read.code)
        assertEquals("Characteristic read failed (status 2)", read.message)
        assertEquals("2", read.nativeCode)
        assertEquals("android.bluetooth.BluetoothGatt", read.nativeDomain)

        val write = GattStatusMapper.operationFailure(BleErrorCode.WRITE_FAILED, "Characteristic write", BluetoothGatt.GATT_WRITE_NOT_PERMITTED)
        assertEquals(BleErrorCode.WRITE_FAILED, write.code)
        assertEquals("Characteristic write failed (status 3)", write.message)
        assertEquals("3", write.nativeCode)
    }

    @Test
    fun `a refused subscription change keeps its own code and the peripheral's status`() {
        val error = GattStatusMapper.operationFailure(
            BleErrorCode.SUBSCRIPTION_FAILED,
            "Subscription change",
            BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION,
        )
        assertEquals(BleErrorCode.SUBSCRIPTION_FAILED, error.code)
        assertEquals("Subscription change failed (status 5)", error.message)
        assertEquals("5", error.nativeCode)
        assertEquals("android.bluetooth.BluetoothGatt", error.nativeDomain)
    }

    @Test
    fun `request status codes distinguish acceptance, missing permission and rejection`() {
        assertNull(GattStatusMapper.requestRejection(BleErrorCode.WRITE_FAILED, "write", BluetoothStatusCodes.SUCCESS))

        val denied = GattStatusMapper.requestRejection(
            BleErrorCode.WRITE_FAILED,
            "write",
            BluetoothStatusCodes.ERROR_MISSING_BLUETOOTH_CONNECT_PERMISSION,
        )!!
        assertEquals(BleErrorCode.PERMISSION_DENIED, denied.code)
        assertEquals("Missing Bluetooth permission", denied.message)
        assertEquals("6", denied.nativeCode)
        assertEquals("android.bluetooth.BluetoothStatusCodes", denied.nativeDomain)

        val busy = GattStatusMapper.requestRejection(
            BleErrorCode.SUBSCRIPTION_FAILED,
            "subscription",
            BluetoothStatusCodes.ERROR_GATT_WRITE_REQUEST_BUSY,
        )!!
        assertEquals(BleErrorCode.SUBSCRIPTION_FAILED, busy.code)
        assertEquals("The Bluetooth stack rejected the subscription (status 201)", busy.message)
        assertEquals("201", busy.nativeCode)
        assertEquals("android.bluetooth.BluetoothStatusCodes", busy.nativeDomain)
    }
}
