package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import java.util.UUID

/**
 * Decides how a subscription change is written to a characteristic's Client Characteristic
 * Configuration descriptor (Bluetooth Core Specification Vol. 3 Part G, 3.3.3.3). Pure Kotlin
 * over the platform constants so the choice is unit tested on the JVM; `DeviceConnection`
 * performs the descriptor write.
 */
object NotificationDescriptorMapper {

    /** The Client Characteristic Configuration descriptor, Bluetooth SIG assigned number 0x2902. */
    val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /**
     * The descriptor value that turns delivery on or off for a characteristic with this
     * property bitmask, or null when the characteristic offers neither notifications nor
     * indications and so cannot be subscribed to at all. Notifications are preferred when
     * both are offered, since an indication costs a round trip per value for an
     * acknowledgement the app does not need; indications are used only when they are all the
     * characteristic supports.
     */
    fun cccdValue(properties: Int, enabled: Boolean): ByteArray? {
        val notifies = properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0
        val indicates = properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
        return when {
            !notifies && !indicates -> null
            !enabled -> BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
            notifies -> BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            else -> BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
        }
    }
}
