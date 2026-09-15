import Foundation
import Testing
@testable import VeritasCore

// MAC1's first evidence-envelope conformance slice: run the real Swift pipeline
// against a predeclared TypeScript oracle, never Swift-recorded snapshots.
// This does not claim full engine-driver, advisory, or platform parity.
private let engineFixtureDigest =
    "1a47b395f54c533cf78ad52f6e1024ea4ba5a41153ce95de12ba99bb316e560b"

private struct EngineEvidenceFixture: Decodable {
    let schemaVersion: Int
    let contract: String
    let scope: String
    let fullEngineParity: Bool
    let modelExecuted: Bool
    let externalAuthority: Bool
    let vectors: [EngineEvidenceVector]
}

private struct EngineEvidenceVector: Decodable {
    let id: String
    let label: String
    let request: EngineEvidenceRequest
    let expectedCanonical: String
    var expectedDigest: String
    let expectedProfileFingerprint: String
}

private struct EngineEvidenceRequest: Decodable {
    let kind: ArtifactKind
    let utf8: String?
    let hex: String?
    let `repeat`: Int
    let mode: VeritasMode
    let profile: EngineEvidenceProfile

    func snapshot() throws -> ArtifactSnapshot {
        guard (utf8 == nil) != (hex == nil), (1...1_048_577).contains(`repeat`) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let bytes: Data
        if let utf8 {
            bytes = Data(String(repeating: utf8, count: `repeat`).utf8)
        } else if let hex {
            guard hex.utf8.count.isMultiple(of: 2), `repeat` == 1 else {
                throw CocoaError(.fileReadCorruptFile)
            }
            let chars = Array(hex)
            var decoded: [UInt8] = []
            for index in stride(from: 0, to: chars.count, by: 2) {
                guard let byte = UInt8(String(chars[index...index + 1]), radix: 16) else {
                    throw CocoaError(.fileReadCorruptFile)
                }
                decoded.append(byte)
            }
            bytes = Data(decoded)
        } else {
            throw CocoaError(.fileReadCorruptFile)
        }
        // Direct construction deliberately tests the gate's own empty/size guards.
        return ArtifactSnapshot(displayName: "mac1-private-fixture", kind: kind, bytes: bytes)
    }
}

private struct EngineEvidenceProfile: Decodable {
    let id: String
    let requiredSections: [String]
    let allowedAdvisoryDimensions: [AdvisoryDimension]
    let modelParticipationRequired: Bool
    let maximumAdvisoryDimensions: Int

    var profile: CheckProfile {
        CheckProfile(
            id: id,
            requiredSections: requiredSections,
            allowedAdvisoryDimensions: Set(allowedAdvisoryDimensions),
            modelParticipationRequired: modelParticipationRequired,
            maximumAdvisoryDimensions: maximumAdvisoryDimensions
        )
    }
}

private func loadEngineEvidenceFixture() throws -> EngineEvidenceFixture {
    let url = try #require(Bundle.module.url(
        forResource: "engine-evidence-v1", withExtension: "json", subdirectory: "Fixtures"
    ))
    let data = try Data(contentsOf: url)
    // Refuse unknown fixture bytes before decoding or evaluating any input recipe.
    guard ArtifactSnapshot.digest(data) == engineFixtureDigest else {
        throw CocoaError(.fileReadCorruptFile)
    }
    let fixture = try JSONDecoder().decode(EngineEvidenceFixture.self, from: data)
    guard fixture.schemaVersion == 1,
          fixture.contract == "veritas-mac1-engine-evidence-v1",
          fixture.scope == "ACTUAL_SWIFT_PIPELINE_DETERMINISTIC_ONLY_EVIDENCE_ENVELOPE",
          !fixture.fullEngineParity, !fixture.modelExecuted, !fixture.externalAuthority,
          fixture.vectors.map(\.id) == (1...20).map({ String(format: "MAC1-EV-%03d", $0) }) else {
        throw CocoaError(.fileReadCorruptFile)
    }
    return fixture
}

private func matchesEngineOracle(_ result: PipelineResult, _ vector: EngineEvidenceVector) -> Bool {
    result.resultEvidenceData == Data(vector.expectedCanonical.utf8)
        && result.resultEvidenceDigest == vector.expectedDigest
        && result.profileFingerprint == vector.expectedProfileFingerprint
}

@Suite("MAC1 private cross-language evidence envelope")
struct EngineEvidenceParityTests {
    @Test("Actual Swift result matches independently declared TypeScript bytes and SHA-256", arguments: 1...20)
    func exactEnvelope(caseNumber: Int) async throws {
        let vector = try loadEngineEvidenceFixture().vectors[caseNumber - 1]
        let pipeline = VeritasPipeline(
            analyzer: DeterministicOnlyOrchestrator(reasonCode: "MAC1_MODEL_UNAVAILABLE")
        )
        let result = await pipeline.analyze(
            snapshot: try vector.request.snapshot(),
            profile: vector.request.profile.profile,
            mode: vector.request.mode
        )
        #expect(matchesEngineOracle(result, vector), "Contract case: \(vector.id) — \(vector.label)")
        #expect(result.advisoryReceipt == nil)
        #expect(result.findings.isEmpty)
        #expect(result.modelParticipation != .participated)
    }

    @Test("A substituted expected digest is detected, not silently regenerated")
    func expectationMutationControl() async throws {
        var vector = try loadEngineEvidenceFixture().vectors[0]
        let pipeline = VeritasPipeline(
            analyzer: DeterministicOnlyOrchestrator(reasonCode: "MAC1_MODEL_UNAVAILABLE")
        )
        let result = await pipeline.analyze(
            snapshot: try vector.request.snapshot(),
            profile: vector.request.profile.profile,
            mode: vector.request.mode
        )
        #expect(matchesEngineOracle(result, vector))
        vector.expectedDigest = String(repeating: "0", count: 64)
        #expect(!matchesEngineOracle(result, vector))
    }

    @Test("Changed artifact bytes cannot replay a prior vector's favorable digest")
    func subjectMutationControl() async throws {
        let vector = try loadEngineEvidenceFixture().vectors[0]
        let original = try vector.request.snapshot()
        let changed = ArtifactSnapshot(
            displayName: original.displayName, kind: original.kind,
            bytes: original.bytes + Data(" ".utf8)
        )
        let pipeline = VeritasPipeline(
            analyzer: DeterministicOnlyOrchestrator(reasonCode: "MAC1_MODEL_UNAVAILABLE")
        )
        let result = await pipeline.analyze(
            snapshot: changed, profile: vector.request.profile.profile, mode: vector.request.mode
        )
        #expect(result.deterministicPassed)
        #expect(result.subjectDigest != original.subjectDigest)
        #expect(!matchesEngineOracle(result, vector))
    }
}
