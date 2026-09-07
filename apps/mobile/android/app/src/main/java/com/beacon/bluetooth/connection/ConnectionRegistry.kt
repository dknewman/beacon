package com.beacon.bluetooth.connection

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.beacon.bluetooth.errors.BleError
import com.beacon.bluetooth.errors.BleErrorCode
import com.beacon.bluetooth.mapping.DiscoveredService
import com.beacon.bluetooth.permissions.RequiredPermissions

/**
 * Owns one [DeviceConnection] per address and performs the pre-flight checks every connection
 * call shares (permission, radio, address validity), so failures become contract errors
 * instead of platform exceptions.
 */
class ConnectionRegistry(
    private val context: Context,
    private val listener: DeviceConnection.Listener,
    private val sdkInt: Int = Build.VERSION.SDK_INT,
) {
    private val connections = HashMap<String, DeviceConnection>()

    @Synchronized
    fun connect(deviceId: String, onResult: (BleError?) -> Unit) {
        val adapter = when (val preflight = preflight()) {
            is Preflight.Failure -> {
                onResult(preflight.error)
                return
            }
            is Preflight.Ready -> preflight.adapter
        }
        if (!BluetoothAdapter.checkBluetoothAddress(deviceId)) {
            onResult(BleError(BleErrorCode.DEVICE_NOT_FOUND, "Not a Bluetooth address: $deviceId"))
            return
        }
        val connection = connections.getOrPut(deviceId) {
            DeviceConnection(context, adapter.getRemoteDevice(deviceId), listener)
        }
        connection.connect(onResult)
    }

    @Synchronized
    fun disconnect(deviceId: String, onResult: () -> Unit) {
        val connection = connections[deviceId]
        if (connection == null) {
            onResult()
            return
        }
        connection.disconnect(onResult)
    }

    @Synchronized
    fun readRssi(deviceId: String, onResult: (Result<Int>) -> Unit) {
        val connection = connections[deviceId]
        if (connection == null) {
            onResult(Result.failure(BleError(BleErrorCode.DISCONNECTED, "Not connected to $deviceId")))
            return
        }
        connection.readRssi(onResult)
    }

    @Synchronized
    fun discoverServices(deviceId: String, onResult: (Result<List<DiscoveredService>>) -> Unit) {
        val connection = connections[deviceId]
        if (connection == null) {
            onResult(Result.failure(BleError(BleErrorCode.DISCONNECTED, "Not connected to $deviceId")))
            return
        }
        connection.discoverServices(onResult)
    }

    @Synchronized
    fun readCharacteristic(
        deviceId: String,
        serviceUuid: String,
        characteristicUuid: String,
        onResult: (Result<ByteArray>) -> Unit,
    ) {
        val connection = connections[deviceId]
        if (connection == null) {
            onResult(Result.failure(BleError(BleErrorCode.DISCONNECTED, "Not connected to $deviceId")))
            return
        }
        connection.readCharacteristic(serviceUuid, characteristicUuid, onResult)
    }

    @Synchronized
    fun writeCharacteristic(
        deviceId: String,
        serviceUuid: String,
        characteristicUuid: String,
        bytes: ByteArray,
        withResponse: Boolean,
        onResult: (BleError?) -> Unit,
    ) {
        val connection = connections[deviceId]
        if (connection == null) {
            onResult(BleError(BleErrorCode.DISCONNECTED, "Not connected to $deviceId"))
            return
        }
        connection.writeCharacteristic(serviceUuid, characteristicUuid, bytes, withResponse, onResult)
    }

    @Synchronized
    fun setNotify(
        deviceId: String,
        serviceUuid: String,
        characteristicUuid: String,
        enabled: Boolean,
        onResult: (BleError?) -> Unit,
    ) {
        val connection = connections[deviceId]
        if (connection == null) {
            onResult(BleError(BleErrorCode.DISCONNECTED, "Not connected to $deviceId"))
            return
        }
        connection.setNotify(serviceUuid, characteristicUuid, enabled, onResult)
    }

    /** Ends every connection; the platform has already dropped them when the radio goes away. */
    @Synchronized
    fun dropAll(reason: BleError?) {
        connections.values.forEach { it.drop(reason) }
    }

    private sealed interface Preflight {
        class Ready(val adapter: BluetoothAdapter) : Preflight
        class Failure(val error: BleError) : Preflight
    }

    private fun preflight(): Preflight {
        val missing = RequiredPermissions.forApiLevel(sdkInt).filter {
            context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isNotEmpty()) {
            return Preflight.Failure(
                BleError(BleErrorCode.PERMISSION_DENIED, "Missing permission: ${missing.joinToString()}")
            )
        }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            return Preflight.Failure(
                BleError(BleErrorCode.BLUETOOTH_UNSUPPORTED, "This device has no Bluetooth Low Energy radio")
            )
        }
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            ?: return Preflight.Failure(BleError(BleErrorCode.BLUETOOTH_UNSUPPORTED, "No Bluetooth adapter"))
        if (!adapter.isEnabled) {
            return Preflight.Failure(BleError(BleErrorCode.BLUETOOTH_POWERED_OFF, "Bluetooth is powered off"))
        }
        return Preflight.Ready(adapter)
    }
}
