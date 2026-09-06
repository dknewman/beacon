package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothGattCharacteristic
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Test

class GattTreeMapperTest {

    @Test
    fun `wire values match the TypeScript CharacteristicProperty union`() {
        val expected = listOf("read", "write", "write_without_response", "notify", "indicate")
        assertEquals(expected, BleCharacteristicProperty.values().map { it.wireValue })
    }

    @Test
    fun `property masks map in contract order and ignore unknown bits`() {
        val mask = BluetoothGattCharacteristic.PROPERTY_INDICATE or
            BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
            BluetoothGattCharacteristic.PROPERTY_READ or
            BluetoothGattCharacteristic.PROPERTY_BROADCAST or
            BluetoothGattCharacteristic.PROPERTY_SIGNED_WRITE
        assertEquals(
            listOf(
                BleCharacteristicProperty.READ,
                BleCharacteristicProperty.WRITE_WITHOUT_RESPONSE,
                BleCharacteristicProperty.INDICATE,
            ),
            GattTreeMapper.properties(mask),
        )
        assertEquals(emptyList<BleCharacteristicProperty>(), GattTreeMapper.properties(0))
    }

    @Test
    fun `services and characteristics carry uppercase UUIDs`() {
        val heartRate = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
        val service = GattTreeMapper.service(
            uuid = heartRate,
            primary = true,
            characteristics = listOf(
                UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb") to BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                UUID.fromString("00002a38-0000-1000-8000-00805f9b34fb") to BluetoothGattCharacteristic.PROPERTY_READ,
            ),
        )
        assertEquals("0000180D-0000-1000-8000-00805F9B34FB", service.uuid)
        assertEquals(true, service.primary)
        assertEquals(2, service.characteristics.size)
        assertEquals("0000180D-0000-1000-8000-00805F9B34FB", service.characteristics[0].serviceUuid)
        assertEquals("00002A37-0000-1000-8000-00805F9B34FB", service.characteristics[0].uuid)
        assertEquals(listOf(BleCharacteristicProperty.NOTIFY), service.characteristics[0].properties)
        assertEquals(listOf(BleCharacteristicProperty.READ), service.characteristics[1].properties)
    }
}
