package com.beacon.bluetooth.errors

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise

/**
 * Error codes shared with TypeScript (`BleErrorCode` in `@beacon/ble-contracts`).
 * Wire values must match that union exactly.
 */
enum class BleErrorCode(val wireValue: String) {
    BLUETOOTH_UNSUPPORTED("bluetooth_unsupported"),
    BLUETOOTH_POWERED_OFF("bluetooth_powered_off"),
    PERMISSION_DENIED("permission_denied"),
    SCAN_FAILED("scan_failed"),
    DEVICE_NOT_FOUND("device_not_found"),
    CONNECTION_TIMEOUT("connection_timeout"),
    CONNECTION_FAILED("connection_failed"),
    DISCONNECTED("disconnected"),
    SERVICE_NOT_FOUND("service_not_found"),
    CHARACTERISTIC_NOT_FOUND("characteristic_not_found"),
    READ_FAILED("read_failed"),
    WRITE_FAILED("write_failed"),
    SUBSCRIPTION_FAILED("subscription_failed"),
    INVALID_PAYLOAD("invalid_payload"),
    NATIVE_FAILURE("native_failure"),
    UNKNOWN("unknown"),
}

/** A BLE failure with a contract code plus optional platform diagnostics for developer mode. */
class BleError(
    val code: BleErrorCode,
    message: String,
    val nativeCode: String? = null,
    val nativeDomain: String? = null,
    cause: Throwable? = null,
) : Exception(message, cause)

/**
 * Rejects a bridge promise so that the JavaScript `Error` carries `code` (read by
 * `toBleError`) and the native diagnostics as extra properties (React Native merges
 * the userInfo map onto the rejection error object).
 */
fun Promise.rejectWith(error: BleError) {
    val userInfo = Arguments.createMap().apply {
        error.nativeCode?.let { putString("nativeCode", it) }
        error.nativeDomain?.let { putString("nativeDomain", it) }
    }
    reject(error.code.wireValue, error.message ?: error.code.wireValue, error.cause, userInfo)
}

/** Maps arbitrary exceptions thrown by Android Bluetooth APIs to a BleError. */
fun Throwable.toBleError(fallback: BleErrorCode = BleErrorCode.NATIVE_FAILURE): BleError =
    when (this) {
        is BleError -> this
        is SecurityException ->
            BleError(
                code = BleErrorCode.PERMISSION_DENIED,
                message = message ?: "Missing Bluetooth permission",
                nativeDomain = javaClass.name,
                cause = this,
            )
        else ->
            BleError(
                code = fallback,
                message = message ?: javaClass.simpleName,
                nativeDomain = javaClass.name,
                cause = this,
            )
    }
