import UIKit

/// Presents the system share sheet for a file the export module wrote (PROJECT.md 21).
///
/// Split out from `ExportManager` so `ExportFileStore` can stay free of UIKit and be unit
/// tested. Nothing here can be: it all needs a live window, so it is checked by hand.
final class ShareSheetPresenter {

  /// Presents `UIActivityViewController` for `fileURL` and calls back with whether the user
  /// went through with an activity. `false` means they dismissed the sheet, which is an
  /// ordinary outcome and not a failure. `nil` means there was no view controller to present
  /// from, which is the one case the caller has to report as an error.
  ///
  /// Must be called on the main thread: presenting is main-thread only, and so is walking the
  /// scene graph to find something to present from.
  func present(fileURL: URL, completion: @escaping (Bool?) -> Void) {
    guard let presenting = ShareSheetPresenter.topViewController() else {
      completion(nil)
      return
    }

    let controller = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
    controller.completionWithItemsHandler = { _, completed, _, _ in
      completion(completed)
    }

    // On iPad the sheet is a popover, and UIKit raises rather than guessing when a popover
    // has nothing to point at. Anchoring it to the centre of the presenting view with no
    // arrow gives a centred sheet instead of one pointing at an unrelated control.
    if let popover = controller.popoverPresentationController, let sourceView = presenting.view {
      popover.sourceView = sourceView
      popover.sourceRect = CGRect(x: sourceView.bounds.midX, y: sourceView.bounds.midY, width: 1, height: 1)
      popover.permittedArrowDirections = []
    }

    presenting.present(controller, animated: true)
  }

  /// The deepest view controller already on screen. Presenting from anything further up the
  /// chain while it has something presented is ignored by UIKit, so the sheet would never
  /// appear.
  private static func topViewController() -> UIViewController? {
    guard let window = ShareSheetPresenter.keyWindow() else { return nil }
    var top = window.rootViewController
    while let presented = top?.presentedViewController, !presented.isBeingDismissed {
      top = presented
    }
    return top
  }

  /// The key window of the scene the user is looking at. The foreground scene is preferred
  /// over any other: on iPad the app can have several, and a sheet presented into a
  /// background one would be somewhere nobody can see it.
  private static func keyWindow() -> UIWindow? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let foreground = scenes.first(where: { $0.activationState == .foregroundActive })
    guard let scene = foreground ?? scenes.first else { return nil }
    if let key = scene.keyWindow {
      return key
    }
    if let key = scene.windows.first(where: { $0.isKeyWindow }) {
      return key
    }
    return scene.windows.first
  }
}
