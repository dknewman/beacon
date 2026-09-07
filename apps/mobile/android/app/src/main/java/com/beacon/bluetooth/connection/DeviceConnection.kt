package com.beacon.bluetooth.connection

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.os.Build
import com.beacon.bluetooth.errors.BleError
import com.beacon.bluetooth.errors.BleErrorCode
import com.beacon.bluetooth.errors.toBleError
import com.beacon.bluetooth.mapping.BleConnectionState
import com.beacon.bluetooth.mapping.BleUuid
import com.beacon.bluetooth.mapping.DiscoveredService
import com.beacon.bluetooth.mapping.GattStatusMapper
import com.beacon.bluetooth.mapping.GattTreeMapper
import com.beacon.bluetooth.mapping.IsoTimestamp
import com.beacon.bluetooth.mapping.NotificationDescriptorMapper

/**
 * One peripheral's connection (PROJECT.md 28, 29): owns the `BluetoothGatt`, drives the
 * explicit state machine, and settles the bridge promises waiting on it.
 *
 * `BluetoothGattCallback` runs on a binder thread, so every mutation is guarded by the
 * instance lock; listeners and completions are invoked from within the guarded sections,
 * which is safe because they only forward to thread-safe bridge APIs.
 *
 * Characteristic reads, writes and subscription changes go through a [GattOperationQueue]:
 * the stack accepts one outstanding GATT request per link, so each waits for its
 * predecessor's callback. When the link ends, every queued and in-flight operation is settled
 * with `disconnected` and every subscription ends with it.
 *
 * Errors are always reported through [Listener.onError] before the `DISCONNECTED` transition
 * they cause, matching the iOS implementation and the JavaScript reducer's expectations.
 */
