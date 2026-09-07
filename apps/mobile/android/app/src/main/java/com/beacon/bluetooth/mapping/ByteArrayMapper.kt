package com.beacon.bluetooth.mapping

/**
 * Converts between the bridge's byte representation (`number[]` of unsigned values) and the
 * `ByteArray` the Android GATT APIs take. Pure Kotlin so the validation is unit tested on the
 * JVM; the module unpacks the `ReadableArray` into the list this consumes.
 */
object ByteArrayMapper {

    /**
     * The payload as bytes, or null when any value is not an integer in 0..255 (PROJECT.md 16:
     * "reject bytes above 255"). JavaScript numbers arrive as doubles, so fractional values and
     * NaN are rejected as well.
     */
    fun fromDoubles(values: List<Double>): ByteArray? {
        val bytes = ByteArray(values.size)
        for ((index, value) in values.withIndex()) {
            if (value.isNaN() || value < 0.0 || value > 255.0 || value != Math.floor(value)) return null
            bytes[index] = value.toInt().toByte()
        }
        return bytes
    }

    /** The bytes as unsigned integers 0..255, the form `readCharacteristic` resolves with. */
    fun toUnsignedInts(bytes: ByteArray): List<Int> = bytes.map { it.toInt() and 0xFF }
}
