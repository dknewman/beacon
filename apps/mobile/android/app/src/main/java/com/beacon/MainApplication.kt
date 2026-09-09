package com.beacon

import android.app.Application
import com.beacon.bluetooth.BeaconBluetoothPackage
import com.beacon.export.BeaconExportPackage
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // App-local Turbo Modules; they live in this app rather than a library, so they
          // are registered by hand instead of through autolinking.
          add(BeaconBluetoothPackage())
          add(BeaconExportPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
