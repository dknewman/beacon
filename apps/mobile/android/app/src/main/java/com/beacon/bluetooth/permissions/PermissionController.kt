package com.beacon.bluetooth.permissions

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.beacon.bluetooth.errors.BleError
import com.beacon.bluetooth.errors.BleErrorCode
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

/**
 * Owns the Bluetooth runtime permission flow on Android.
 *
 * Free of React Native bridge types apart from the two interfaces React Native uses to
 * route `onRequestPermissionsResult` back to native modules. One request may be in flight
 * at a time; a second caller is rejected rather than queued so the JavaScript state machine
 * never sees two answers for one prompt.
 */
class PermissionController(
    private val context: Context,
    private val sdkInt: Int = Build.VERSION.SDK_INT,
) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
    private val required: List<String> = RequiredPermissions.forApiLevel(sdkInt)
    private var inFlight = false

    /** Current permission state. Passing the foreground Activity improves denied/blocked accuracy. */
    fun currentState(activity: Activity?): BlePermissionState {
        val missing = required.filter {
            context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
        }
        val canShowRationale: Boolean? =
            activity?.let { host -> missing.any { host.shouldShowRequestPermissionRationale(it) } }
        return PermissionStateMapper.resolve(
            allGranted = missing.isEmpty(),
            canShowRationale = canShowRationale,
            requestedBefore = preferences.getBoolean(KEY_REQUESTED, false),
        )
    }

    /**
     * Shows the system prompt and reports the resulting state. Always attempts the request when
     * something is missing: if the user previously chose "don't ask again" the platform answers
     * immediately without a dialog, and the resulting state is still accurate.
     */
    fun request(activity: PermissionAwareActivity?, onResult: (Result<BlePermissionState>) -> Unit) {
        val host = activity as? Activity
        val current = currentState(host)
        if (current == BlePermissionState.GRANTED) {
            onResult(Result.success(current))
            return
        }
        if (activity == null || host == null) {
            onResult(
                Result.failure(
                    BleError(BleErrorCode.NATIVE_FAILURE, "No foreground activity to show the permission prompt")
                )
            )
            return
        }
        if (inFlight) {
            onResult(
                Result.failure(BleError(BleErrorCode.NATIVE_FAILURE, "A permission request is already in progress"))
            )
            return
        }
        inFlight = true
        preferences.edit().putBoolean(KEY_REQUESTED, true).apply()
        val listener = PermissionListener { requestCode, _, _ ->
            if (requestCode != REQUEST_CODE) return@PermissionListener false
            inFlight = false
            onResult(Result.success(currentState(host)))
            true
        }
        UiThreadUtil.runOnUiThread {
            try {
                activity.requestPermissions(required.toTypedArray(), REQUEST_CODE, listener)
            } catch (error: Exception) {
                inFlight = false
                onResult(Result.failure(error))
            }
        }
    }

    private companion object {
        const val PREFERENCES_NAME = "beacon.bluetooth"
        const val KEY_REQUESTED = "permission_requested"
        const val REQUEST_CODE = 0xB1E
    }
}
