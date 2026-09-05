package com.beacon.bluetooth

import com.facebook.fbreact.specs.NativeBeaconBluetoothSpec
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers the BeaconBluetooth Turbo Module with React Native (see MainApplication). */
class BeaconBluetoothPackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == NativeBeaconBluetoothSpec.NAME) BeaconBluetoothModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            NativeBeaconBluetoothSpec.NAME to
                ReactModuleInfo(
                    name = NativeBeaconBluetoothSpec.NAME,
                    className = BeaconBluetoothModule::class.java.name,
                    canOverrideExistingModule = false,
                    needsEagerInit = false,
                    isCxxModule = false,
                    isTurboModule = true,
                )
        )
    }
}
