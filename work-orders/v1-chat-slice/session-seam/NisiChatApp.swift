// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Nisi V1-01 chat window — application entry point.
//
// Launch target for the explicit native-verification step and for interactive
// use. Separate binary from `nisi-chat`: this one includes NisiChatWindow +
// this entry point and intentionally excludes NisiChatCLI (own @main). One
// window owns the visible state for the shared conversation session.
//
// Focus behavior: launched as a proper .app bundle, this registers as a regular
// foreground app and activates itself so keyboard input reaches the window
// (a bare binary started from a shell cannot reliably take key focus).

import SwiftUI
import AppKit

@available(macOS 26.0, *)
final class NisiAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            NSApp.windows.first?.makeKeyAndOrderFront(nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}

@available(macOS 26.0, *)
@main
struct NisiChatApp: App {
    @NSApplicationDelegateAdaptor(NisiAppDelegate.self) private var delegate
    let session: NisiChatSession

    init() {
        do {
            session = try NisiChatSession(maxContextUtf16: 8192)
        } catch {
            fatalError("session init: \(error)")
        }
    }

    var body: some Scene {
        Window("Nisi", id: "main") {
            NisiChatWindow(session: session)
        }
    }
}
