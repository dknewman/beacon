package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/**
 * The expected values are the platform's own constants, compared by identity: the SDK stub
 * jar that Gradle unit tests compile against does not carry their bytes, only a device does,
 * and the choice between them is what the mapper decides.
 */
class NotificationDescriptorMapperTest {

    @Test
    fun `enables notifications when the characteristic notifies`() {
        assertSame(
            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE,
            NotificationDescriptorMapper.cccdValue(BluetoothGattCharacteristic.PROPERTY_NOTIFY, enabled = true),
        )
        assertSame(
            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE,
            NotificationDescriptorMapper.cccdValue(
                BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                enabled = true,
            ),
        )
    }

    @Test
    fun `enables indications only when they are all the characteristic offers`() {
        assertSame(
            BluetoothGattDescriptor.ENABLE_INDICATION_VALUE,
            NotificationDescriptorMapper.cccdValue(BluetoothGattCharacteristic.PROPERTY_INDICATE, enabled = true),
        )
        assertSame(
            BluetoothGattDescriptor.ENABLE_INDICATION_VALUE,
            NotificationDescriptorMapper.cccdValue(
                BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_INDICATE,
                enabled = true,
            ),
        )
    }

    @Test
    fun `prefers notifications when both are offered`() {
        val both = BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE
        assertSame(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE, NotificationDescriptorMapper.cccdValue(both, enabled = true))
    }

    @Test
    fun `disables delivery the same way whatever the characteristic offers`() {
        val both = BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE
        assertSame(
            BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE,
            NotificationDescriptorMapper.cccdValue(BluetoothGattCharacteristic.PROPERTY_NOTIFY, enabled = false),
        )
        assertSame(
            BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE,
            NotificationDescriptorMapper.cccdValue(BluetoothGattCharacteristic.PROPERTY_INDICATE, enabled = false),
        )
        assertSame(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE, NotificationDescriptorMapper.cccdValue(both, enabled = false))
    }

    @Test
    fun `has no value for a characteristic that offers neither`() {
        val readWrite = BluetoothGattCharacteristic.PROPERTY_READ or BluetoothGattCharacteristic.PROPERTY_WRITE
        assertNull(NotificationDescriptorMapper.cccdValue(readWrite, enabled = true))
        assertNull(NotificationDescriptorMapper.cccdValue(readWrite, enabled = false))
        assertNull(NotificationDescriptorMapper.cccdValue(0, enabled = true))
    }

    @Test
    fun `the descriptor is the Client Characteristic Configuration assigned number`() {
        assertEquals("00002902-0000-1000-8000-00805f9b34fb", NotificationDescriptorMapper.CCCD_UUID.toString())
        assertEquals(BleUuid.parse("2902"), NotificationDescriptorMapper.CCCD_UUID)
    }
}
