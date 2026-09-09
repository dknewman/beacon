package com.beacon.export

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ExportFileStoreTest {

    @get:Rule
    val cache = TemporaryFolder()

    private val store: ExportFileStore by lazy { ExportFileStore(cache.root) }

    @Test
    fun `writes the file into its own directory as UTF-8`() {
        val written = store.write("session.csv", "id,name\n1,Höhenmesser ✓\n")

        assertEquals(store.directory, written.parentFile)
        assertEquals("beacon-exports", store.directory.name)
        assertEquals("id,name\n1,Höhenmesser ✓\n", written.readText(Charsets.UTF_8))
    }

    @Test
    fun `overwrites an earlier export with the same name`() {
        store.write("session.csv", "first")
        val written = store.write("session.csv", "second")

        assertEquals("second", written.readText(Charsets.UTF_8))
        assertEquals(1, store.directory.listFiles()?.size)
    }

    @Test
    fun `reduces a traversing file name to its last component`() {
        val written = store.write("../../databases/beacon.db", "payload")

        assertEquals("beacon.db", written.name)
        assertEquals(store.directory.canonicalFile, written.canonicalFile.parentFile)
    }

    @Test
    fun `reduces an absolute file name to its last component`() {
        val written = store.write("/data/data/com.beacon/files/session.json", "{}")

        assertEquals("session.json", written.name)
        assertEquals(store.directory.canonicalFile, written.canonicalFile.parentFile)
    }

    @Test
    fun `contains accepts a file the store wrote`() {
        val written = store.write("session.csv", "payload")

        assertTrue(store.contains(written.absolutePath))
    }

    @Test
    fun `contains rejects a file outside the directory`() {
        val outside = cache.newFile("elsewhere.csv")

        assertFalse(store.contains(outside.absolutePath))
    }

    @Test
    fun `contains rejects a traversal back out of the directory`() {
        val outside = cache.newFile("beacon.db")
        val traversal = File(store.directory, "../beacon.db").path

        assertFalse(store.contains(traversal))
        assertTrue(outside.isFile)
    }

    @Test
    fun `contains rejects a blank path`() {
        assertFalse(store.contains(""))
    }

    @Test
    fun `clear removes the files and reports how many`() {
        store.write("first.csv", "a")
        store.write("second.csv", "b")

        assertEquals(2, store.clear())
        assertEquals(0, store.directory.listFiles()?.size)
    }

    @Test
    fun `clearing twice is safe and reports nothing removed`() {
        store.write("first.csv", "a")

        assertEquals(1, store.clear())
        assertEquals(0, store.clear())
    }

    @Test
    fun `clearing before the first export reports nothing removed`() {
        assertFalse(store.directory.exists())
        assertEquals(0, store.clear())
    }
}
