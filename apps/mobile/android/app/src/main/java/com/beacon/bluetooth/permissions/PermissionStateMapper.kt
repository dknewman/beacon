package com.beacon.bluetooth.permissions

/**
 * Pure mapping from Android permission facts to the shared vocabulary.
 *
 * Android cannot distinguish "never asked" from "denied with don't ask again" on its own:
 * `shouldShowRequestPermissionRationale` is false in both cases. The caller therefore
 * supplies whether the app has requested before (persisted), which is the only way to
 * tell `not_requested` and `blocked` apart.
 */
object PermissionStateMapper {

    /**
     * @param allGranted every required permission is currently granted.
     * @param canShowRationale true when the system would show the prompt again for at least one
     *   missing permission; false when the user chose "don't ask again" (or the platform
     *   auto-denied); null when no Activity is available to ask the question.
     * @param requestedBefore the app has requested these permissions at least once.
     */
    fun resolve(allGranted: Boolean, canShowRationale: Boolean?, requestedBefore: Boolean): BlePermissionState =
        when {
            allGranted -> BlePermissionState.GRANTED
            !requestedBefore -> BlePermissionState.NOT_REQUESTED
            // Without an Activity we cannot prove "don't ask again"; allow another attempt.
            canShowRationale == null -> BlePermissionState.DENIED
            canShowRationale -> BlePermissionState.DENIED
            else -> BlePermissionState.BLOCKED
        }
}