class DeviceConnection(
    private val context: Context,
    private val device: BluetoothDevice,
    private val listener: Listener,
) {
    interface Listener {
        fun onStateChanged(address: String, state: BleConnectionState)
        fun onError(address: String, error: BleError)

        /** A notification or indication; UUIDs are in wire form and [timestamp] is the receipt instant. */
        fun onValueChanged(address: String, serviceUuid: String, characteristicUuid: String, value: ByteArray, timestamp: String)
    }

    val address: String = device.address

    var state: BleConnectionState = BleConnectionState.DISCONNECTED
        private set

    /** The GATT table, available while the connection is READY. */
    var services: List<DiscoveredService> = emptyList()
        private set

    /** "service/characteristic" keys (wire form) the peripheral has acknowledged a subscription for. */
    val subscriptions: Set<String>
        @Synchronized get() = subscribed.toSet()

    private var gatt: BluetoothGatt? = null
    private val pendingConnects = mutableListOf<(BleError?) -> Unit>()
    private val pendingDisconnects = mutableListOf<() -> Unit>()
    private val pendingRssiReads = mutableListOf<(Result<Int>) -> Unit>()
    private var disconnectRequested = false

    private val operations = GattOperationQueue()

    /** Settles a queued operation that never started; removed once the operation starts. */
    private val cancellations = HashMap<GattOperationQueue.Operation, (BleError) -> Unit>()

    /** Completion of the in-flight read, answered by `onCharacteristicRead`. */
    private var pendingRead: ((Result<ByteArray>) -> Unit)? = null

    /** Completion of the in-flight write, answered by `onCharacteristicWrite`. */
    private var pendingWrite: ((BleError?) -> Unit)? = null

    /** The in-flight subscription change, answered by `onDescriptorWrite`. */
    private var pendingNotify: PendingNotify? = null

    /** Backing set of [subscriptions]; kept for developer mode and cleared when the link ends. */
    private val subscribed = HashSet<String>()

    /** Starts (or joins) a connection attempt; `onResult(null)` once services are discovered. */
    @Synchronized
    fun connect(onResult: (BleError?) -> Unit) {
        when (state) {
            BleConnectionState.READY -> {
                onResult(null)
                return
            }
            BleConnectionState.CONNECTING,
            BleConnectionState.CONNECTED,
            BleConnectionState.DISCOVERING_SERVICES -> {
                pendingConnects += onResult
                return
            }
            BleConnectionState.DISCONNECTING -> {
                onResult(BleError(BleErrorCode.CONNECTION_FAILED, "The device is still disconnecting"))
                return
            }
            BleConnectionState.DISCONNECTED, BleConnectionState.FAILED -> Unit
        }
        disconnectRequested = false
        pendingConnects += onResult
        setState(BleConnectionState.CONNECTING)
        val opened = try {
            device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
        } catch (error: SecurityException) {
            finish(error.toBleError())
            return
        }
        if (opened == null) {
            finish(BleError(BleErrorCode.CONNECTION_FAILED, "The Bluetooth stack refused to open a connection"))
            return
        }
        gatt = opened
    }

    /** Disconnects, or cancels an attempt in progress; `onResult` once the link is gone. */
    @Synchronized
    fun disconnect(onResult: () -> Unit) {
        if (state == BleConnectionState.DISCONNECTED || state == BleConnectionState.FAILED) {
            onResult()
            return
        }
        pendingDisconnects += onResult
        disconnectRequested = true
        if (state == BleConnectionState.DISCONNECTING) return
        if (state == BleConnectionState.CONNECTING) {
            // Android does not reliably call back for a cancelled pending connection.
            closeGatt()
            finish(null)
            return
        }
        setState(BleConnectionState.DISCONNECTING)
        try {
            gatt?.disconnect()
        } catch (_: SecurityException) {
            closeGatt()
            finish(null)
        }
    }

    /** Reads the remote RSSI. Reads issued while one is in flight share its answer. */
    @Synchronized
    fun readRssi(onResult: (Result<Int>) -> Unit) {
        val active = gatt
        if (active == null || !isLinked()) {
            onResult(Result.failure(BleError(BleErrorCode.DISCONNECTED, "Not connected to $address")))
            return
        }
        val wasIdle = pendingRssiReads.isEmpty()
        pendingRssiReads += onResult
        if (!wasIdle) return
        val started = try {
            active.readRemoteRssi()
        } catch (error: SecurityException) {
            settleRssi(Result.failure(error.toBleError()))
            return
        }
        if (!started) {
            settleRssi(Result.failure(BleError(BleErrorCode.READ_FAILED, "The Bluetooth stack rejected the RSSI read")))
        }
    }

    /** The discovered table; fails with `disconnected` unless the connection is READY. */
    @Synchronized
    fun discoverServices(onResult: (Result<List<DiscoveredService>>) -> Unit) {
        if (state != BleConnectionState.READY) {
            onResult(Result.failure(BleError(BleErrorCode.DISCONNECTED, "Not connected to $address")))
            return
        }
        onResult(Result.success(services))
    }

    /**
     * Reads a characteristic's value, queued behind other GATT operations on this link.
     * Fails with `disconnected`, `service_not_found`, `characteristic_not_found` or `read_failed`.
     */
    @Synchronized
    fun readCharacteristic(serviceUuid: String, characteristicUuid: String, onResult: (Result<ByteArray>) -> Unit) {
        val characteristic = when (val lookup = findCharacteristic(serviceUuid, characteristicUuid)) {
            is Lookup.Failure -> {
                onResult(Result.failure(lookup.error))
                return
            }
            is Lookup.Found -> lookup.characteristic
        }
        if (characteristic.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0) {
            onResult(Result.failure(notPermitted(BleErrorCode.READ_FAILED, "Read not permitted")))
            return
        }
        enqueue(
            label = "read ${characteristic.uuid}",
            cancel = { onResult(Result.failure(it)) },
        ) {
            val active = linkedGatt()
            if (active == null) {
                onResult(Result.failure(BleError(BleErrorCode.DISCONNECTED, "Not connected to $address")))
                return@enqueue false
            }
            pendingRead = onResult
            val started = try {
                active.readCharacteristic(characteristic)
            } catch (error: SecurityException) {
                settleRead(Result.failure(error.toBleError()))
                return@enqueue false
            }
            if (!started) {
                settleRead(Result.failure(BleError(BleErrorCode.READ_FAILED, "The Bluetooth stack rejected the read")))
            }
            started
        }
    }

    /**
     * Writes [bytes] to a characteristic, queued behind other GATT operations on this link.
     * With [withResponse] the peripheral's acknowledgement completes the write; without it the
     * stack's own confirmation does. Fails with `disconnected`, `service_not_found`,
     * `characteristic_not_found` or `write_failed`.
     */
    @Synchronized
    fun writeCharacteristic(
        serviceUuid: String,
        characteristicUuid: String,
        bytes: ByteArray,
        withResponse: Boolean,
        onResult: (BleError?) -> Unit,
    ) {
        val characteristic = when (val lookup = findCharacteristic(serviceUuid, characteristicUuid)) {
            is Lookup.Failure -> {
                onResult(lookup.error)
                return
            }
            is Lookup.Found -> lookup.characteristic
        }
        val requiredProperty = if (withResponse) {
            BluetoothGattCharacteristic.PROPERTY_WRITE
        } else {
            BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE
        }
        if (characteristic.properties and requiredProperty == 0) {
            onResult(notPermitted(BleErrorCode.WRITE_FAILED, "Write not permitted"))
            return
        }
        val writeType = if (withResponse) {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        } else {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        }
        enqueue(label = "write ${characteristic.uuid}", cancel = onResult) {
            val active = linkedGatt()
            if (active == null) {
                onResult(BleError(BleErrorCode.DISCONNECTED, "Not connected to $address"))
                return@enqueue false
            }
            pendingWrite = onResult
            val rejection = try {
                startWrite(active, characteristic, bytes, writeType)
            } catch (error: SecurityException) {
                error.toBleError()
            }
            if (rejection != null) settleWrite(rejection)
            rejection == null
        }
    }

    /**
     * Turns notifications (or indications, when that is all the characteristic offers) on or
     * off, queued behind other GATT operations on this link. Completes once the peripheral has
     * acknowledged the change; values then arrive through [Listener.onValueChanged]. Fails
     * with `disconnected`, `service_not_found`, `characteristic_not_found` or
     * `subscription_failed`.
     */
    @Synchronized
    fun setNotify(serviceUuid: String, characteristicUuid: String, enabled: Boolean, onResult: (BleError?) -> Unit) {
        val characteristic = when (val lookup = findCharacteristic(serviceUuid, characteristicUuid)) {
            is Lookup.Failure -> {
                onResult(lookup.error)
                return
            }
            is Lookup.Found -> lookup.characteristic
        }
        val value = NotificationDescriptorMapper.cccdValue(characteristic.properties, enabled)
        if (value == null) {
            onResult(notPermitted(BleErrorCode.SUBSCRIPTION_FAILED, "Notifications not supported"))
            return
        }
        val verb = if (enabled) "subscribe" else "unsubscribe"
        enqueue(label = "$verb ${characteristic.uuid}", cancel = onResult) {
            val active = linkedGatt()
            if (active == null) {
                onResult(BleError(BleErrorCode.DISCONNECTED, "Not connected to $address"))
                return@enqueue false
            }
            pendingNotify = PendingNotify(characteristic, subscriptionKey(characteristic), enabled, onResult)
            val start = try {
                startNotify(active, characteristic, enabled, value)
            } catch (error: SecurityException) {
                SubscriptionStart.Rejected(error.toBleError())
            }
            when (start) {
                SubscriptionStart.Pending -> true
                is SubscriptionStart.Rejected -> {
                    settleNotify(start.error)
                    false
                }
            }
        }
    }

    /** Tears the connection down without waiting, for adapter loss and module invalidation. */
    @Synchronized
    fun drop(reason: BleError?) {
        if (state == BleConnectionState.DISCONNECTED) return
        closeGatt()
        finish(reason)
    }

    private fun isLinked(): Boolean =
        state == BleConnectionState.CONNECTED ||
            state == BleConnectionState.DISCOVERING_SERVICES ||
            state == BleConnectionState.READY

    /** The GATT client while the connection is READY, else null. */
    private fun linkedGatt(): BluetoothGatt? = gatt?.takeIf { state == BleConnectionState.READY }

    private sealed interface Lookup {
        class Found(val characteristic: BluetoothGattCharacteristic) : Lookup
        class Failure(val error: BleError) : Lookup
    }

    /**
     * Resolves a characteristic from the discovered table. UUIDs are compared canonically, so
     * "180F", "0000180f-0000-1000-8000-00805f9b34fb" and the unhyphenated form all match.
     */
    private fun findCharacteristic(serviceUuid: String, characteristicUuid: String): Lookup {
        val active = linkedGatt()
            ?: return Lookup.Failure(BleError(BleErrorCode.DISCONNECTED, "Not connected to $address"))
        val service = BleUuid.parse(serviceUuid)?.let { active.getService(it) }
            ?: return Lookup.Failure(BleError(BleErrorCode.SERVICE_NOT_FOUND, "No service $serviceUuid on $address"))
        val characteristic = BleUuid.parse(characteristicUuid)?.let { service.getCharacteristic(it) }
            ?: return Lookup.Failure(
                BleError(BleErrorCode.CHARACTERISTIC_NOT_FOUND, "No characteristic $characteristicUuid in service $serviceUuid"),
            )
        return Lookup.Found(characteristic)
    }

    private fun notPermitted(code: BleErrorCode, message: String): BleError =
        BleError(code, message, nativeDomain = "android.bluetooth.BluetoothGattCharacteristic")

    /**
     * The wire-form UUIDs of a characteristic from the discovered table, which always carries
     * the service it was found under.
     */
    private fun wireUuids(characteristic: BluetoothGattCharacteristic): Pair<String, String> =
        BleUuid.format(characteristic.service.uuid) to BleUuid.format(characteristic.uuid)

    private fun subscriptionKey(characteristic: BluetoothGattCharacteristic): String {
        val (serviceUuid, characteristicUuid) = wireUuids(characteristic)
        return "$serviceUuid/$characteristicUuid"
    }

    /**
     * Queues [start] behind the operations already waiting on this link. [cancel] settles the
     * caller when the link ends before the operation starts; once started, the operation's own
     * pending completion is settled instead.
     */
    private fun enqueue(label: String, cancel: (BleError) -> Unit, start: () -> Boolean) {
        var self: GattOperationQueue.Operation? = null
        val operation = GattOperationQueue.Operation(label) {
            self?.let(cancellations::remove)
            start()
        }
        self = operation
        cancellations[operation] = cancel
        operations.enqueue(operation)
    }

    /**
     * Hands a write to the stack. Returns null once the stack accepted it (the callback will
     * follow), or the error to settle with. Android 13 reports acceptance as a status code;
     * earlier releases take the payload and write type from the characteristic itself.
     */
    private fun startWrite(
        active: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        bytes: ByteArray,
        writeType: Int,
    ): BleError? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val status = active.writeCharacteristic(characteristic, bytes, writeType)
            return GattStatusMapper.requestRejection(BleErrorCode.WRITE_FAILED, "write", status)
        }
        @Suppress("DEPRECATION")
        val accepted = run {
            characteristic.writeType = writeType
            characteristic.value = bytes
            active.writeCharacteristic(characteristic)
        }
        return if (accepted) null else BleError(BleErrorCode.WRITE_FAILED, "The Bluetooth stack rejected the write")
    }

    /** A subscription change in flight: what it targets, which way it switches, who waits. */
    private class PendingNotify(
        val characteristic: BluetoothGattCharacteristic,
        val key: String,
        val enabled: Boolean,
        val completion: (BleError?) -> Unit,
    )

    private sealed interface SubscriptionStart {
        /** The descriptor write is in flight; `onDescriptorWrite` completes the change. */
        object Pending : SubscriptionStart

        class Rejected(val error: BleError) : SubscriptionStart
    }

    /**
     * Hands a subscription change to the stack. Delivery is switched locally first (the stack
     * discards notifications for characteristics it was not told about), then the Client
     * Characteristic Configuration descriptor is written with [value] so the peripheral
     * starts or stops sending. A characteristic that advertises notify or indicate without
     * that descriptor cannot be configured remotely; the change is refused up front, as
     * CoreBluetooth refuses it on iOS, rather than reported as a subscription that never
     * delivers. Android 13 reports acceptance of the descriptor write as a status code;
     * earlier releases take the value from the descriptor itself.
     */
    private fun startNotify(
        active: BluetoothGatt,
        characteristic: BluetoothGattCharacteristic,
        enabled: Boolean,
        value: ByteArray,
    ): SubscriptionStart {
        if (!active.setCharacteristicNotification(characteristic, enabled)) {
            return SubscriptionStart.Rejected(stackRejectedSubscription())
        }
        val descriptor = characteristic.getDescriptor(NotificationDescriptorMapper.CCCD_UUID)
        if (descriptor == null) {
            setLocalDelivery(active, characteristic, !enabled)
            return SubscriptionStart.Rejected(
                notPermitted(
                    BleErrorCode.SUBSCRIPTION_FAILED,
                    "The characteristic has no client characteristic configuration descriptor",
                ),
            )
        }
        val rejection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val status = active.writeDescriptor(descriptor, value)
            GattStatusMapper.requestRejection(BleErrorCode.SUBSCRIPTION_FAILED, "subscription", status)
        } else {
            @Suppress("DEPRECATION")
            val accepted = run {
                descriptor.value = value
                active.writeDescriptor(descriptor)
            }
            if (accepted) null else stackRejectedSubscription()
        }
        if (rejection == null) return SubscriptionStart.Pending
        // The peripheral was never told, so the local switch goes back to match it.
        setLocalDelivery(active, characteristic, !enabled)
        return SubscriptionStart.Rejected(rejection)
    }

    private fun stackRejectedSubscription(): BleError =
        BleError(BleErrorCode.SUBSCRIPTION_FAILED, "The Bluetooth stack rejected the subscription")

    /** Flips the stack's local delivery switch to undo a half-applied change; a refusal is ignored. */
    private fun setLocalDelivery(active: BluetoothGatt, characteristic: BluetoothGattCharacteristic, enabled: Boolean) {
        try {
            active.setCharacteristicNotification(characteristic, enabled)
        } catch (_: SecurityException) {
            // Permission revoked mid-session: the link is about to end and takes the switch with it.
        }
    }

    private fun settleRead(result: Result<ByteArray>) {
        val completion = pendingRead ?: return
        pendingRead = null
        completion(result)
    }

    private fun settleWrite(error: BleError?) {
        val completion = pendingWrite ?: return
        pendingWrite = null
        completion(error)
    }

    /** Settles the in-flight subscription change; success records (or forgets) the subscription. */
    private fun settleNotify(error: BleError?) {
        val pending = pendingNotify ?: return
        pendingNotify = null
        if (error == null) {
            if (pending.enabled) subscribed += pending.key else subscribed -= pending.key
        }
        pending.completion(error)
    }

    /** Fails the in-flight operation and every queued one; the link is gone. */
    private fun cancelOperations(error: BleError) {
        val cancelled = operations.cancelAll()
        settleRead(Result.failure(error))
        settleWrite(error)
        settleNotify(error)
        cancelled.forEach { operation -> cancellations.remove(operation)?.invoke(error) }
    }

    private fun setState(next: BleConnectionState) {
        if (next == state) return
        state = next
        listener.onStateChanged(address, next)
    }

    /**
     * Ends the session. A non-null [error] is emitted before the `DISCONNECTED` transition;
     * null is a disconnect JavaScript asked for.
     */
    private fun finish(error: BleError?) {
        if (error != null) {
            listener.onError(address, error)
            settleConnects(error)
        } else {
            settleConnects(BleError(BleErrorCode.DISCONNECTED, "Connection cancelled"))
        }
        settleRssi(Result.failure(BleError(BleErrorCode.DISCONNECTED, "The connection ended")))
        cancelOperations(BleError(BleErrorCode.DISCONNECTED, "The connection ended"))
        disconnectRequested = false
        services = emptyList()
        // The peripheral forgets every client configuration with the link, so no subscription survives it.
        subscribed.clear()
        setState(BleConnectionState.DISCONNECTED)
        val waiters = pendingDisconnects.toList()
        pendingDisconnects.clear()
        waiters.forEach { it() }
    }

    private fun settleConnects(error: BleError?) {
        val completions = pendingConnects.toList()
        pendingConnects.clear()
        completions.forEach { it(error) }
    }

    private fun settleRssi(result: Result<Int>) {
        val completions = pendingRssiReads.toList()
        pendingRssiReads.clear()
        completions.forEach { it(result) }
    }

    private fun closeGatt() {
        val active = gatt ?: return
        gatt = null
        try {
            active.close()
        } catch (_: SecurityException) {
            // Permission revoked mid-session: the stack has already released the client.
        }
    }

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> {
                        if (status != BluetoothGatt.GATT_SUCCESS) {
                            closeGatt()
                            finish(GattStatusMapper.connectionFailure(status))
                            return
                        }
                        if (state != BleConnectionState.CONNECTING) return
                        setState(BleConnectionState.CONNECTED)
                        setState(BleConnectionState.DISCOVERING_SERVICES)
                        val started = try {
                            gatt.discoverServices()
                        } catch (_: SecurityException) {
                            false
                        }
                        if (!started) {
                            listener.onError(
                                address,
                                GattStatusMapper.operationFailure(BleErrorCode.SERVICE_NOT_FOUND, "Service discovery", status),
                            )
                            settleConnects(BleError(BleErrorCode.SERVICE_NOT_FOUND, "Service discovery could not start"))
                            disconnectRequested = true
                            setState(BleConnectionState.DISCONNECTING)
                            gatt.disconnect()
                        }
                    }
                    BluetoothProfile.STATE_DISCONNECTED -> {
                        closeGatt()
                        val error = when {
                            disconnectRequested -> null
                            state == BleConnectionState.CONNECTING -> GattStatusMapper.connectionFailure(status)
                            else -> GattStatusMapper.remoteDisconnect(status)
                        }
                        finish(error)
                    }
                    else -> Unit
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                if (state != BleConnectionState.DISCOVERING_SERVICES) return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    services = GattTreeMapper.services(gatt.services ?: emptyList())
                    setState(BleConnectionState.READY)
                    settleConnects(null)
                    return
                }
                val error = GattStatusMapper.operationFailure(BleErrorCode.SERVICE_NOT_FOUND, "Service discovery", status)
                listener.onError(address, error)
                settleConnects(error)
                // A link without services is useless; close it cleanly (the error is already out).
                disconnectRequested = true
                setState(BleConnectionState.DISCONNECTING)
                try {
                    gatt.disconnect()
                } catch (_: SecurityException) {
                    closeGatt()
                    finish(null)
                }
            }
        }

        override fun onReadRemoteRssi(gatt: BluetoothGatt, rssi: Int, status: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    settleRssi(Result.success(rssi))
                } else {
                    settleRssi(Result.failure(GattStatusMapper.operationFailure(BleErrorCode.READ_FAILED, "RSSI read", status)))
                }
            }
        }

        /** Android 13 and later deliver the value alongside the characteristic. */
        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
            status: Int,
        ) {
            handleRead(gatt, value, status)
        }

        /** Earlier releases deliver only the characteristic, whose value holds the bytes. */
        @Deprecated("Superseded on Android 13 by the overload carrying the value")
        @Suppress("DEPRECATION")
        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            handleRead(gatt, characteristic.value ?: ByteArray(0), status)
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                if (pendingWrite == null) return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    settleWrite(null)
                } else {
                    settleWrite(GattStatusMapper.operationFailure(BleErrorCode.WRITE_FAILED, "Characteristic write", status))
                }
                operations.finish()
            }
        }

        /** The peripheral's answer to a Client Characteristic Configuration write. */
        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                val pending = pendingNotify ?: return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    settleNotify(null)
                } else {
                    // The peripheral refused the change, so the local switch goes back to match it.
                    setLocalDelivery(gatt, pending.characteristic, !pending.enabled)
                    settleNotify(GattStatusMapper.operationFailure(BleErrorCode.SUBSCRIPTION_FAILED, "Subscription change", status))
                }
                operations.finish()
            }
        }

        /** Android 13 and later deliver the value alongside the characteristic. */
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            handleChanged(gatt, characteristic, value)
        }

        /** Earlier releases deliver only the characteristic, whose value holds the bytes. */
        @Deprecated("Superseded on Android 13 by the overload carrying the value")
        @Suppress("DEPRECATION")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            handleChanged(gatt, characteristic, characteristic.value ?: ByteArray(0))
        }

        private fun handleRead(gatt: BluetoothGatt, value: ByteArray, status: Int) {
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                // With no read in flight this is a value update from a subscription, which
                // arrives through onCharacteristicChanged rather than here.
                if (pendingRead == null) return
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    settleRead(Result.success(value))
                } else {
                    settleRead(Result.failure(GattStatusMapper.operationFailure(BleErrorCode.READ_FAILED, "Characteristic read", status)))
                }
                operations.finish()
            }
        }

        /**
         * Forwards a notification or indication. The timestamp is taken on receipt, before the
         * lock and the bridge hop, so a burst keeps its order and spacing. The listener is
         * called from within the guarded section like every other listener call here, which
         * also guarantees that no value is reported after the `DISCONNECTED` transition of
         * the link it came from.
         */
        private fun handleChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            val timestamp = IsoTimestamp.format(System.currentTimeMillis())
            synchronized(this@DeviceConnection) {
                if (gatt !== this@DeviceConnection.gatt) return
                val (serviceUuid, characteristicUuid) = wireUuids(characteristic)
                listener.onValueChanged(address, serviceUuid, characteristicUuid, value, timestamp)
            }
        }
    }
}
