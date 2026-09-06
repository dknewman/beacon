package com.beacon.bluetooth.mapping

import android.bluetooth.le.ScanCallback
import com.beacon.bluetooth.errors.BleErrorCode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ScanFailureMapperTest {

    @Test
    fun `known codes map to scan_failed with the platform code preserved`() {
        val error = ScanFailureMapper.toBleError(ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED)
        assertEquals(BleErrorCode.SCAN_FAILED, error.code)
        assertEquals("2", error.nativeCode)
        assertEquals("android.bluetooth.le.ScanCallback", error.nativeDomain)
        assertTrue(error.message!!.contains("registered"))
    }

    @Test
    fun `feature unsupported maps to bluetooth_unsupported`() {
        assertEquals(
            BleErrorCode.BLUETOOTH_UNSUPPORTED,
            ScanFailureMapper.toBleError(ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED).code,
        )
    }

    @Test
    fun `scanning too frequently is explained even below API 33`() {
        val error = ScanFailureMapper.toBleError(6)
        assertEquals(BleErrorCode.SCAN_FAILED, error.code)
        assertTrue(error.message!!.contains("5 per 30 seconds"))
    }

    @Test
    fun `unknown codes still produce a contract error`() {
        val error = ScanFailureMapper.toBleError(42)
        assertEquals(BleErrorCode.SCAN_FAILED, error.code)
        assertEquals("42", error.nativeCode)
    }
}
