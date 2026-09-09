import Foundation

/// Error codes shared with TypeScript (`ExportErrorCode` in `@beacon/session-export`).
/// Raw values are the wire format and must match that union exactly. Only the three the
/// native module can produce are listed; the rest of the union is raised on the JavaScript
/// side and would be dead weight here.
enum ExportErrorCode: String {
  case writeFailed = "export_write_failed"
  case shareFailed = "export_share_failed"
  case fileMissing = "export_file_missing"
}

/// An export failure with a contract code, shaped like `BleError` so the Objective-C++ shim
/// can reject a promise from a plain dictionary without knowing any Swift types.
///
/// Unlike `BleError` it carries no platform diagnostics: none of these failures come from a
/// framework with a code worth showing, and the system's own description already says what
/// went wrong when a write fails.
struct ExportError: Error {
  let code: ExportErrorCode
  let message: String

  /// Anything the file layer throws that is not already ours becomes `fallback`, keeping the
  /// system's description so a full disk still reads as a full disk.
  static func from(_ error: Error, fallback: ExportErrorCode) -> ExportError {
    if let exportError = error as? ExportError {
      return exportError
    }
    return ExportError(code: fallback, message: (error as NSError).localizedDescription)
  }

  /// Dictionary form the shim turns into `reject(code, message, error)`.
  var payload: [String: Any] {
    ["code": code.rawValue, "message": message]
  }
}

/// Writes export documents to a private temporary directory and hands them to the system
/// share sheet (PROJECT.md 21).
///
/// Exposed to Objective-C++ (`BeaconExportModule.mm`) so the Turbo Module can stay a thin
/// adapter. It is only a composition of `ExportFileStore` and `ShareSheetPresenter`; the
/// behaviour lives in those two. Only Foundation types cross into Objective-C, which keeps
/// UIKit out of the generated `Beacon-Swift.h` that the shim imports.
@objc(BeaconExportManager)
public final class ExportManager: NSObject {

  private let store = ExportFileStore()
  private let presenter = ShareSheetPresenter()

  /// File work runs off the main thread. A session export is small, but the main thread is
  /// where the UI runs and is the only place the share sheet can be presented from, so the
  /// two are kept apart deliberately.
  private let queue = DispatchQueue(label: "com.beacon.export.files", qos: .userInitiated)

  /// Completes with the absolute path of the written file, or with an `ExportError.payload`
  /// dictionary. `fileName` is a name, not a location; see `ExportFileStore.write`.
  @objc public func writeTemporaryFile(
    _ fileName: String,
    contents: String,
    completion: @escaping (String?, [String: Any]?) -> Void
  ) {
    queue.async { [self] in
      do {
        let url = try store.write(fileName: fileName, contents: contents)
        completion(url.path, nil)
      } catch {
        completion(nil, ExportError.from(error, fallback: .writeFailed).payload)
      }
    }
  }

  /// Presents the share sheet for a file this module wrote and completes with whether the
  /// user went through with a share. A dismissal completes with `false` and no error.
  ///
  /// The containment check is the reason this is an export module rather than a general
  /// "share this path" call: only files inside the store's own directory ever reach the
  /// sheet, so a path that came back wrong from JavaScript cannot turn this into a way to
  /// hand out arbitrary files from the app container.
  ///
  /// `mimeType` is part of the cross-platform contract but goes unused here. iOS works out
  /// what a file is from its extension, and telling the sheet something the extension
  /// contradicts would only confuse the activities it offers.
  @objc public func shareFile(
    _ path: String,
    mimeType: String,
    completion: @escaping (Bool, [String: Any]?) -> Void
  ) {
    queue.async { [self] in
      guard store.contains(path: path), store.exists(path: path) else {
        let error = ExportError(code: .fileMissing, message: "There is no exported file at \(path)")
        completion(false, error.payload)
        return
      }
      let url = URL(fileURLWithPath: path)
      DispatchQueue.main.async {
        self.presenter.present(fileURL: url) { completed in
          guard let completed else {
            let error = ExportError(code: .shareFailed, message: "There is no screen to share from")
            completion(false, error.payload)
            return
          }
          completion(completed, nil)
        }
      }
    }
  }

  /// Completes with how many files were removed. Never reports an error: a directory that is
  /// already empty, or was never created, is the state the caller asked for.
  @objc public func clearTemporaryFiles(_ completion: @escaping (Int) -> Void) {
    queue.async { [self] in
      completion(store.clear())
    }
  }
}
