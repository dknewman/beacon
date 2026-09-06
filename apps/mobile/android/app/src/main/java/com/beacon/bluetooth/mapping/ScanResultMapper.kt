package com.beacon.bluetooth.mapping

import android.bluetooth.le.ScanResult
import android.os.Build
import java.util.UUID

/**
 * A discovered peripheral in the shape of `BleDevice` (`@beacon/ble-contracts`). Built by
 * [ScanResultMapper]; the module turns it into a bridge map.
 */
data class DiscoveredDevice(
    val id: String,
    val name: String?,
    val localName: String?,
    val rssi: Int?,
    val connectable: Boolean?,
    val manufacturerData: String?,
    val serviceUuids: List<String>,
    val lastSeenAt: String,
)

/**
 * Maps Android scan callbacks onto the shared device shape.
 *
 * [map] is pure (JVM types only) and unit tested; [fromScanResult] unpacks the Android
 * objects and is exercised on hardware. Manufacturer data is re-serialized with the
 * little-endian company identifier in front of each payload so the hex string matches what
 * iOS reports from the raw advertisement.
 */
object ScanResultMapper {

    fun map(
        address: String,
        deviceName: String?,
        localName: String?,
        rssi: Int?,
        connectable: Boolean?,
        manufacturerData: List<Pair<Int, ByteArray>>,
        serviceUuids: List<UUID>,
        seenAtMillis: Long,
    ): DiscoveredDevice =
        DiscoveredDevice(
            id = address,
            name = deviceName?.takeIf { it.isNotEmpty() },
            localName = localName?.takeIf { it.isNotEmpty() },
            rssi = rssi,
            connectable = connectable,
            manufacturerData = manufacturerHex(manufacturerData),
            serviceUuids = serviceUuids.map { it.toString().uppercase() }.distinct(),
            lastSeenAt = IsoTimestamp.format(seenAtMillis),
        )

    fun fromScanResult(result: ScanResult, seenAtMillis: Long): DiscoveredDevice {
        val record = result.scanRecord
        val manufacturer = mutableListOf<Pair<Int, ByteArray>>()
        record?.manufacturerSpecificData?.let { entries ->
            for (index in 0 until entries.size()) {
                manufacturer += entries.keyAt(index) to (entries.valueAt(index) ?: ByteArray(0))
            }
        }
        return map(
            address = result.device.address,
            deviceName = safeDeviceName(result),
            localName = record?.deviceName,
            rssi = result.rssi,
            connectable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) result.isConnectable else null,
            manufacturerData = manufacturer,
            serviceUuids = record?.serviceUuids?.map { it.uuid } ?: emptyList(),
            seenAtMillis = seenAtMillis,
        )
    }

    /** Uppercase hex without separators. */
    fun hex(bytes: ByteArray): String = buildString(bytes.size * 2) {
        for (byte in bytes) {
            val value = byte.toInt() and 0xFF
            append(HEX_DIGITS[value ushr 4])
            append(HEX_DIGITS[value and 0x0F])
        }
    }

    /**
     * Concatenates every manufacturer entry as `companyId (LE, 2 bytes) + payload`, which is
     * how the bytes appear in the advertisement itself. Null when there is none.
     */
    fun manufacturerHex(entries: List<Pair<Int, ByteArray>>): String? {
        if (entries.isEmpty()) return null
        return buildString {
            for ((companyId, payload) in entries) {
                append(hex(byteArrayOf((companyId and 0xFF).toByte(), ((companyId ushr 8) and 0xFF).toByte())))
                append(hex(payload))
            }
        }
    }

    /** `BluetoothDevice.name` needs BLUETOOTH_CONNECT on API 31+; treat a refusal as "no name". */
    private fun safeDeviceName(result: ScanResult): String? =
        try {
            result.device.name
        } catch (_: SecurityException) {
            null
        }

    private const val HEX_DIGITS = "0123456789ABCDEF"
}
