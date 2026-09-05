package com.beacon.bluetooth

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import com.beacon.bluetooth.mapping.BleAdapterState
import com.beacon.bluetooth.mapping.BluetoothStateMapper

/**
 * Owns the Android Bluetooth adapter and reports its state.
 *
 * This class is deliberately free of React Native types so it can grow into the
 * scanner/connection owner (M2/M3) and be unit tested with a fake context.
 * Reading the adapter state does not require any runtime permission on any
 * supported API level, so this controller never throws SecurityException.
 */
class BluetoothController(private val context: Context) {

    fun interface Listener {
        fun onAdapterStateChanged(state: BleAdapterState)
    }

    private val bluetoothManager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

    private val hasBleFeature: Boolean =
        context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)

    private var receiver: BroadcastReceiver? = null

    /** Current adapter state; "unsupported" when the device has no BLE radio or adapter. */
    fun currentAdapterState(): BleAdapterState {
        if (!hasBleFeature) return BleAdapterState.UNSUPPORTED
        val adapter = bluetoothManager?.adapter ?: return BleAdapterState.UNSUPPORTED
        return BluetoothStateMapper.fromAdapterState(adapter.state)
    }

    /** Starts observing adapter state broadcasts. Idempotent. */
    fun start(listener: Listener) {
        if (receiver != null) return
        val stateReceiver =
            object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    if (intent.action != BluetoothAdapter.ACTION_STATE_CHANGED) return
                    val rawState =
                        intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                    listener.onAdapterStateChanged(BluetoothStateMapper.fromAdapterState(rawState))
                }
            }
        val filter = IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED)
        // ACTION_STATE_CHANGED is a protected system broadcast; only the system can send it,
        // so exporting the receiver is safe and satisfies the API 33+ flag requirement.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(stateReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            context.registerReceiver(stateReceiver, filter)
        }
        receiver = stateReceiver
    }

    /** Stops observing. Safe to call when not started. */
    fun stop() {
        receiver?.let { context.unregisterReceiver(it) }
        receiver = null
    }
}
