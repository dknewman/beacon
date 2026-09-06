package com.beacon.bluetooth.mapping

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Formats epoch milliseconds as ISO-8601 with millisecond precision and a `Z` suffix, the
 * `lastSeenAt` / `timestamp` wire format validated by `isoTimestampSchema` on the JS side.
 * Uses SimpleDateFormat rather than java.time so it works on every supported API level
 * without desugaring.
 */
object IsoTimestamp {
    fun format(epochMillis: Long): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("UTC") }
            .format(Date(epochMillis))
}
