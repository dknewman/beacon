package com.beacon.bluetooth.mapping

import java.util.UUID

/**
 * Parses the service UUID strings JavaScript passes to `startScan`. Accepts 16-bit ("180D"),
 * 32-bit ("0000180D"), unhyphenated 128-bit and hyphenated 128-bit forms, case-insensitively.
 * Returns null for anything else instead of throwing, so an invalid filter becomes a clean
 * `scan_failed` rejection rather than a crash.
 */
object BleUuid {
    private const val BASE_UUID_SUFFIX = "-0000-1000-8000-00805F9B34FB"
    private val HEX = Regex("^[0-9A-F]+$")

    fun parse(value: String): UUID? {
        val cleaned = value.trim().uppercase().removePrefix("0X")
        val hyphenated = when {
            cleaned.length == 4 && HEX.matches(cleaned) -> "0000$cleaned$BASE_UUID_SUFFIX"
            cleaned.length == 8 && HEX.matches(cleaned) -> "$cleaned$BASE_UUID_SUFFIX"
            cleaned.length == 32 && HEX.matches(cleaned) ->
                listOf(
                    cleaned.substring(0, 8),
                    cleaned.substring(8, 12),
                    cleaned.substring(12, 16),
                    cleaned.substring(16, 20),
                    cleaned.substring(20, 32),
                ).joinToString("-")
            cleaned.length == 36 -> cleaned
            else -> return null
        }
        return try {
            UUID.fromString(hyphenated).takeIf { it.toString().uppercase() == hyphenated }
        } catch (_: IllegalArgumentException) {
            null
        }
    }
}
