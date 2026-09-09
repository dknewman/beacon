package com.beacon.export

import android.content.Intent
import androidx.core.content.FileProvider
import com.beacon.bluetooth.spec.NativeBeaconExportSpec
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File

/**
 * Turbo Native Module bridging the TypeScript spec (NativeBeaconExport.ts) to [ExportFileStore]
 * and the platform share sheet. Keep this class thin: it maps calls, and owns nothing about the
 * files themselves.
 */
class BeaconExportModule(reactContext: ReactApplicationContext) :
    NativeBeaconExportSpec(reactContext) {

    private val store = ExportFileStore(reactContext.applicationContext.cacheDir)

    override fun writeTemporaryFile(fileName: String, contents: String, promise: Promise) {
        try {
            promise.resolve(store.write(fileName, contents).absolutePath)
        } catch (error: Exception) {
            promise.reject(ERROR_WRITE_FAILED, error.message ?: "Could not write the export file", error)
        }
    }

    /**
     * Presents the share sheet for a file this module wrote.
     *
     * Resolves true once the chooser has been started, not once a share has completed. Android
     * cannot report completion: the chooser finishes as soon as a target is picked, the target
     * runs in its own task, and almost every one of them returns RESULT_CANCELED whether the
     * user sent the document or backed out of it. Wiring an ActivityEventListener and
     * startActivityForResult here is easy enough, but it would resolve false for successful
     * shares far more often than for real dismissals, which is worse than not answering the
     * question. So the boolean means "the sheet was presented"; the TypeScript contract treats a
     * false as a dismissal, and on Android it simply never sees one.
     */
    override fun shareFile(path: String, mimeType: String, promise: Promise) {
        val file = File(path)
        if (!store.contains(path) || !file.isFile) {
            // The share grants the chosen app read access to whatever URI it is handed, so a path
            // from JavaScript is only ever shared after the store confirms it wrote it.
            promise.reject(ERROR_FILE_MISSING, "No export file at $path")
            return
        }
        val activity = reactApplicationContext.currentActivity
        if (activity == null) {
            // A chooser has to be started from the foreground Activity; without one there is
            // nothing to attach the sheet to, and starting it from the application context would
            // put it in its own task behind the app.
            promise.reject(ERROR_SHARE_FAILED, "There is no active screen to present the share sheet from")
            return
        }
        try {
            val authority = "${reactApplicationContext.packageName}.exports"
            val uri = FileProvider.getUriForFile(reactApplicationContext, authority, file)
            val send = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            // The flag is repeated on the chooser because the grant travels with the Intent that
            // is actually started, and the chooser is what gets started here.
            val chooser = Intent.createChooser(send, null).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(chooser)
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject(ERROR_SHARE_FAILED, error.message ?: "Could not present the share sheet", error)
        }
    }

    /** Resolves a Double because the spec returns a JavaScript `number`, which has no integers. */
    override fun clearTemporaryFiles(promise: Promise) {
        promise.resolve(store.clear().toDouble())
    }

    private companion object {
        /** Wire values shared with TypeScript (`ExportErrorCode` in `@beacon/session-export`). */
        const val ERROR_WRITE_FAILED = "export_write_failed"
        const val ERROR_SHARE_FAILED = "export_share_failed"
        const val ERROR_FILE_MISSING = "export_file_missing"
    }
}
