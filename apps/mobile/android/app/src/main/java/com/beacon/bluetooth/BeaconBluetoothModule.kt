package com.beacon.bluetooth

import com.beacon.bluetooth.connection.ConnectionRegistry
import com.beacon.bluetooth.connection.DeviceConnection
import com.beacon.bluetooth.errors.BleError
import com.beacon.bluetooth.errors.BleErrorCode
import com.beacon.bluetooth.errors.rejectWith
import com.beacon.bluetooth.errors.toBleError
import com.beacon.bluetooth.mapping.BleAdapterState
import com.beacon.bluetooth.mapping.BleConnectionState
import com.beacon.bluetooth.mapping.DiscoveredDevice
import com.beacon.bluetooth.permissions.PermissionController
import com.beacon.bluetooth.scanning.BleScanner
import com.beacon.bluetooth.spec.NativeBeaconBluetoothSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.PermissionAwareActivity

/**
 * Turbo Native Module bridging the TypeScript spec (NativeBeaconBluetooth.ts) to
 * [BluetoothController], [PermissionController], [BleScanner] and [ConnectionRegistry]. Keep
 * this class thin: it maps calls and events, and owns nothing about Bluetooth itself.
 */
class BeaconBluetoothModule(reactContext: ReactApplicationContext) :
    NativeBeaconBluetoothSpec(reactContext),
    BluetoothController.Listener,
    BleScanner.Listener,
    DeviceConnection.Listener {

    private val controller = BluetoothController(reactContext.applicationContext)
    private val permissions = PermissionController(reactContext.applicationContext)
    private val scanner = BleScanner(reactContext.applicationContext)
    private val connections = ConnectionRegistry(reactContext.applicationContext, this)

    override fun initialize() {
        super.initialize()
        controller.start(this)
    }

    override fun invalidate() {
        scanner.stop()
        connections.dropAll(BleError(BleErrorCode.DISCONNECTED, "Bluetooth module invalidated"))
        controller.stop()
        super.invalidate()
    }

    override fun getBluetoothState(promise: Promise) {
        try {
            promise.resolve(controller.currentAdapterState().wireValue)
        } catch (error: Exception) {
            promise.rejectWith(error.toBleError())
        }
    }

    override fun getPermissionState(promise: Promise) {
        try {
            promise.resolve(permissions.currentState(reactApplicationContext.currentActivity).wireValue)
        } catch (error: Exception) {
            promise.rejectWith(error.toBleError())
        }
    }

    override fun requestPermission(promise: Promise) {
        val activity = reactApplicationContext.currentActivity as? PermissionAwareActivity
        permissions.request(activity) { result ->
            result.fold(
                onSuccess = { promise.resolve(it.wireValue) },
                onFailure = { promise.rejectWith(it.toBleError()) },
            )
        }
    }

    override fun startScan(serviceUuids: ReadableArray, allowDuplicates: Boolean, promise: Promise) {
        val uuids = (0 until serviceUuids.size()).mapNotNull { serviceUuids.getString(it) }
        scanner.start(uuids, allowDuplicates, this).fold(
            onSuccess = { promise.resolve(null) },
            onFailure = { promise.rejectWith(it.toBleError(fallback = BleErrorCode.SCAN_FAILED)) },
        )
    }

    override fun stopScan(promise: Promise) {
        try {
            scanner.stop()
            promise.resolve(null)
        } catch (error: Exception) {
            promise.rejectWith(error.toBleError())
        }
    }

    override fun connect(deviceId: String, promise: Promise) {
        connections.connect(deviceId) { error ->
            if (error == null) promise.resolve(null) else promise.rejectWith(error)
        }
    }

    override fun disconnect(deviceId: String, promise: Promise) {
        connections.disconnect(deviceId) { promise.resolve(null) }
    }

    override fun readRssi(deviceId: String, promise: Promise) {
        connections.readRssi(deviceId) { result ->
            result.fold(
                onSuccess = { promise.resolve(it) },
                onFailure = { promise.rejectWith(it.toBleError(fallback = BleErrorCode.READ_FAILED)) },
            )
        }
    }

    override fun onAdapterStateChanged(state: BleAdapterState) {
        // The emitter callback is bound by the TurboModule infrastructure once JavaScript
        // has resolved this module. Broadcasts before that have no subscriber to reach;
        // JS reads the current state explicitly on startup, so nothing is lost.
        if (mEventEmitterCallback == null) return
        if (state != BleAdapterState.POWERED_ON) {
            // The platform drops the scan and every link when the radio goes away; forget them
            // here so the next start is a real start rather than an "already active" no-op.
            scanner.stop()
            connections.dropAll(BleError(BleErrorCode.BLUETOOTH_POWERED_OFF, "Bluetooth is no longer available"))
        }
        val payload = Arguments.createMap().apply { putString("state", state.wireValue) }
        emitOnBluetoothStateChanged(payload)
    }

    override fun onDeviceDiscovered(device: DiscoveredDevice) {
        if (mEventEmitterCallback == null) return
        emitOnDeviceDiscovered(device.toWritableMap())
    }

    override fun onScanFailed(error: BleError) {
        emitError(deviceId = null, error = error)
    }

    override fun onStateChanged(address: String, state: BleConnectionState) {
        if (mEventEmitterCallback == null) return
        val payload = Arguments.createMap().apply {
            putString("deviceId", address)
            putString("state", state.wireValue)
        }
        emitOnConnectionStateChanged(payload)
    }

    override fun onError(address: String, error: BleError) {
        emitError(deviceId = address, error = error)
    }

    private fun emitError(deviceId: String?, error: BleError) {
        if (mEventEmitterCallback == null) return
        val payload = Arguments.createMap().apply {
            deviceId?.let { putString("deviceId", it) }
            putMap("error", error.toWritableMap())
        }
        emitOnBleError(payload)
    }
}

/** Bridge form of [BleError]; matches `BleErrorPayload` in the codegen spec. */
private fun BleError.toWritableMap(): WritableMap =
    Arguments.createMap().apply {
        putString("code", code.wireValue)
        putString("message", message ?: code.wireValue)
        nativeCode?.let { putString("nativeCode", it) }
        nativeDomain?.let { putString("nativeDomain", it) }
    }

/** Bridge form of [DiscoveredDevice]; absent optionals are omitted so zod sees `undefined`. */
private fun DiscoveredDevice.toWritableMap(): WritableMap =
    Arguments.createMap().apply {
        putString("id", id)
        name?.let { putString("name", it) }
        localName?.let { putString("localName", it) }
        rssi?.let { putInt("rssi", it) }
        connectable?.let { putBoolean("connectable", it) }
        manufacturerData?.let { putString("manufacturerData", it) }
        putArray("serviceUuids", Arguments.createArray().apply { serviceUuids.forEach { pushString(it) } })
        putString("lastSeenAt", lastSeenAt)
    }
