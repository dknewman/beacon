package com.beacon.bluetooth

import com.beacon.bluetooth.errors.rejectWith
import com.beacon.bluetooth.errors.toBleError
import com.beacon.bluetooth.mapping.BleAdapterState
import com.beacon.bluetooth.spec.NativeBeaconBluetoothSpec
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext

/**
 * Turbo Native Module bridging the TypeScript spec (NativeBeaconBluetooth.ts) to
 * [BluetoothController]. Keep this class thin: it maps calls and events, and
 * owns nothing about Bluetooth itself.
 */
class BeaconBluetoothModule(reactContext: ReactApplicationContext) :
    NativeBeaconBluetoothSpec(reactContext), BluetoothController.Listener {

    private val controller = BluetoothController(reactContext.applicationContext)

    override fun initialize() {
        super.initialize()
        controller.start(this)
    }

    override fun invalidate() {
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

    override fun onAdapterStateChanged(state: BleAdapterState) {
        // The emitter callback is bound by the TurboModule infrastructure once JavaScript
        // has resolved this module. Broadcasts before that have no subscriber to reach;
        // JS reads the current state explicitly on startup, so nothing is lost.
        if (mEventEmitterCallback == null) return
        val payload = Arguments.createMap().apply { putString("state", state.wireValue) }
        emitOnBluetoothStateChanged(payload)
    }
}
