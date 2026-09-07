package com.beacon.bluetooth.mapping

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ByteArrayMapperTest {

    @Test
    fun `packs unsigned values into bytes`() {
        val bytes = ByteArrayMapper.fromDoubles(listOf(0.0, 1.0, 127.0, 128.0, 255.0))
        assertArrayEquals(byteArrayOf(0, 1, 127, -128, -1), bytes)
    }

    @Test
    fun `an empty payload is a valid empty write`() {
        assertArrayEquals(ByteArray(0), ByteArrayMapper.fromDoubles(emptyList()))
    }

    @Test
    fun `rejects values outside the byte range`() {
        assertNull(ByteArrayMapper.fromDoubles(listOf(0.0, 256.0)))
        assertNull(ByteArrayMapper.fromDoubles(listOf(-1.0)))
        assertNull(ByteArrayMapper.fromDoubles(listOf(Double.POSITIVE_INFINITY)))
    }

    @Test
    fun `rejects fractional and undefined values`() {
        assertNull(ByteArrayMapper.fromDoubles(listOf(1.5)))
        assertNull(ByteArrayMapper.fromDoubles(listOf(Double.NaN)))
    }

    @Test
    fun `unpacks bytes as unsigned integers`() {
        assertEquals(listOf(0, 1, 127, 128, 255), ByteArrayMapper.toUnsignedInts(byteArrayOf(0, 1, 127, -128, -1)))
        assertEquals(emptyList<Int>(), ByteArrayMapper.toUnsignedInts(ByteArray(0)))
    }

    @Test
    fun `packing and unpacking round-trip`() {
        val values = (0..255).map { it.toDouble() }
        val bytes = ByteArrayMapper.fromDoubles(values)!!
        assertEquals((0..255).toList(), ByteArrayMapper.toUnsignedInts(bytes))
    }
}
