package com.beacon.bluetooth.connection

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GattOperationQueueTest {

    @Test
    fun `runs one operation at a time in order`() {
        val queue = GattOperationQueue()
        val started = mutableListOf<String>()
        queue.enqueue(GattOperationQueue.Operation("a") { started += "a"; true })
        queue.enqueue(GattOperationQueue.Operation("b") { started += "b"; true })
        queue.enqueue(GattOperationQueue.Operation("c") { started += "c"; true })

        assertEquals(listOf("a"), started)
        assertTrue(queue.isBusy)
        assertEquals(3, queue.depth)

        queue.finish()
        assertEquals(listOf("a", "b"), started)
        queue.finish()
        assertEquals(listOf("a", "b", "c"), started)
        queue.finish()
        assertFalse(queue.isBusy)
        assertEquals(0, queue.depth)
    }

    @Test
    fun `an operation that fails to start does not block the next`() {
        val queue = GattOperationQueue()
        val started = mutableListOf<String>()
        queue.enqueue(GattOperationQueue.Operation("bad") { started += "bad"; false })
        queue.enqueue(GattOperationQueue.Operation("good") { started += "good"; true })
        assertEquals(listOf("bad", "good"), started)
        assertEquals("good", queue.current?.label)
    }

    @Test
    fun `cancelAll returns in-flight and pending operations`() {
        val queue = GattOperationQueue()
        queue.enqueue(GattOperationQueue.Operation("a") { true })
        queue.enqueue(GattOperationQueue.Operation("b") { true })
        queue.enqueue(GattOperationQueue.Operation("c") { true })
        assertEquals(listOf("a", "b", "c"), queue.cancelAll().map { it.label })
        assertFalse(queue.isBusy)
        assertEquals(0, queue.depth)
        assertTrue(queue.cancelAll().isEmpty())
    }

    @Test
    fun `finish while idle is harmless`() {
        val queue = GattOperationQueue()
        queue.finish()
        assertFalse(queue.isBusy)
        var ran = false
        queue.enqueue(GattOperationQueue.Operation("a") { ran = true; true })
        assertTrue(ran)
    }
}
