package com.beacon.export

import java.io.File

/**
 * Owns the one directory the export module is allowed to touch, and is the only place that
 * decides whether a path belongs to it.
 *
 * Free of Android framework types so the containment rules are unit tested on the JVM; the
 * module supplies the cache directory and turns the results into bridge values.
 */
class ExportFileStore(cacheDir: File, directoryName: String = DIRECTORY_NAME) {

    /** The subdirectory this store owns. Created lazily, on the first write. */
    val directory: File = File(cacheDir, directoryName)

    /**
     * Writes [contents] as UTF-8 and returns the file.
     *
     * [fileName] comes from JavaScript, so only its last path component is used: a caller that
     * passes `../../databases/beacon.db` gets `beacon.db` inside this directory rather than a
     * write outside it. An existing file of the same name is replaced, because the export is a
     * snapshot of the session as it stands and keeping the previous one would only leave the
     * user two files to choose between.
     */
    fun write(fileName: String, contents: String): File {
        val safeName = File(fileName).name
        // `.` and `..` survive the reduction above and name a directory, not a file; refusing
        // them here keeps the failure a clear argument error rather than an IO error later.
        require(safeName.isNotBlank() && safeName != "." && safeName != "..") {
            "A file name is required"
        }
        directory.mkdirs()
        val target = File(directory, safeName)
        target.writeText(contents, Charsets.UTF_8)
        return target
    }

    /**
     * Whether [path] names a file this store owns, i.e. a direct child of [directory].
     *
     * Both sides are canonicalised first so a path that walks out and back in (`beacon-exports/
     * ../../databases/beacon.db`) is compared as where it actually lands. This is what stops the
     * module granting a share target read access to an arbitrary file: JavaScript hands over a
     * path, and nothing but this check limits which one.
     *
     * Existence is deliberately not part of the answer; the caller checks that separately so a
     * missing file and a path outside the directory can be told apart while debugging.
     */
    fun contains(path: String): Boolean {
        if (path.isBlank()) return false
        return runCatching {
            File(path).canonicalFile.parentFile == directory.canonicalFile
        }.getOrDefault(false)
    }

    /**
     * Deletes everything in [directory] and returns how many entries went away.
     *
     * A directory that was never created is simply empty, so clearing twice — or before the
     * first export — is a no-op that reports zero rather than a failure.
     */
    fun clear(): Int {
        val entries = directory.listFiles() ?: return 0
        // Only plain files are ever written here, but deleting recursively means a stray
        // directory cannot wedge the clear and leave the count wrong on every later call.
        return entries.count { it.deleteRecursively() }
    }

    companion object {
        /** Named after the app so it is recognisable when browsing the cache during support. */
        const val DIRECTORY_NAME = "beacon-exports"
    }
}
