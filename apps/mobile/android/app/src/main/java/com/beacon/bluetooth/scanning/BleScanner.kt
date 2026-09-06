package com.beacon.bluetooth.scanning

import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import com.beacon.bluetooth.errors.BleError
import com.beacon.bluetooth.errors.BleErrorCode
import com.beacon.bluetooth.errors.toBleError
import com.beacon.bluetooth.mapping.BleUuid
import com.beacon.bluetooth.mapping.DiscoveredDevice
import com.beacon.bluetooth.mapping.ScanFailureMapper
import com.beacon.bluetooth.mapping.ScanResultMapper
import com.beacon.bluetooth.permissions.RequiredPermissions

/**
 * Owns the `BluetoothLeScanner` (PROJECT.md 28). Free of React Native types.
 *
 * - Refuses to start (with a contract error) when permission is missing, the radio is off,
 *   or a filter UUID is malformed, instead of letting the platform throw.
 * - Reports one discovery per peripheral per [discoveryThrottleMs] so the bridge is not
 *   flooded by fast advertisers; JavaScript deduplicates by address.
 * - `onScanFailed` clears the scan and surfaces a `scan_failed` (or unsupported) error.
 */
class BleScanner(
    private val context: Context,
    private val clock: () -> Long = System::currentTimeMillis,
    private val sdkInt: Int = Build.VERSION.SDK_INT,
) {
    interface Listener {
        fun onDeviceDiscovered(device: DiscoveredDevice)
        fun onScanFailed(error: BleError)
    }

    private var callback: ScanCallback? = null
    private val lastReportedAt = HashMap<String, Long>()

    val isScanning: Boolean
        get() = callback != null

    /** Starts scanning; success when already scanning. */
    fun start(serviceUuids: List<String>, allowDuplicates: Boolean, listener: Listener): Result<Unit> {
        if (callback != null) return Result.success(Unit)

        val missing = RequiredPermissions.forApiLevel(sdkInt).filter {
            context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            return Result.failure(
                BleError(BleErrorCode.PERMISSION_DENIED, "Missing permission: ${missing.joinToString()}")
            )
        }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            return Result.failure(
                BleError(BleErrorCode.BLUETOOTH_UNSUPPORTED, "This device has no Bluetooth Low Energy radio")
            )
        }
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            ?: return Result.failure(BleError(BleErrorCode.BLUETOOTH_UNSUPPORTED, "No Bluetooth adapter"))
        if (!adapter.isEnabled) {
            return Result.failure(BleError(BleErrorCode.BLUETOOTH_POWERED_OFF, "Bluetooth is powered off"))
        }
        val scanner = adapter.bluetoothLeScanner
            ?: return Result.failure(BleError(BleErrorCode.BLUETOOTH_POWERED_OFF, "Bluetooth LE scanner unavailable"))

        val filters = mutableListOf<ScanFilter>()
        for (value in serviceUuids) {
            val uuid = BleUuid.parse(value)
                ?: return Result.failure(BleError(BleErrorCode.SCAN_FAILED, "Invalid service UUID: $value"))
            filters += ScanFilter.Builder().setServiceUuid(ParcelUuid(uuid)).build()
        }
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setReportDelay(0)
            .build()

        val scanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                report(result, allowDuplicates, listener)
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                results.forEach { report(it, allowDuplicates, listener) }
            }

            override fun onScanFailed(errorCode: Int) {
                if (callback !== this) return
                callback = null
                lastReportedAt.clear()
                listener.onScanFailed(ScanFailureMapper.toBleError(errorCode))
            }
        }

        return try {
            lastReportedAt.clear()
            callback = scanCallback
            scanner.startScan(filters.ifEmpty { null }, settings, scanCallback)
            Result.success(Unit)
        } catch (error: SecurityException) {
            callback = null
            Result.failure(error.toBleError())
        } catch (error: IllegalStateException) {
            // Thrown when the adapter turned off between the check and the call.
            callback = null
            Result.failure(BleError(BleErrorCode.BLUETOOTH_POWERED_OFF, error.message ?: "Bluetooth is off", cause = error))
        }
    }

    /** Stops scanning. Safe to call when not scanning or when the radio is already off. */
    fun stop() {
        val active = callback ?: return
        callback = null
        lastReportedAt.clear()
        val scanner = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)
            ?.adapter
            ?.bluetoothLeScanner
            ?: return
        try {
            scanner.stopScan(active)
        } catch (_: SecurityException) {
            // Permission revoked mid-scan: the platform has already torn the scan down.
        } catch (_: IllegalStateException) {
            // Adapter off: same, nothing left to stop.
        }
    }

    private fun report(result: ScanResult, allowDuplicates: Boolean, listener: Listener) {
        if (callback == null) return
        val address = result.device.address ?: return
        val now = clock()
        val last = lastReportedAt[address]
        if (last != null) {
            if (!allowDuplicates) return
            if (now - last < discoveryThrottleMs) return
        }
        lastReportedAt[address] = now
        listener.onDeviceDiscovered(ScanResultMapper.fromScanResult(result, now))
    }

    private companion object {
        /** Minimum spacing between two discovery events for the same peripheral. */
        const val discoveryThrottleMs = 300L
    }
}
