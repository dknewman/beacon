package com.beacon.bluetooth.permissions

import org.junit.Assert.assertEquals
import org.junit.Test

class PermissionStateMapperTest {

    @Test
    fun `granted wins regardless of history`() {
        assertEquals(BlePermissionState.GRANTED, PermissionStateMapper.resolve(true, null, false))
        assertEquals(BlePermissionState.GRANTED, PermissionStateMapper.resolve(true, false, true))
    }

    @Test
    fun `never requested is not_requested even though rationale is false`() {
        assertEquals(BlePermissionState.NOT_REQUESTED, PermissionStateMapper.resolve(false, false, false))
        assertEquals(BlePermissionState.NOT_REQUESTED, PermissionStateMapper.resolve(false, null, false))
    }

    @Test
    fun `denied once can be asked again`() {
        assertEquals(BlePermissionState.DENIED, PermissionStateMapper.resolve(false, true, true))
    }

    @Test
    fun `denied with no activity to ask stays re-promptable`() {
        assertEquals(BlePermissionState.DENIED, PermissionStateMapper.resolve(false, null, true))
    }

    @Test
    fun `requested before with no rationale is blocked`() {
        assertEquals(BlePermissionState.BLOCKED, PermissionStateMapper.resolve(false, false, true))
    }

    @Test
    fun `wire values match the TypeScript BlePermissionState union`() {
        val expected = listOf("unknown", "not_requested", "granted", "denied", "blocked")
        assertEquals(expected, BlePermissionState.values().map { it.wireValue })
    }
}
