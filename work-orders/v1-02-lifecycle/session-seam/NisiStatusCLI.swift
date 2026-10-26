// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Nisi — one-command self-check ("is Nisi active?" on this Mac).
//
// AGIW suite self-check, no inference: reports the chat window process, on-device
// AFM availability, the default conversation store state, and which local LM
// Studio models the provider reports as loaded (loaded_instances non-empty).
// Inventory does not prove that an inference used the reported instance.
// Loopback HTTP only; nothing leaves the machine. `--json` prints a report.
//
// Deterministic facts come straight from live sources: NSRunningApplication,
// SystemLanguageModel.availability, the store file, and 127.0.0.1:1234.

import Foundation
import FoundationModels
import AppKit

final class NisiStatusNoRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@available(macOS 26.0, *)
@main
struct NisiStatusCLI {
    enum InventoryError: Error { case http, redirect, tooLarge, invalidShape }
    static let inventoryByteLimit = 262_144

    static var defaultStoreURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let dir = base.appendingPathComponent("Nisi", isDirectory: true)
        return dir.appendingPathComponent("conversation-default.jsonl")
    }

    static func main() async {
        let json = CommandLine.arguments.contains("--json")

        // 1. Window process.
        let app = NSRunningApplication.runningApplications(withBundleIdentifier: "local.nisi.chat").first
        let window = app.map { "running (pid \($0.processIdentifier))" } ?? "not running"

        // 2. On-device AFM availability.
        let afm = SystemLanguageModel.default.availability == .available ? "available" : "unavailable"

        // 3. Default conversation store.
        var store = "unknown"
        var conversationId = "none"
        var messages = 0
        var utf16 = 0
        do {
            let (manifest, transcript) = try ConversationStore(fileURL: defaultStoreURL).load()
            conversationId = manifest.conversationId
            messages = transcript.count
            utf16 = transcript.reduce(0) { $0 + $1.text.utf16.count }
            store = "healthy (\(messages) msgs)"
        } catch StoreError.missingFile {
            store = "absent (clean start)"
        } catch {
            store = "refused (\(error))"
        }

        // 4. Provider-reported loaded models (loopback LM Studio inventory).
        var local = "server unreachable"
        var localState = "unreachable"
        var loaded: [String] = []
        do {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 2
            configuration.timeoutIntervalForResource = 2
            let client = URLSession(configuration: configuration,
                                    delegate: NisiStatusNoRedirectDelegate(), delegateQueue: nil)
            defer { client.invalidateAndCancel() }
            var request = URLRequest(url: URL(string: "http://127.0.0.1:1234/api/v1/models")!)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (bytes, response) = try await client.bytes(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw InventoryError.http
            }
            if (300..<400).contains(http.statusCode) { throw InventoryError.redirect }
            guard http.statusCode == 200 else { throw InventoryError.http }
            var data = Data()
            for try await byte in bytes {
                guard data.count < inventoryByteLimit else { throw InventoryError.tooLarge }
                data.append(byte)
            }
            guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  let models = object["models"] as? [[String: Any]] else {
                throw InventoryError.invalidShape
            }
            for model in models {
                guard let key = model["key"] as? String, !key.isEmpty,
                      let instances = model["loaded_instances"] as? [[String: Any]] else {
                    throw InventoryError.invalidShape
                }
                if !instances.isEmpty { loaded.append(key) }
            }
            localState = "running"
            local = loaded.isEmpty
                ? "inventory available; provider reports 0 loaded models"
                : "inventory available; provider reports loaded: \(loaded.joined(separator: ", "))"
        } catch InventoryError.http {
            localState = "http-error"
            local = "inventory HTTP error"
        } catch InventoryError.redirect {
            localState = "redirect"
            local = "inventory redirect refused"
        } catch InventoryError.tooLarge {
            localState = "too-large"
            local = "inventory exceeds byte cap"
        } catch InventoryError.invalidShape {
            localState = "invalid-inventory"
            local = "inventory shape invalid"
        } catch let error as URLError where error.code == .timedOut {
            localState = "timeout"
            local = "inventory timed out"
        } catch {
            local = "server unreachable"
        }

        if json {
            let report: [String: Any] = [
                "window": app?.processIdentifier ?? NSNull(),
                "afm": SystemLanguageModel.default.availability == .available ? "available" : "unavailable",
                "store": ["conversationId": conversationId, "messages": messages, "utf16": utf16, "state": store],
                "local": ["state": localState, "stateScope": "inventory-server",
                          "loaded": loaded,
                          "loadedEvidence": localState == "running" ? "provider-reported" : "not-observed",
                          "inferenceVerified": false, "generationObserved": false] as [String: Any],
            ]
            if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]),
               let text = String(data: data, encoding: .utf8) {
                print(text)
            }
        } else {
            print("window: \(window)")
            print("afm: \(afm)")
            print("store: \(store) (conversation \(conversationId), \(utf16) utf16)")
            print("local: \(local)")
        }
    }
}
