package com.beacon.export

import com.beacon.bluetooth.spec.NativeBeaconExportSpec
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Registers the BeaconExport Turbo Module with React Native (see MainApplication). */
class BeaconExportPackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        if (name == NativeBeaconExportSpec.NAME) BeaconExportModule(reactContext) else null

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            NativeBeaconExportSpec.NAME to
                ReactModuleInfo(
                    name = NativeBeaconExportSpec.NAME,
                    className = BeaconExportModule::class.java.name,
                    canOverrideExistingModule = false,
                    needsEagerInit = false,
                    isCxxModule = false,
                    isTurboModule = true,
                )
        )
    }
}
