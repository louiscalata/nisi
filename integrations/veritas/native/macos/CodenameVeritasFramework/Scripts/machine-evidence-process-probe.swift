import Darwin
import Foundation

// Compiled explicitly alongside MachineEvidence.swift for bounded private
// transport checks. Not a package target/product, ledger helper, or authority.
@main
enum MachineEvidenceProcessProbe {
    static func main() throws {
        guard CommandLine.arguments.count == 3,
              ["A", "B"].contains(CommandLine.arguments[1]),
              ["normal", "kill-before", "kill-after"].contains(CommandLine.arguments[2]),
              let sink = try MachineEvidence.Sink.from(ProcessInfo.processInfo.environment) else { exit(64) }
        let writer = CommandLine.arguments[1], mode = CommandLine.arguments[2]
        var start: UInt8 = 0
        guard read(STDIN_FILENO, &start, 1) == 1, start == 1 else { exit(65) }
        if mode == "kill-before" { raise(SIGKILL); exit(66) }
        for index in 0..<64 {
            let frame = "VERITAS_BASELINE_A_RESULT|case=transport-process|writer=\(writer)|index=\(index)|" + String(repeating: "x", count: 1024)
            try MachineEvidence.append(MachineEvidence.bytes(for: frame), to: sink)
            if mode == "kill-after" { raise(SIGKILL); exit(67) }
        }
    }
}
