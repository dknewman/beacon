package com.beacon.bluetooth.permissions

import android.Manifest
import android.os.Build
import org.junit.Assert.assertEquals
import org.junit.Test

class RequiredPermissionsTest {

    @Test
    fun `API 31 and above use the scoped Bluetooth permissions only`() {
        val expected = listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        assertEquals(expected, RequiredPermissions.forApiLevel(Build.VERSION_CODES.S))
        assertEquals(expected, RequiredPermissions.forApiLevel(Build.VERSION_CODES.UPSIDE_DOWN_CAKE))
    }

    @Test
    fun `API 30 and below need fine location for scan results`() {
        val expected = listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        assertEquals(expected, RequiredPermissions.forApiLevel(Build.VERSION_CODES.R))
        assertEquals(expected, RequiredPermissions.forApiLevel(Build.VERSION_CODES.N))
    }

    @Test
    fun `location is never requested on API 31 and above`() {
        val permissions = RequiredPermissions.forApiLevel(Build.VERSION_CODES.S)
        assert(Manifest.permission.ACCESS_FINE_LOCATION !in permissions)
        assert(Manifest.permission.ACCESS_COARSE_LOCATION !in permissions)
    }
}
