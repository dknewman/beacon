package com.beacon.bluetooth.connection

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothProfile
import android.content.Context
import com.beacon.bluetooth.errors.BleError
import com.beacon.bluetooth.errors.BleErrorCode
import com.beacon.bluetooth.errors.toBleError
import com.beacon.bluetooth.mapping.BleConnectionState
import com.beacon.bluetooth.mapping.GattStatusMapper

/**
 * One peripheral's connection (PROJECT.md 28, 29): owns the `BluetoothGatt`, drives the
 * explicit state machine, and settles the bridge promises waiting on it.
 *
 * `BluetoothGattCallback` runs on a binder thread, so every mutation is guarded by the
 * instance lock; listeners and completions are invoked from within the guarded sections,
 * which is safe because they only forward to thread-safe bridge APIs.
 *
 * Errors are always reported through [Listener.onError] before the `DISCONNECTED` transition
 * they cause, matching the iOS implementation and the JavaScript reducer's expectations.
 */
class DeviceConnection(
    private val context: Context,
    private val device: BluetoothDevice,
    private val listener: Listener,
) {
    interface Listener {
        fun onStateChanged(address: String, state: BleConnectionState)
        fun onError(address: String, error: BleError)
    }

    val address: String = device.address

    var state: BleConnectionState = BleConnectionState.DISCONNECTED
        private set

    private var gatt: BluetoothGatt? = null
    private val pendingConnects = mutableListOf<(BleError?) -> Unit>()
    private val pendingDisconnects = mutableListOf<() -> Unit>()
    private val pendingRssiReads = mutableListOf<(Result<Int>) -> Unit>()
    private var disconnectRequested = false

    /** Starts (or joins) a connection attempt; `onResult(null)` once services are discovered. */
    @Synchronized
    fun connect(onResult: (BleError?) -> Unit) {
        when (state) {
            BleConnectionState.READY -> {
                onResult(null)
                return
            }
            BleConnectionState.CONNECTING,
            BleConnectionState.CONNECTED,
            BleConnectionState.DISCOVERING_SERVICES -> {
                pendingConnects += onResult
                return
            }
            BleConnectionState.DISCONNECTING -> {
                onResult(BleError(BleErrorCode.CONNECTION_FAILED, "The device is still disconnecting"))
                return
            }
            BleConnectionState.DISCONNECTED, BleConnectionState.FAILED -> Unit
        }
        disconnectRequested = false
        pendingConnects += onResult
        setState(BleConnectionState.CONNECTING)
        val opened = try {
            device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
        } catch (error: SecurityException) {
            finish(error.toBleError())
            return
        }
        if (opened == null) {
            finish(BleError(BleErrorCode.CONNECTION_FAILED, "The Bluetooth stack refused to open a connection"))
            return
        }
        gatt = opened
    }

    /** Disconnects, or cancels an attempt in progress; `onResult` once the link is gone. */
    @Synchronized
    fun disconnect(onResult: () -> Unit) {
        if (state == BleConnectionState.DISCONNECTED || state == BleConnectionState.FAILED) {
            onResult()
            return
        }
        pendingDisconnects += onResult
        disconnectRequested = true
        if (state == BleConnectionState.DISCONNECTING) return
        if (state == BleConnectionState.CONNECTING) {
            // Android does not reliably call back for a cancelled pending connection.
            closeGatt()
            finish(null)
            return
        }
        setState(BleConnectionState.DISCONNECTING)
        try {
            gatt?.disconnect()
        } catch (_: SecurityException) {
            closeGatt()
            finish(null)
        }
    }

    /** Reads the remote RSSI. Reads issued while one is in flight share its answer. */
    @Synchronized
    fun readRssi(onResult: (Result<Int>) -> Unit) {
        val active = gatt
        if (active == null || !isLinked()) {
            onResult(Result.failure(BleError(BleErrorCode.DISCONNECTED, "Not connected to $address")))
            return
        }
        val wasIdle = pendingRssiReads.isEmpty()
        pendingRssiReads += onResult
        if (!wasIdle) return
        val started = try {
            active.readRemoteRssi()
        } catch (error: SecurityException) {
            settleRssi(Result.failure(error.toBleError()))
            return
        }
        if (!started) {
            settleRssi(Result.failure(BleError(BleErrorCode.READ_FAILED, "The Bluetooth stack rejected the RSSI read")))
        }
    }

    /** Tears the connection down without waiting, for adapter loss and module invalidation. */
    @Synchronized
    fun drop(reason: BleError?) {
        if (state == BleConnectionState.DISCONNECTED) return
        closeGatt()
        finish(reason)
    }

    private fun isLinked(): Boolean =
        state == BleConnectionState.CONNECTED ||
            state == BleConnectionState.DISCOVERING_SERVICES ||
            state == BleConnectionState.READY

    private fun setState(next: BleConnectionState) {
        if (next == state) return
        state = next
        listener.onStateChanged(address, next)
    }

    /**
     * Ends the session. A non-null [error] is emitted before the `DISCONNECTED` transition;
     * null is a disconnect JavaScript asked for.
     */
    private fun finish(error: BleError?) {
        if (error != null) {
            listener.onError(address, error)
            settleConnects(error)
        } else {
            settleConnects(BleError(BleErrorCode.DISCONNECTED, "Connection cancelled"))
        }
        settleRssi(Result.failure(BleError(BleErrorCode.DISCONNECTED, "The connection ended")))
        disconnectRequested = false
        setState(BleConnectionState.DISCONNECTED)
        val waiters = pendingDisconnects.toList()
        pendingDisconnects.clear()
        waiters.forEach { it() }
    }

    private fun settleConnects(error: BleError?) {
        val completions = pendingConnects.toList()
        pendingConnects.clear()
        completions.forEach { it(error) }
    }

    private fun settleRssi(result: Result<Int>) {
        val completions = pendingRssiReads.toList()
        pendingRssiReads.clear()
        completions.forEach { it(result) }
    }

    private fun closeGatt() {
        val active = gatt ?: return
        gatt = null
        try {
            active.close()
        } catch (_: SecurityException) {
            // Permission revoked mid-session: the stack has already released the client.
        }
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        if (status != BluetoothGatt.GATT_SUCCESS) {
                            closeGatt()
                            finish(GattStatusMapper.connectionFailure(status))
                            return
                        }
                        if (state != BleConnectionState.CONNECTING) return
                        setState(BleConnectionState.CONNECTED)
                        setState(BleConnectionState.DISCOVERING_SERVICES)
                        val started = try {
                            gatt.discoverServices()
                        } catch (_: SecurityException) {
                            false
                        }
                        if (!started) {
                            listener.onError(
                                address,
                                GattStatusMapper.operationFailure(BleErrorCode.SERVICE_NOT_FOUND, "Service discovery", status),
                            )
                            settleConnects(BleError(BleErrorCode.SERVICE_NOT_FOUND, "Service discovery could not start"))
                            disconnectRequested = true
                            setState(BleConnectionState.DISCONNECTING)
                            gatt.disconnect()
                        }
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        closeGatt()
                        val error = when {
                            disconnectRequested -> null
                            state == BleConnectionState.CONNECTING -> GattStatusMapper.connectionFailure(status)
                            else -> GattStatusMapper.remoteDisconnect(status)
                        }
                        finish(error)
                    }
                    else -> Unit
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                if (state != BleConnectionState.DISCOVERING_SERVICES) return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    setState(BleConnectionState.READY)
                    settleConnects(null)
                    return
                }
                val error = GattStatusMapper.operationFailure(BleErrorCode.SERVICE_NOT_FOUND, "Service discovery", status)
                listener.onError(address, error)
                settleConnects(error)
                // A link without services is useless; close it cleanly (the error is already out).
                disconnectRequested = true
                setState(BleConnectionState.DISCONNECTING)
                try {
                    gatt.disconnect()
                } catch (_: SecurityException) {
                    closeGatt()
                    finish(null)
                }
            }
        }

        override fun onReadRemoteRssi(gatt: BluetoothGatt, rssi: Int, status: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    settleRssi(Result.success(rssi))
                } else {
                    settleRssi(Result.failure(GattStatusMapper.operationFailure(BleErrorCode.READ_FAILED, "RSSI read", status)))
                }
            }
        }
    }
}
