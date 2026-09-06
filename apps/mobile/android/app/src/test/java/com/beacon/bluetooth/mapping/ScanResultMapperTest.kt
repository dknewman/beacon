package com.beacon.bluetooth.mapping

import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ScanResultMapperTest {

    private val seenAt = 1_788_713_241_500L

    @Test
    fun `maps every advertisement field`() {
        val device = ScanResultMapper.map(
            address = "AA:BB:CC:DD:EE:FF",
            deviceName = "Polar H10",
            localName = "Polar H10 1A2B3C",
            rssi = -55,
            connectable = true,
            manufacturerData = listOf(0x006B to byteArrayOf(0x01, 0xAB.toByte())),
            serviceUuids = listOf(
                UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb"),
                UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb"),
                UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb"),
            ),
            seenAtMillis = seenAt,
        )

        assertEquals("AA:BB:CC:DD:EE:FF", device.id)
        assertEquals("Polar H10", device.name)
        assertEquals("Polar H10 1A2B3C", device.localName)
        assertEquals(-55, device.rssi)
        assertEquals(true, device.connectable)
        assertEquals("6B0001AB", device.manufacturerData)
        assertEquals(
            listOf("0000180D-0000-1000-8000-00805F9B34FB", "0000180F-0000-1000-8000-00805F9B34FB"),
            device.serviceUuids,
        )
        assertEquals("2026-09-06T16:47:21.500Z", device.lastSeenAt)
    }

    @Test
    fun `omits empty names and absent manufacturer data`() {
        val device = ScanResultMapper.map(
            address = "AA:BB:CC:DD:EE:FF",
            deviceName = "",
            localName = null,
            rssi = null,
            connectable = null,
            manufacturerData = emptyList(),
            serviceUuids = emptyList(),
            seenAtMillis = seenAt,
        )
        assertNull(device.name)
        assertNull(device.localName)
        assertNull(device.rssi)
        assertNull(device.connectable)
        assertNull(device.manufacturerData)
        assertEquals(emptyList<String>(), device.serviceUuids)
    }

    @Test
    fun `manufacturer data is prefixed with the little-endian company id per entry`() {
        assertEquals(
            "4C000215" + "FFFF0A",
            ScanResultMapper.manufacturerHex(
                listOf(0x004C to byteArrayOf(0x02, 0x15), 0xFFFF to byteArrayOf(0x0A)),
            ),
        )
    }

    @Test
    fun `hex encoding is uppercase without separators`() {
        assertEquals("000AFF", ScanResultMapper.hex(byteArrayOf(0x00, 0x0A, 0xFF.toByte())))
        assertEquals("", ScanResultMapper.hex(ByteArray(0)))
    }
}
