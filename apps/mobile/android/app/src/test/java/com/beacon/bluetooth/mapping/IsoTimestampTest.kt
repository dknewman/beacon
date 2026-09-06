package com.beacon.bluetooth.mapping

import org.junit.Assert.assertEquals
import org.junit.Test

class IsoTimestampTest {

    @Test
    fun `formats UTC with millisecond precision`() {
        assertEquals("2026-09-06T16:47:21.301Z", IsoTimestamp.format(1_788_713_241_301L))
        assertEquals("1970-01-01T00:00:00.000Z", IsoTimestamp.format(0L))
    }
}
