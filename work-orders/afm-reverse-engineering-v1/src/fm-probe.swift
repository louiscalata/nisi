// AFM SystemLanguageModel availability probe — macOS 27 (26A428).
// Compile-time + minimal runtime proof that the public FoundationModels
// framework resolves on this machine before building the tools bridge.
import Foundation
import FoundationModels

if #available(macOS 26.0, *) {
    print("SystemLanguageModel: \(SystemLanguageModel.self)")
    let t = SystemLanguageModel.self as Any.Type
    print("type resolved: \(String(describing: t))")
} else {
    print("SystemLanguageModel: NOT AVAILABLE (< macOS 26)")
}