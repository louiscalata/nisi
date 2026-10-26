import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model: AppModel

    override init() {
        model = AppModel()
        super.init()
    }

#if DEBUG
    // Intercept only AppKit's final reply in private hosted tests. The actual
    // termination state machine and AppModel shutdown still execute below.
    private var terminationReplyForTesting: ((NSApplication, Bool) -> Void)?
    private(set) var terminationLaunchCountForTesting = 0
    init(model: AppModel, terminationReply: @escaping (NSApplication, Bool) -> Void) {
        self.model = model
        terminationReplyForTesting = terminationReply
        super.init()
    }
    func awaitTerminationForTesting() async { await terminationTask?.value }
#endif

    private enum TerminationPhase {
        case running
        case draining
        case replied
    }

    private var terminationPhase: TerminationPhase = .running
    private var terminationTask: Task<Void, Never>?

    func applicationShouldTerminate(
        _ sender: NSApplication
    ) -> NSApplication.TerminateReply {
        switch terminationPhase {
        case .running:
            terminationPhase = .draining
            model.beginShutdown()
#if DEBUG
            terminationLaunchCountForTesting += 1
#endif
            terminationTask = Task { @MainActor [self] in
                await model.finishShutdown()
                terminationPhase = .replied
                terminationTask = nil
                replyToTermination(sender)
            }
            return .terminateLater
        case .draining:
            return .terminateLater
        case .replied:
            return .terminateNow
        }
    }

    private func replyToTermination(_ sender: NSApplication) {
#if DEBUG
        if let observer = terminationReplyForTesting {
            observer(sender, true)
            return
        }
#endif
        sender.reply(toApplicationShouldTerminate: true)
    }
}

@main
struct NisiMenuBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self)
    private var appDelegate

    var body: some Scene {
        MenuBarExtra("Nisi", systemImage: "circle.dashed") {
            MenuBarView(model: appDelegate.model)
        }
        .menuBarExtraStyle(.window)
    }
}
