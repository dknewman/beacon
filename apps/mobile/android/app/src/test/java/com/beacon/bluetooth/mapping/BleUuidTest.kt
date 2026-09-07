package com.beacon.bluetooth.mapping

import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BleUuidTest {

    @Test
    fun `formats platform UUIDs in the uppercase hyphenated wire form`() {
        assertEquals(
            "6E400001-B5A3-F393-E0A9-E50E24DCCA9E",
            BleUuid.format(UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")),
        )
        assertEquals("0000180D-0000-1000-8000-00805F9B34FB", BleUuid.format(BleUuid.parse("180d")!!))
    }

    @Test
    fun `expands short and medium forms with the Bluetooth base UUID`() {
        assertEquals("0000180d-0000-1000-8000-00805f9b34fb", BleUuid.parse("180d").toString())
        assertEquals("0000180d-0000-1000-8000-00805f9b34fb", BleUuid.parse(" 0x180D ").toString())
        assertEquals("0000180d-0000-1000-8000-00805f9b34fb", BleUuid.parse("0000180D").toString())
    }

    @Test
    fun `accepts hyphenated and unhyphenated 128-bit forms`() {
        val expected = "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
        assertEquals(expected, BleUuid.parse("6E400001B5A3F393E0A9E50E24DCCA9E").toString())
        assertEquals(expected, BleUuid.parse("6e400001-b5a3-f393-e0a9-e50e24dcca9e").toString())
    }

    @Test
    fun `rejects malformed input instead of throwing`() {
        assertNull(BleUuid.parse(""))
        assertNull(BleUuid.parse("heart-rate"))
        assertNull(BleUuid.parse("180G"))
        assertNull(BleUuid.parse("0000180D-0000-1000-8000-00805F9B34F"))
        assertNull(BleUuid.parse("0000180D-0000-1000-8000-00805F9B34FBB"))
    }
}
