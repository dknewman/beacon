package com.beacon.bluetooth.mapping

import android.bluetooth.le.ScanCallback
import com.beacon.bluetooth.errors.BleError
import com.beacon.bluetooth.errors.BleErrorCode

/** Maps `ScanCallback.onScanFailed` codes onto the contract with a readable message. */
object ScanFailureMapper {
    /** `ScanCallback.SCAN_FAILED_SCANNING_TOO_FREQUENTLY`, hidden until API 33. */
    private const val SCAN_FAILED_SCANNING_TOO_FREQUENTLY = 6

    fun toBleError(errorCode: Int): BleError {
        val (code, message) = when (errorCode) {
            ScanCallback.SCAN_FAILED_ALREADY_STARTED ->
                BleErrorCode.SCAN_FAILED to "A scan with the same settings is already running"
            ScanCallback.SCAN_FAILED_APPLICATION_REGISTRATION_FAILED ->
                BleErrorCode.SCAN_FAILED to "The app could not be registered with the Bluetooth stack"
            ScanCallback.SCAN_FAILED_INTERNAL_ERROR ->
                BleErrorCode.SCAN_FAILED to "Internal error in the Bluetooth stack"
            ScanCallback.SCAN_FAILED_FEATURE_UNSUPPORTED ->
                BleErrorCode.BLUETOOTH_UNSUPPORTED to "This device does not support the requested scan"
            ScanCallback.SCAN_FAILED_OUT_OF_HARDWARE_RESOURCES ->
                BleErrorCode.SCAN_FAILED to "The Bluetooth radio has no scan slots left"
            SCAN_FAILED_SCANNING_TOO_FREQUENTLY ->
                BleErrorCode.SCAN_FAILED to "Scanning too frequently; Android limits scans to 5 per 30 seconds"
            else -> BleErrorCode.SCAN_FAILED to "Scan failed with code $errorCode"
        }
        return BleError(
            code = code,
            message = message,
            nativeCode = errorCode.toString(),
            nativeDomain = "android.bluetooth.le.ScanCallback",
        )
    }
}
