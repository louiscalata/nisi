import Foundation
import Testing

extension MachineEvidence {
    public static func record(_ frame: String, sourceLocation: SourceLocation = #_sourceLocation) {
        do {
            try deliver(frame, environment: ProcessInfo.processInfo.environment)
        } catch {
            // Do not echo a possibly sensitive or malformed frame into the human log.
            Issue.record("Private machine-evidence transport refused: \(error)", sourceLocation: sourceLocation)
        }
    }
}
