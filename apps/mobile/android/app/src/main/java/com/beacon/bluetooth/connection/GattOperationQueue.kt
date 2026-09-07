package com.beacon.bluetooth.connection

/**
 * Serializes GATT operations for one connection (PROJECT.md 29). The Android stack silently
 * drops a read or write issued while another is outstanding, so every operation waits for its
 * predecessor's callback.
 *
 * Pure Kotlin with no Android dependency: [Operation.start] performs the platform call and the
 * owner calls [finish] from the matching callback. Not thread-safe on its own; the owner guards
 * it with its lock. Unit tested on the JVM.
 */
class GattOperationQueue {

    /**
     * An operation: [start] performs the platform call. Returning false means it failed to
     * start (the owner has already settled its completion) and the queue moves on.
     */
    class Operation(val label: String, val start: () -> Boolean)

    private val pending = ArrayDeque<Operation>()

    var current: Operation? = null
        private set

    val isBusy: Boolean
        get() = current != null

    val depth: Int
        get() = pending.size + (if (current == null) 0 else 1)

    /** Queues an operation and starts it immediately when nothing is in flight. */
    fun enqueue(operation: Operation) {
        pending.addLast(operation)
        startNextIfIdle()
    }

    /** Called by the owner when the in-flight operation's callback arrived. */
    fun finish() {
        current = null
        startNextIfIdle()
    }

    /**
     * Drops every queued operation, e.g. when the link ends. Returns them (in-flight first) so
     * the owner can settle their completions with an error.
     */
    fun cancelAll(): List<Operation> {
        val cancelled = mutableListOf<Operation>()
        current?.let { cancelled += it }
        cancelled += pending
        current = null
        pending.clear()
        return cancelled
    }

    private fun startNextIfIdle() {
        while (current == null && pending.isNotEmpty()) {
            val next = pending.removeFirst()
            current = next
            if (!next.start()) {
                current = null
            }
        }
    }
}
