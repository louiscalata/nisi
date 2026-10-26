import Darwin
import Foundation
import VeritasAppleFoundation
import VeritasCore

/// Opt-in evidence probe for the production orchestration path.
///
/// Teaching sequence:
/// 1. Freeze benign bytes and derive their SHA-256 subject identity.
/// 2. Run deterministic gates before any model call.
/// 3. Ask Apple Foundation Models for a bounded, non-authorizing plan/finding.
/// 4. Let VeritasCore validate every model field and create a digest-only receipt.
/// 5. Report participation only when the complete receipt and quiescence checks pass.
///
/// The probe never stores the artifact or transcript and never grants acceptance,
/// execution, certification, repair, publication, or policy authority.
@main
struct VeritasAFMFunctionalProbe {
    private struct Evidence: Encodable {
        let schemaVersion: Int
        let status: String
        let evidenceClass: String
        let target: String
        let subjectDigest: String
        let profileFingerprint: String
        let deterministicChecks: [CheckOutcome]
        let deterministicPassed: Bool
        let modelParticipation: ModelParticipation
        let disposition: PipelineDisposition
        let advisoryReceiptDigest: String?
        let advisoryReceipt: AdvisoryRunReceipt?
        let quiescent: Bool
        let limitationCodes: [String]
        let rawArtifactPersisted: Bool
        let transcriptPersisted: Bool
        let externalToolsEnabled: Bool
        let acceptanceAuthorityGranted: Bool
    }

    static func main() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        if arguments == ["--paired-prevention"] {
            do {
                let value = try await AppleFoundationPreventionProbe.run()
                let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
                FileHandle.standardOutput.write(try encoder.encode(value))
                FileHandle.standardOutput.write(Data("\n".utf8))
                exit(value.status == "COMPLETED_AFM_DRAFTING_TRIAL" ? 0 : 2)
            } catch {
                // No raw model/transport error or artifact goes into diagnostics.
                FileHandle.standardError.write(Data("AFM_PAIRED_PROBE_ABORTED\n".utf8)); exit(1)
            }
        }
        guard arguments.isEmpty else {
            FileHandle.standardError.write(Data("AFM_PROBE_ARGUMENTS_REFUSED\n".utf8)); exit(64)
        }
        let fixture = #"{"purpose":"bounded local orchestration evidence","authority":"none"}"#
        let snapshot = ArtifactSnapshot(
            displayName: "afm-functional-probe.json",
            kind: .json,
            bytes: Data(fixture.utf8)
        )
        let profile = CheckProfile(
            id: "veritas-afm-functional-probe-v1",
            allowedAdvisoryDimensions: [.risk],
            modelParticipationRequired: true,
            maximumAdvisoryDimensions: 1
        )
        let pipeline = VeritasPipeline(
            analyzer: AppleFoundationOrchestratorFactory.make()
        )
        let result = await pipeline.analyze(
            snapshot: snapshot,
            profile: profile,
            mode: .assist
        )
        let quiescent = await waitForQuiescence(pipeline)
        let passed = result.deterministicPassed
            && result.modelParticipation == .participated
            && result.disposition == .ready
            && result.canAcceptInsideVeritas
            && result.advisoryReceipt?.outcome == .completed
            && result.advisoryReceiptDigest?.count == 64
            && quiescent

        let status: String
        let exitCode: Int32
        if passed {
            status = "PASS"
            exitCode = 0
        } else if result.modelParticipation == .unavailable {
            status = "NOT_RUN_UNAVAILABLE"
            exitCode = 2
        } else {
            status = "FAIL"
            exitCode = 1
        }

        let evidence = Evidence(
            schemaVersion: 1,
            status: status,
            evidenceClass: "SELF_ADMINISTERED_NATIVE_AFM_FUNCTIONAL_PROBE",
            target: PlatformRequirements.targetDescription,
            subjectDigest: snapshot.subjectDigest,
            profileFingerprint: profile.rulesFingerprint,
            deterministicChecks: result.deterministicChecks,
            deterministicPassed: result.deterministicPassed,
            modelParticipation: result.modelParticipation,
            disposition: result.disposition,
            advisoryReceiptDigest: result.advisoryReceiptDigest,
            advisoryReceipt: result.advisoryReceipt,
            quiescent: quiescent,
            limitationCodes: result.limitationCodes,
            rawArtifactPersisted: false,
            transcriptPersisted: false,
            externalToolsEnabled: false,
            acceptanceAuthorityGranted: false
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        do {
            let data = try encoder.encode(evidence)
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            FileHandle.standardError.write(Data("AFM_PROBE_EVIDENCE_ENCODING_FAILED\n".utf8))
            exit(1)
        }
        exit(exitCode)
    }

    private static func waitForQuiescence(_ pipeline: VeritasPipeline) async -> Bool {
        for _ in 0..<20 {
            if await pipeline.analyzerIsQuiescent() { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return await pipeline.analyzerIsQuiescent()
    }
}
