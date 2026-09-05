package com.beacon.bluetooth.errors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class BleErrorTest {

    @Test
    fun `wire values match the TypeScript BleErrorCode union`() {
        val expected = listOf(
            "bluetooth_unsupported",
            "bluetooth_powered_off",
            "permission_denied",
            "scan_failed",
            "device_not_found",
            "connection_timeout",
            "connection_failed",
            "disconnected",
            "service_not_found",
            "characteristic_not_found",
            "read_failed",
            "write_failed",
            "subscription_failed",
            "invalid_payload",
            "native_failure",
            "unknown",
        )
        assertEquals(expected, BleErrorCode.values().map { it.wireValue })
    }

    @Test
    fun `SecurityException maps to permission_denied`() {
        val error = SecurityException("Need BLUETOOTH_CONNECT").toBleError()
        assertEquals(BleErrorCode.PERMISSION_DENIED, error.code)
        assertEquals("Need BLUETOOTH_CONNECT", error.message)
        assertEquals("java.lang.SecurityException", error.nativeDomain)
    }

    @Test
    fun `other exceptions use the fallback code and keep the class as domain`() {
        val error = IllegalStateException("adapter gone").toBleError()
        assertEquals(BleErrorCode.NATIVE_FAILURE, error.code)
        assertEquals("java.lang.IllegalStateException", error.nativeDomain)
        assertEquals(BleErrorCode.SCAN_FAILED, RuntimeException("x").toBleError(BleErrorCode.SCAN_FAILED).code)
    }

    @Test
    fun `BleError passes through unchanged`() {
        val original = BleError(BleErrorCode.READ_FAILED, "nope", nativeCode = "133")
        assertSame(original, original.toBleError())
    }
}
