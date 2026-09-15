import Foundation
import Testing
@testable import VeritasCore

private struct ArtifactOracle: Decodable {
    let objectsHex: [String: String]
    let objectSHA256: [String: String]
    let subjectSHA256, profileSHA256, inputHex, inputSHA256, modelSHA256: String
    let contextSHA256, preparedSHA256, resultSHA256, outputHex: String
}
private func artifactHex(_ text: String) throws -> Data {
    #expect(text.count.isMultiple(of: 2))
    var bytes = Data(); var index = text.startIndex
    while index < text.endIndex {
        let end = text.index(index, offsetBy: 2)
        bytes.append(try #require(UInt8(text[index..<end], radix: 16)))
        index = end
    }
    return bytes
}
private func artifactOracleBytes() throws -> Data {
    try Data(contentsOf: #require(Bundle.module.url(forResource: "reference-artifact-package-v1", withExtension: "json", subdirectory: "Fixtures")))
}
private func artifactOracle() throws -> ArtifactOracle { try JSONDecoder().decode(ArtifactOracle.self, from: artifactOracleBytes()) }
private func artifactPlugin() throws -> ReferenceArtifactPlugin {
    try .resolve(.artifactProfileV1, objects: ReferenceArtifactPlugin.embeddedObjects)
}
private func artifactProfile(id: String = "profile.test") -> CheckProfile {
    .init(id: id, requiredSections: ["Testing", "Deployment"],
          allowedAdvisoryDimensions: [.completeness, .factualSupport, .style], maximumAdvisoryDimensions: 2)
}
private func artifactSnapshot(_ bytes: Data = Data("abc".utf8), kind: ArtifactKind = .markdown, name: String = "private.md") -> ArtifactSnapshot {
    .init(displayName: name, kind: kind, bytes: bytes)
}
private func artifactCapture(snapshot: ArtifactSnapshot = artifactSnapshot(), profile: CheckProfile = artifactProfile(),
                             scope: String = "scope.test", run: String = "run.test", subject: String? = nil,
                             profileDigest: String? = nil, observed: Int = 7, cutoff: Int = 9,
                             plugin: ReferenceArtifactPlugin? = nil) throws -> ReferenceArtifactFeatureCapture {
    try .init(plugin: plugin ?? artifactPlugin(), snapshot: snapshot, profile: profile,
        scopeID: scope, runID: run, expectedSubjectSHA256: subject ?? snapshot.subjectDigest,
        expectedProfileSHA256: profileDigest ?? profile.rulesFingerprint,
        observedThroughEvent: observed, cutoffEvent: cutoff)
}
private func artifactRefuses<E: Error & Equatable>(_ expected: E, _ body: () throws -> Void) {
    do { try body(); Issue.record("Missing refusal: \(expected)") }
    catch let error as E { #expect(error == expected) }
    catch { Issue.record("Wrong error: \(error)") }
}
private func artifactEvaluate(_ capture: ReferenceArtifactFeatureCapture) throws -> PreparedReferenceMLPEvaluation.Result {
    try capture.prepared.evaluate(deadline: .now.advanced(by: .milliseconds(900)))
}

@Suite("BN-01 — Embedded reference package and artifact features")
struct ReferenceArtifactPluginTests {
    @Test("Source-pinned objects equal the independently frozen preimplementation oracle")
    func frozenObjects() throws {
        #expect(try ArtifactSnapshot.digest(artifactOracleBytes()) == "9d755c7d4cfb9d3df7c111fa3a7220131f8402d9b9a0e90c5dc7c4952d22ec68")
        let oracle = try artifactOracle()
        #expect(oracle.objectsHex.count == 6 && oracle.objectSHA256.count == 6)
        let objects = ReferenceArtifactPlugin.embeddedObjects
        for component in ReferenceArtifactPlugin.Component.allCases {
            let actual = try #require(objects[component])
            #expect(try actual == artifactHex(#require(oracle.objectsHex[component.rawValue])))
            #expect(ArtifactSnapshot.digest(actual) == oracle.objectSHA256[component.rawValue])
        }
        let plugin = try artifactPlugin()
        #expect(plugin.packageSHA256 == oracle.objectSHA256["manifest"])
        #expect(plugin.featureSchemaSHA256 == oracle.objectSHA256["schema"])
        #expect(plugin.preprocessingSHA256 == oracle.objectSHA256["preprocessing"])
        #expect(plugin.model.modelSHA256 == oracle.modelSHA256)
        #expect(plugin.model.shape.cost.weightBytes == 160)
        #expect(plugin.model.shape.cost.scalarOperations == 68)
        #expect(plugin.model.shape.output * 4 == 16)
    }

    @Test("Every missing, wrong-length or same-length modified object refuses")
    func objectRefusals() throws {
        for component in ReferenceArtifactPlugin.Component.allCases {
            var objects = ReferenceArtifactPlugin.embeddedObjects
            objects[component] = nil
            artifactRefuses(ReferenceArtifactPlugin.Failure.missingObject(component)) { _ = try ReferenceArtifactPlugin.resolve(.artifactProfileV1, objects: objects) }
            for delta in [-1, 1] {
                objects = ReferenceArtifactPlugin.embeddedObjects
                var bytes = try #require(objects[component])
                if delta < 0 { bytes.removeLast() } else { bytes.append(0) }
                objects[component] = bytes
                artifactRefuses(ReferenceArtifactPlugin.Failure.objectByteCount(component)) { _ = try ReferenceArtifactPlugin.resolve(.artifactProfileV1, objects: objects) }
            }
            objects = ReferenceArtifactPlugin.embeddedObjects
            var bytes = try #require(objects[component]); bytes[bytes.startIndex] ^= 1
            objects[component] = bytes
            artifactRefuses(ReferenceArtifactPlugin.Failure.objectDigestMismatch(component)) { _ = try ReferenceArtifactPlugin.resolve(.artifactProfileV1, objects: objects) }
        }
    }

    @Test("Self-resealed changed weights do not replace the source-selected pins")
    func selfReseal() throws {
        var objects = ReferenceArtifactPlugin.embeddedObjects
        let old = try #require(objects[.weights])
        var weights = old; weights[0] ^= 1; objects[.weights] = weights
        let manifestBytes = try #require(objects[.manifest])
        let originalManifest = try #require(String(data: manifestBytes, encoding: .utf8))
        let manifest = originalManifest.replacingOccurrences(of: ArtifactSnapshot.digest(old), with: ArtifactSnapshot.digest(weights))
        #expect(manifest != originalManifest)
        objects[.manifest] = Data(manifest.utf8)
        artifactRefuses(ReferenceArtifactPlugin.Failure.objectDigestMismatch(.weights)) { _ = try ReferenceArtifactPlugin.resolve(.artifactProfileV1, objects: objects) }
        // The resolver has no caller-supplied pin/hash override or dynamic registration API.
    }

    @Test("Real adapter, prepared v2 and owner return frozen values and identities")
    func exactEndToEnd() async throws {
        let oracle = try artifactOracle()
        let capture = try artifactCapture(subject: oracle.subjectSHA256, profileDigest: oracle.profileSHA256)
        #expect(try capture.inputBytes == artifactHex(oracle.inputHex))
        #expect(capture.subjectSHA256 == oracle.subjectSHA256 && capture.profileSHA256 == oracle.profileSHA256)
        #expect(capture.contextSHA256 == oracle.contextSHA256)
        #expect(capture.prepared.inputSHA256 == oracle.inputSHA256)
        #expect(capture.prepared.preparedSHA256 == oracle.preparedSHA256)
        let owner = try ReferenceMLPShadowOwner(scopeID: "scope.test",
            budget: .init(maxWeightBytes: 160, maxOperations: 68, maxOutputBytes: 16, maxInferenceMs: 1000))
        try await withAsyncTestCleanup(operation: {
            #expect(await owner.state == .off)
            try await owner.enable()
            let permit = try await owner.grant(capture.prepared, deadline: .now.advanced(by: .milliseconds(900)))
            let ticket = try await owner.begin(permit)
            let result = try await owner.result(for: ticket)
            #expect(try result.outputBytes == artifactHex(oracle.outputHex))
            #expect(result.contextSHA256 == oracle.contextSHA256)
            #expect(result.resultSHA256 == oracle.resultSHA256)
            #expect(result.preparedSHA256 == oracle.preparedSHA256 && !result.authoritative)
            #expect(await owner.state == .ready)
        }, cleanup: { await owner.off() })
    }

    @Test("IDs and selected digest grammar are bounded with deterministic precedence")
    func selectionSyntax() throws {
        for bad in ["", "A", "1a", "a/b", "a\n", "a\0b", "é", String(repeating: "a", count: 97)] {
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.invalidScopeID) { _ = try artifactCapture(scope: bad) }
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.invalidRunID) { _ = try artifactCapture(run: bad) }
        }
        for bad in ["", String(repeating: "0", count: 63), String(repeating: "0", count: 65), String(repeating: "A", count: 64), String(repeating: "g", count: 64)] {
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.malformedSubjectDigest) { _ = try artifactCapture(subject: bad) }
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.malformedProfileDigest) { _ = try artifactCapture(profileDigest: bad) }
        }
        artifactRefuses(ReferenceArtifactFeatureCapture.Failure.invalidScopeID) { _ = try artifactCapture(scope: "", run: "", subject: "") }
        _ = try artifactCapture(scope: String(repeating: "a", count: 96), run: String(repeating: "b", count: 96))
    }

    @Test("Event bounds refuse post-cutoff metadata without claiming authenticated history")
    func events() throws {
        for bad in [Int.min, -1, 2_147_483_648, Int.max] {
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.invalidEvent) { _ = try artifactCapture(observed: bad) }
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.invalidEvent) { _ = try artifactCapture(cutoff: bad) }
        }
        artifactRefuses(ReferenceArtifactFeatureCapture.Failure.postCutoff) { _ = try artifactCapture(observed: 10, cutoff: 9) }
        _ = try artifactCapture(observed: 0, cutoff: 0)
        _ = try artifactCapture(observed: 2_147_483_647, cutoff: 2_147_483_647)
    }

    @Test("Public snapshot bypasses still refuse empty, oversized or invalid UTF8 input")
    func snapshotRefusals() throws {
        for bytes in [Data(), Data(repeating: 97, count: 1_048_577)] {
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.snapshotByteCount) { _ = try artifactCapture(snapshot: artifactSnapshot(bytes)) }
        }
        for bytes in [Data([0xff]), Data([0xc0, 0xaf]), Data([0xe2, 0x82])] {
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.invalidUTF8) { _ = try artifactCapture(snapshot: artifactSnapshot(bytes)) }
        }
        artifactRefuses(ReferenceArtifactFeatureCapture.Failure.subjectDigestMismatch) { _ = try artifactCapture(subject: String(repeating: "0", count: 64)) }
    }

    @Test("Resource-refused profiles and changed selected profile identities refuse")
    func profileRefusals() throws {
        for profile in [CheckProfile(id: ""), CheckProfile(id: "p", requiredSections: Array(repeating: "s", count: 65)), CheckProfile(id: "p", requiredSections: [String(repeating: "s", count: 257)])] {
            artifactRefuses(ReferenceArtifactFeatureCapture.Failure.profileResourceRefused) { _ = try artifactCapture(profile: profile) }
        }
        artifactRefuses(ReferenceArtifactFeatureCapture.Failure.profileDigestMismatch) {
            _ = try artifactCapture(profile: artifactProfile(id: "changed"), profileDigest: artifactProfile().rulesFingerprint)
        }
    }

    @Test("Stored sanitized sections and clamped maximum have explicit independent semantics")
    func effectiveConfiguration() throws {
        let profile = CheckProfile(id: "profile.test", requiredSections: [" Testing ", "Testing", "", "Deployment"],
            allowedAdvisoryDimensions: [.completeness, .factualSupport, .style], maximumAdvisoryDimensions: 2)
        let first = try artifactCapture(), equivalent = try artifactCapture(profile: profile)
        #expect(first.contextSHA256 == equivalent.contextSHA256)
        let narrow = CheckProfile(id: "p", allowedAdvisoryDimensions: [.style], maximumAdvisoryDimensions: 99)
        #expect(try artifactCapture(profile: narrow).inputBytes == artifactHex("00004036000000000000803e0000803f"))
        let clamped = CheckProfile(id: "p", allowedAdvisoryDimensions: [], maximumAdvisoryDimensions: -1)
        #expect(try artifactCapture(profile: clamped).inputBytes == artifactHex("00004036000000000000000000000000"))
    }

    @Test("Exact minimum and maximum feature values encode as frozen little-endian bits")
    func boundaries() throws {
        let emptyProfile = CheckProfile(id: "p", allowedAdvisoryDimensions: [], maximumAdvisoryDimensions: 0)
        let minimum = try artifactCapture(snapshot: artifactSnapshot(Data([97])), profile: emptyProfile)
        #expect(try minimum.inputBytes == artifactHex("00008035000000000000000000000000"))
        let maximumProfile = CheckProfile(id: "p", requiredSections: (0..<64).map { "s\($0)" }, maximumAdvisoryDimensions: 4)
        let maximum = try artifactCapture(snapshot: artifactSnapshot(Data(repeating: 97, count: 1_048_576)), profile: maximumProfile)
        #expect(try maximum.inputBytes == artifactHex("0000803f0000803f0000803f0000803f"))
        #expect(try artifactEvaluate(maximum).outputBytes == maximum.inputBytes)
    }

    @Test("Same numeric values retain subject, kind, scope, profile and cutoff distinctions")
    func contextLineage() throws {
        let baseline = try artifactCapture()
        let variants = [try artifactCapture(snapshot: artifactSnapshot(Data("xyz".utf8))),
            try artifactCapture(snapshot: artifactSnapshot(kind: .text)), try artifactCapture(scope: "scope.other"),
            try artifactCapture(profile: artifactProfile(id: "profile.other")),
            try artifactCapture(observed: 8), try artifactCapture(cutoff: 10)]
        for candidate in variants {
            #expect(candidate.inputBytes == baseline.inputBytes)
            #expect(candidate.contextSHA256 != baseline.contextSHA256)
            #expect(candidate.prepared.preparedSHA256 != baseline.prepared.preparedSHA256)
            #expect(try artifactEvaluate(candidate).resultSHA256 != artifactEvaluate(baseline).resultSHA256)
        }
        let renamed = try artifactCapture(snapshot: artifactSnapshot(name: "another-name.md"))
        #expect(renamed.contextSHA256 == baseline.contextSHA256)
        let nextRun = try artifactCapture(run: "run.next")
        #expect(nextRun.contextSHA256 == baseline.contextSHA256)
        #expect(nextRun.prepared.preparedSHA256 != baseline.prepared.preparedSHA256)
    }

    @Test("Owned capture survives later backing mutation and rejects stale snapshot identity")
    func sourceOwnership() throws {
        let pointer = UnsafeMutableRawPointer.allocate(byteCount: 16, alignment: 1)
        defer { pointer.deallocate() }
        pointer.initializeMemory(as: UInt8.self, repeating: 97, count: 16)
        let bytes = Data(bytesNoCopy: pointer, count: 16, deallocator: .none)
        let snapshot = artifactSnapshot(bytes)
        let capture = try artifactCapture(snapshot: snapshot)
        pointer.storeBytes(of: UInt8(98), as: UInt8.self)
        try #require(snapshot.bytes.first == 98, "This oracle requires actual shared external storage")
        #expect(capture.subjectSHA256 == snapshot.subjectDigest)
        #expect(try artifactEvaluate(capture).outputBytes == capture.inputBytes)
        artifactRefuses(ReferenceArtifactFeatureCapture.Failure.subjectDigestMismatch) { _ = try artifactCapture(snapshot: snapshot) }
        artifactRefuses(ReferenceArtifactFeatureCapture.Failure.snapshotDigestMismatch) {
            _ = try artifactCapture(snapshot: snapshot, subject: ArtifactSnapshot.digest(snapshot.bytes))
        }
    }

    @Test("Resolved model owns package weights after mutable offered storage changes")
    func packageOwnership() throws {
        var objects = ReferenceArtifactPlugin.embeddedObjects
        let weights = try #require(objects[.weights])
        let pointer = UnsafeMutableRawPointer.allocate(byteCount: weights.count, alignment: 1)
        defer { pointer.deallocate() }
        weights.copyBytes(to: pointer.assumingMemoryBound(to: UInt8.self), count: weights.count)
        objects[.weights] = Data(bytesNoCopy: pointer, count: weights.count, deallocator: .none)
        let plugin = try ReferenceArtifactPlugin.resolve(.artifactProfileV1, objects: objects)
        pointer.storeBytes(of: UInt8(1), as: UInt8.self)
        try #require(objects[.weights]?.first == 1)
        let capture = try artifactCapture(plugin: plugin)
        #expect(try artifactEvaluate(capture).outputBytes == capture.inputBytes)
        artifactRefuses(ReferenceArtifactPlugin.Failure.objectDigestMismatch(.weights)) { _ = try ReferenceArtifactPlugin.resolve(.artifactProfileV1, objects: objects) }
    }

    @Test("Optional v2 context validates before use and cannot collide with context-free v1")
    func contextVersioning() throws {
        let plugin = try artifactPlugin(), capture = try artifactCapture(plugin: plugin)
        let make: (String?) throws -> PreparedReferenceMLPEvaluation = { context in
            try .init(model: plugin.model, scopeID: "scope.test", runID: "run.test", inputBytes: capture.inputBytes,
                expectedModelSHA256: plugin.model.modelSHA256, expectedInputSHA256: capture.prepared.inputSHA256,
                contextSHA256: context)
        }
        for bad in ["", String(repeating: "f", count: 63), String(repeating: "f", count: 65), String(repeating: "F", count: 64), String(repeating: "é", count: 32)] {
            artifactRefuses(PreparedReferenceMLPEvaluation.Failure.malformedContextDigest) { _ = try make(bad) }
        }
        let v1 = try make(nil), v2 = try make(capture.contextSHA256)
        #expect(v1.contextSHA256 == nil)
        #expect(v1.preparedSHA256 != v2.preparedSHA256)
        let result1 = try v1.evaluate(deadline: .now.advanced(by: .milliseconds(900)))
        let result2 = try v2.evaluate(deadline: .now.advanced(by: .milliseconds(900)))
        #expect(result1.outputBytes == result2.outputBytes)
        #expect(result1.contextSHA256 == nil && result1.resultSHA256 != result2.resultSHA256)
        #expect(!result1.authoritative && !result2.authoritative)
    }

    @Test("A resolved package and capture cannot enable an OFF or wrong-scope owner")
    func ownerStillRequired() async throws {
        let capture = try artifactCapture()
        let owner = try ReferenceMLPShadowOwner(scopeID: "scope.other",
            budget: .init(maxWeightBytes: 160, maxOperations: 68, maxOutputBytes: 16, maxInferenceMs: 1000))
        try await withAsyncTestCleanup(operation: {
            do { _ = try await owner.grant(capture.prepared, deadline: .now.advanced(by: .milliseconds(900))); Issue.record("OFF bypass") }
            catch let error as ReferenceMLPShadowOwner.Failure { #expect(error == .disabled) }
            try await owner.enable()
            do { _ = try await owner.grant(capture.prepared, deadline: .now.advanced(by: .milliseconds(900))); Issue.record("Scope bypass") }
            catch let error as ReferenceMLPShadowOwner.Failure { #expect(error == .wrongScope) }
            #expect(await owner.state == .ready)
        }, cleanup: { await owner.off() })
    }

    @Test("Immutable resolved package supports separate concurrent captured runs")
    func concurrentCaptures() async throws {
        let plugin = try artifactPlugin(), oracle = try artifactOracle()
        let results = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<8 { group.addTask { try artifactEvaluate(artifactCapture(plugin: plugin)).resultSHA256 } }
            var results: [String] = []
            for try await result in group { results.append(result) }
            return results
        }
        #expect(results.count == 8 && results.allSatisfy { $0 == oracle.resultSHA256 })
    }
}
