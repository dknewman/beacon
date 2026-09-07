package com.beacon.bluetooth.mapping

import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattService
import java.util.UUID

/**
 * Characteristic property vocabulary shared with TypeScript (`CharacteristicProperty`).
 * Wire values and order match the TypeScript union.
 */
enum class BleCharacteristicProperty(val wireValue: String, val mask: Int) {
    READ("read", BluetoothGattCharacteristic.PROPERTY_READ),
    WRITE("write", BluetoothGattCharacteristic.PROPERTY_WRITE),
    WRITE_WITHOUT_RESPONSE("write_without_response", BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE),
    NOTIFY("notify", BluetoothGattCharacteristic.PROPERTY_NOTIFY),
    INDICATE("indicate", BluetoothGattCharacteristic.PROPERTY_INDICATE),
}

/** A discovered characteristic in the shape of `GattCharacteristic`. */
data class DiscoveredCharacteristic(
    val serviceUuid: String,
    val uuid: String,
    val properties: List<BleCharacteristicProperty>,
)

/** A discovered service in the shape of `GattService`. */
data class DiscoveredService(
    val uuid: String,
    val primary: Boolean,
    val characteristics: List<DiscoveredCharacteristic>,
)

/**
 * Maps the Android GATT tree onto the shared shapes. [properties] and [characteristic] take
 * primitives so they are unit tested on the JVM; [services] unpacks the Android objects.
 */
object GattTreeMapper {

    /** Contract properties present in a `BluetoothGattCharacteristic.properties` bitmask, in contract order. */
    fun properties(mask: Int): List<BleCharacteristicProperty> =
        BleCharacteristicProperty.values().filter { mask and it.mask != 0 }

    fun characteristic(serviceUuid: UUID, uuid: UUID, propertyMask: Int): DiscoveredCharacteristic =
        DiscoveredCharacteristic(
            serviceUuid = BleUuid.format(serviceUuid),
            uuid = BleUuid.format(uuid),
            properties = properties(propertyMask),
        )

    fun service(uuid: UUID, primary: Boolean, characteristics: List<Pair<UUID, Int>>): DiscoveredService =
        DiscoveredService(
            uuid = BleUuid.format(uuid),
            primary = primary,
            characteristics = characteristics.map { (characteristicUuid, mask) ->
                characteristic(uuid, characteristicUuid, mask)
            },
        )

    fun services(services: List<BluetoothGattService>): List<DiscoveredService> =
        services.map { gattService ->
            service(
                uuid = gattService.uuid,
                primary = gattService.type == BluetoothGattService.SERVICE_TYPE_PRIMARY,
                characteristics = gattService.characteristics.map { it.uuid to it.properties },
            )
        }
}
