import Foundation

/// Owns the temporary directory the export module writes into, and is the only thing that
/// decides whether a path belongs to it (PROJECT.md 21).
///
/// Pure Swift with no UIKit dependency: writing a document and deciding whether a path is
/// ours is plain file work, so it is unit tested. Presenting the result is a separate job and
/// lives in `ShareSheetPresenter`.
///
/// The store keeps a named subdirectory of the app's temporary directory rather than using
/// that directory directly, so `clear()` can never remove something another part of the app
/// left there.
final class ExportFileStore {

  /// Absolute URL of the directory this store owns. It is created on the first write; until
  /// then it simply does not exist, which is not an error anywhere in this file.
  let directory: URL

  private let fileManager: FileManager

  init(directory: URL = ExportFileStore.defaultDirectory, fileManager: FileManager = .default) {
    self.directory = directory
    self.fileManager = fileManager
  }

  /// The directory the app uses: `<tmp>/beacon-exports`.
  static var defaultDirectory: URL {
    URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent("beacon-exports", isDirectory: true)
  }

  /// Writes `contents` as UTF-8 and returns the file's URL, replacing any file already there
  /// under the same name.
  ///
  /// Only the last path component of `fileName` is used: the caller names a file, it does not
  /// get to choose where in the container that file lands.
  func write(fileName: String, contents: String) throws -> URL {
    let name = (fileName as NSString).lastPathComponent
    // `lastPathComponent` reduces "../" to ".." and "/" to "/", both of which would still
    // point outside the directory, so those names are refused rather than sanitised further.
    guard !name.isEmpty, name != ".", name != "..", !name.contains("/") else {
      throw ExportError(code: .writeFailed, message: "\"\(fileName)\" is not a usable file name")
    }
    do {
      try fileManager.createDirectory(at: directory, withIntermediateDirectories: true, attributes: nil)
      let url = directory.appendingPathComponent(name, isDirectory: false)
      try contents.write(to: url, atomically: true, encoding: .utf8)
      return url
    } catch {
      throw ExportError(code: .writeFailed, message: (error as NSError).localizedDescription)
    }
  }

  /// True when `path` names something inside this store's directory.
  ///
  /// Both sides are standardised and symlink-resolved before they are compared, so a `..` in
  /// the middle of the path cannot walk out of the directory and back in through a name that
  /// looks right. The comparison is component by component rather than on the string, so a
  /// sibling directory whose name merely starts with ours does not pass either.
  func contains(path: String) -> Bool {
    let root = ExportFileStore.normalized(directory).pathComponents
    let candidate = ExportFileStore.normalized(URL(fileURLWithPath: path)).pathComponents
    guard candidate.count > root.count else { return false }
    return Array(candidate.prefix(root.count)) == root
  }

  /// True when `path` names a file that is actually on disk. Kept apart from
  /// `contains(path:)` because the two answer different questions, even though the caller
  /// reports the same error for both: a path we never wrote and a path that has since been
  /// cleared are equally unshareable.
  func exists(path: String) -> Bool {
    fileManager.fileExists(atPath: path)
  }

  /// Removes everything in the directory and returns how many entries were removed.
  ///
  /// Never fails. A directory that was never created, or a file that disappeared underneath
  /// us, both leave the caller with what it asked for, so there is nothing to report.
  func clear() -> Int {
    let contents = (try? fileManager.contentsOfDirectory(
      at: directory,
      includingPropertiesForKeys: nil,
      options: []
    )) ?? []
    var removed = 0
    for url in contents {
      do {
        try fileManager.removeItem(at: url)
        removed += 1
      } catch {
        // Something else got there first. The file is gone either way; it just was not us.
        continue
      }
    }
    return removed
  }

  /// `standardized` is the documented removal of `.` and `..`, `resolvingSymlinksInPath` the
  /// documented resolution of links: a traversal has to survive both to be counted as ours.
  ///
  /// A path that is not on disk can normalise differently from one that is, because symlink
  /// resolution leaves components it cannot find alone. That only ever loses a match, and a
  /// file that is not there is refused anyway, so it costs nothing here.
  private static func normalized(_ url: URL) -> URL {
    url.standardized.resolvingSymlinksInPath()
  }
}
