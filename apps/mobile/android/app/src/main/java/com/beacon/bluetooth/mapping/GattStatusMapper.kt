package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothStatusCodes
import com.beacon.bluetooth.errors.BleError
import com.beacon.bluetooth.errors.BleErrorCode

/**
 * Maps `BluetoothGattCallback` status codes, and the `BluetoothStatusCodes` Android 13 returns
 * when a request is handed to the stack, onto the contract. The Android stack reports many
 * failures through the same callback, so the operation that failed picks the fallback code and
 * the platform status is kept in `nativeCode` for developer mode.
 */
object GattStatusMapper {
    /** Undocumented but ubiquitous: the stack could not establish or keep the link. */
    const val GATT_ERROR = 0x85
    /** HCI "connection timeout": the peripheral stopped answering. */
    const val GATT_CONN_TIMEOUT = 0x08
    /** HCI "remote user terminated connection". */
    const val GATT_CONN_TERMINATE_PEER_USER = 0x13
    /** HCI "connection terminated by local host". */
    const val GATT_CONN_TERMINATE_LOCAL_HOST = 0x16
    /** Stack could not find the remote LMP entry; usually the peripheral went out of range. */
    const val GATT_CONN_FAIL_ESTABLISH = 0x3E

    /** Describes a failed connection attempt (`onConnectionStateChange` while connecting). */
    fun connectionFailure(status: Int): BleError =
        when (status) {
            GATT_CONN_TIMEOUT, GATT_CONN_FAIL_ESTABLISH ->
                error(BleErrorCode.CONNECTION_TIMEOUT, "The device did not answer in time", status)
            else -> error(BleErrorCode.CONNECTION_FAILED, "Could not connect (status $status)", status)
        }

    /** Describes a link that ended without JavaScript asking for it. */
    fun remoteDisconnect(status: Int): BleError =
        when (status) {
            BluetoothGatt.GATT_SUCCESS ->
                error(BleErrorCode.DISCONNECTED, "The device closed the connection", status)
            GATT_CONN_TERMINATE_PEER_USER ->
                error(BleErrorCode.DISCONNECTED, "The device closed the connection", status)
            GATT_CONN_TIMEOUT ->
                error(BleErrorCode.DISCONNECTED, "The connection timed out; the device may be out of range", status)
            else -> error(BleErrorCode.DISCONNECTED, "The connection was lost (status $status)", status)
        }

    /** Describes a failed service discovery or other GATT operation. */
    fun operationFailure(code: BleErrorCode, operation: String, status: Int): BleError =
        error(code, "$operation failed (status $status)", status)

    /**
     * Interprets the status Android 13 and later return when a request such as
     * `writeCharacteristic` or `writeDescriptor` is handed to the stack: null once the stack
     * accepted it (its callback will follow), otherwise the error to settle with. A missing
     * permission keeps its own code; anything else is a [code] failure naming the [operation].
     */
    fun requestRejection(code: BleErrorCode, operation: String, status: Int): BleError? =
        when (status) {
            BluetoothStatusCodes.SUCCESS -> null
            BluetoothStatusCodes.ERROR_MISSING_BLUETOOTH_CONNECT_PERMISSION ->
                BleError(
                    code = BleErrorCode.PERMISSION_DENIED,
                    message = "Missing Bluetooth permission",
                    nativeCode = status.toString(),
                    nativeDomain = "android.bluetooth.BluetoothStatusCodes",
                )
            else ->
                BleError(
                    code = code,
                    message = "The Bluetooth stack rejected the $operation (status $status)",
                    nativeCode = status.toString(),
                    nativeDomain = "android.bluetooth.BluetoothStatusCodes",
                )
        }

    private fun error(code: BleErrorCode, message: String, status: Int): BleError =
        BleError(
            code = code,
            message = message,
            nativeCode = status.toString(),
            nativeDomain = "android.bluetooth.BluetoothGatt",
        )
}
