import Foundation
import Testing
@testable import VeritasCore

private typealias Preparation = ReferenceArtifactShadowPreparation

private func shadowProfile(id: String = "profile.test") -> CheckProfile {
    .init(id: id, requiredSections: ["Testing", "Deployment"],
          allowedAdvisoryDimensions: [.completeness, .factualSupport, .style], maximumAdvisoryDimensions: 2)
}
private func shadowSnapshot(_ bytes: Data = Data("abc".utf8), kind: ArtifactKind = .markdown,
                            name: String = "private.md") -> ArtifactSnapshot {
    .init(displayName: name, kind: kind, bytes: bytes)
}
private func shadowProducer(_ profile: CheckProfile = shadowProfile(), scope: String = "scope.test") throws -> Preparation {
    try .init(scopeID: scope, profile: profile)
}
private func shadowObject(_ candidate: Preparation.Candidate) throws -> [String: Any] {
    try #require(JSONSerialization.jsonObject(with: Data(candidate.canonical.utf8)) as? [String: Any])
}
private func shadowHex(_ bytes: Data) -> String { bytes.map { String(format: "%02x", $0) }.joined() }
private func shadowObservationExportEnabled(_ environment: [String: String]) -> Bool {
    environment["VERITAS_PREPARATION_OBSERVATION_STDOUT"] == "1"
        && ["VERITAS_TEST_EVIDENCE_PATH", "VERITAS_TEST_EVIDENCE_DEVICE", "VERITAS_TEST_EVIDENCE_INODE"]
            .allSatisfy { environment[$0] == nil }
}
private func shadowRefuses(_ expected: Preparation.Failure, _ body: () throws -> Void) {
    do { try body(); Issue.record("Missing refusal: \(expected)") }
    catch let error as Preparation.Failure { #expect(error == expected) }
    catch { Issue.record("Wrong error: \(error)") }
}
private func shadowOracle() throws -> [String: Any] {
    let url = try #require(Bundle.module.url(forResource: "reference-artifact-package-v1", withExtension: "json", subdirectory: "Fixtures"))
    let data = try Data(contentsOf: url)
    try #require(ArtifactSnapshot.digest(data) == "9d755c7d4cfb9d3df7c111fa3a7220131f8402d9b9a0e90c5dc7c4952d22ec68")
    return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

@Suite("BN-01 — Native typed shadow preparation")
struct ReferenceArtifactShadowPreparationTests {
    @Test func maximumTypedMetadataStaysWithinDeclaredEncoderAndCanonicalCaps() throws {
        let sections = (0..<64).map { String(format: "%03d", $0) + String(repeating: "x", count: 125) }
        let profile = CheckProfile(id: String(repeating: "\"", count: 128), requiredSections: sections)
        #expect(profile.resourceLimitsAdmitted)
        let producer = try ReferenceArtifactShadowPreparation(scopeID: "s" + String(repeating: "x", count: 95), profile: profile)
        for kind in [ArtifactKind.text, .json, .markdown] {
            let snapshot = ArtifactSnapshot(displayName: "not encoded", kind: kind, bytes: Data(repeating: 97, count: 1_048_576))
            let candidate = try producer.prepare(snapshot: snapshot)
            #expect(candidate.canonical.utf8.count <= ReferenceArtifactShadowPreparation.maximumEncodedMetadataBytes)
            #expect(!candidate.canonical.contains(profile.id))
            #expect(!candidate.authoritative)
        }
    }

    @Test("Owned typed preparation executes the fixed model through the existing numeric owner")
    func endToEnd() async throws {
        let producer = try shadowProducer()
        let candidate = try producer.prepare(snapshot: shadowSnapshot())
        let prepared = try producer.preparedEvaluation(for: candidate)
        let oracle = try shadowOracle()
        #expect(shadowHex(candidate.inputBytes) == oracle["inputHex"] as? String)
        #expect(prepared.modelSHA256 == oracle["modelSHA256"] as? String)
        #expect(prepared.contextSHA256 == candidate.contextSHA256)
        #expect(!candidate.authoritative)
        let owner = try ReferenceMLPShadowOwner(scopeID: "scope.test",
            budget: .init(maxWeightBytes: 160, maxOperations: 68, maxOutputBytes: 16, maxInferenceMs: 1000))
        try await withAsyncTestCleanup(operation: {
            try await owner.enable()
            let permit = try await owner.grant(prepared, deadline: .now.advanced(by: .milliseconds(900)))
            let ticket = try await owner.begin(permit)
            let result = try await owner.result(for: ticket)
            #expect(result.outputBytes == candidate.inputBytes)
            #expect(result.contextSHA256 == candidate.contextSHA256)
            #expect(result.preparedSHA256 == candidate.preparedSHA256)
            #expect(result.runID == candidate.runID && !result.authoritative)
            // Bounded synthetic observation for independent JS projection/framing
            // verification. Not an app receipt or an authority-bearing transport.
            let observation: [String: String] = ["canonical": candidate.canonical,
                "canonicalSHA256": candidate.canonicalSHA256, "contextSHA256": candidate.contextSHA256,
                "inputHex": shadowHex(candidate.inputBytes), "preparedSHA256": candidate.preparedSHA256,
                "outputHex": shadowHex(result.outputBytes), "resultSHA256": result.resultSHA256]
            let bytes = try JSONSerialization.data(withJSONObject: observation, options: [.sortedKeys, .withoutEscapingSlashes])
            // Comparison export is explicitly opt-in for the direct private
            // harness only. Normal/full native runs emit no observation; even
            // partial machine-sink configuration prevents stdout fallback.
            #expect(!shadowObservationExportEnabled([:]))
            #expect(shadowObservationExportEnabled(["VERITAS_PREPARATION_OBSERVATION_STDOUT": "1"]))
            for key in ["VERITAS_TEST_EVIDENCE_PATH", "VERITAS_TEST_EVIDENCE_DEVICE", "VERITAS_TEST_EVIDENCE_INODE"] {
                #expect(!shadowObservationExportEnabled(["VERITAS_PREPARATION_OBSERVATION_STDOUT": "1", key: "configured"]))
            }
            if shadowObservationExportEnabled(ProcessInfo.processInfo.environment) {
                print("VERITAS_SHADOW_PREPARATION_V1=" + String(decoding: bytes, as: UTF8.self))
            }
        }, cleanup: { await owner.off() })
    }

    @Test("Closed metadata is reconstructed independently from frozen values and only observed generated IDs")
    func metadataContract() throws {
        let producer = try shadowProducer()
        let candidate = try producer.prepare(snapshot: shadowSnapshot())
        let actual = try shadowObject(candidate)
        let oracle = try shadowOracle()
        let pins = try #require(oracle["objectSHA256"] as? [String: String])
        // All identity/content fields come from the preexisting frozen oracle,
        // not from the producer under test. Only fresh IDs must be observed.
        let expected: [String: Any] = ["schemaVersion": 1, "purpose": "SHADOW_PREPARATION",
            "canonicalProfile": "veritas-mac1-canonical-json-v1", "scopeID": "scope.test",
            "producerID": try #require(actual["producerID"] as? String), "runID": candidate.runID,
            "artifactKind": "markdown", "subjectSHA256": try #require(oracle["subjectSHA256"] as? String),
            "byteCount": 3, "profileRuleset": "veritas-check-profile-rules-v1",
            "profileSHA256": try #require(oracle["profileSHA256"] as? String), "profileResourcesAdmitted": true,
            "packageSHA256": try #require(pins["manifest"]), "featureSchemaSHA256": try #require(pins["schema"]),
            "preprocessingSHA256": try #require(pins["preprocessing"]), "modelSHA256": try #require(oracle["modelSHA256"] as? String),
            "inputEncoding": "f32-le", "inputWidth": 4, "inputSHA256": try #require(oracle["inputSHA256"] as? String),
            "authoritative": false, "consent": "NOT_ESTABLISHED", "runtime": "NOT_ATTESTED", "history": "NOT_INCLUDED"]
        #expect(Set(actual.keys) == Set(expected.keys))
        // This fixed observation has ASCII-only values and keys, so sorted
        // Foundation JSON is an independent expected spelling, not the MAC1 codec.
        let bytes = try JSONSerialization.data(withJSONObject: expected, options: [.sortedKeys, .withoutEscapingSlashes])
        #expect(candidate.canonical == String(decoding: bytes, as: UTF8.self))
        #expect(candidate.canonicalSHA256 == ArtifactSnapshot.digest(bytes))
        #expect(try MAC1JSONV1.canonicalize(Data(candidate.canonical.utf8)).canonical == candidate.canonical)
    }

    @Test("Context uses independently assembled tagged length frames and the new domain")
    func contextFrame() throws {
        let candidate = try shadowProducer().prepare(snapshot: shadowSnapshot())
        func frame(_ tag: UInt8, _ text: String) -> Data {
            let bytes = Data(text.utf8)
            var result = Data([tag])
            let length = UInt64(bytes.count)
            for shift in stride(from: 56, through: 0, by: -8) { result.append(UInt8(truncatingIfNeeded: length >> shift)) }
            result.append(bytes)
            return result
        }
        let domain = "veritas/bn01/native-shadow-preparation/v1"
        let expected = frame(0, domain) + frame(1, candidate.canonical)
        #expect(candidate.contextSHA256 == ArtifactSnapshot.digest(expected))
        #expect(candidate.contextSHA256 != candidate.canonicalSHA256)
        #expect(candidate.contextSHA256 != ArtifactSnapshot.digest(Data((domain + "\0" + candidate.canonical).utf8)))
    }

    @Test("Different instances cannot unwrap each other's candidates despite identical configuration")
    func foreignOrigin() throws {
        let first = try shadowProducer(), second = try shadowProducer()
        let candidate = try first.prepare(snapshot: shadowSnapshot())
        shadowRefuses(.foreignCandidate) { _ = try second.preparedEvaluation(for: candidate) }
        let alias = first
        #expect(try alias.preparedEvaluation(for: candidate).preparedSHA256 == candidate.preparedSHA256)
        // Repeatable diagnostics by the same producer, expressly not one-use consent.
        #expect(try first.preparedEvaluation(for: candidate).preparedSHA256 == candidate.preparedSHA256)
    }

    @Test("Generated IDs are bounded and fresh observations without claiming replay resistance")
    func generatedIdentity() throws {
        let first = try shadowProducer()
        let a = try first.prepare(snapshot: shadowSnapshot()), b = try first.prepare(snapshot: shadowSnapshot())
        let c = try shadowProducer().prepare(snapshot: shadowSnapshot())
        let ma = try shadowObject(a), mb = try shadowObject(b), mc = try shadowObject(c)
        #expect(ma["producerID"] as? String == mb["producerID"] as? String)
        #expect(ma["producerID"] as? String != mc["producerID"] as? String)
        #expect(Set([a.runID, b.runID, c.runID]).count == 3)
        for (object, candidate) in [(ma, a), (mb, b), (mc, c)] {
            for prefix in ["producer", "run"] {
                let id = try #require(object[prefix + "ID"] as? String)
                #expect(id.hasPrefix(prefix + ".") && id.utf8.count <= 96 && id == id.lowercased())
                #expect(UUID(uuidString: String(id.dropFirst(prefix.count + 1))) != nil)
            }
            #expect(object["runID"] as? String == candidate.runID)
            #expect(candidate.inputBytes == a.inputBytes)
        }
        #expect(Set([a.contextSHA256, b.contextSHA256, c.contextSHA256]).count == 3)
    }

    @Test("Snapshot boundaries and invalid UTF8 refuse before any candidate")
    func snapshotRefusals() throws {
        let producer = try shadowProducer()
        for bytes in [Data(), Data(repeating: 97, count: 1_048_577)] {
            shadowRefuses(.snapshotByteCount) { _ = try producer.prepare(snapshot: shadowSnapshot(bytes)) }
        }
        for bytes in [Data([0xff]), Data([0xc0, 0xaf]), Data([0xe2, 0x82])] {
            shadowRefuses(.invalidUTF8) { _ = try producer.prepare(snapshot: shadowSnapshot(bytes)) }
        }
    }

    @Test("Invalid scopes and resource-refused profiles cannot construct a producer")
    func constructionRefusals() throws {
        for scope in ["", "A", "1a", "a/b", "a\n", "a\0b", "é", String(repeating: "a", count: 97)] {
            shadowRefuses(.invalidScopeID) { _ = try shadowProducer(scope: scope) }
        }
        for profile in [CheckProfile(id: ""), CheckProfile(id: "p", requiredSections: Array(repeating: "s", count: 65)),
                        CheckProfile(id: "p", requiredSections: [String(repeating: "s", count: 257)])] {
            shadowRefuses(.profileResourceRefused) { _ = try shadowProducer(profile) }
        }
        shadowRefuses(.invalidScopeID) { _ = try shadowProducer(CheckProfile(id: ""), scope: "") }
        _ = try shadowProducer(scope: String(repeating: "a", count: 96))
    }

    @Test("Producer uses its captured profile even when the caller replaces its variable")
    func profileOwnership() throws {
        var profile = shadowProfile()
        let expected = profile.rulesFingerprint
        let producer = try shadowProducer(profile)
        profile = CheckProfile(id: "changed", allowedAdvisoryDimensions: [], maximumAdvisoryDimensions: 0)
        let candidate = try producer.prepare(snapshot: shadowSnapshot())
        #expect(try shadowObject(candidate)["profileSHA256"] as? String == expected)
        #expect(try shadowObject(candidate)["profileSHA256"] as? String != profile.rulesFingerprint)
        #expect(shadowHex(candidate.inputBytes) == "000040360000003d0000403f0000003f")
    }

    @Test("Captured data survives later external mutation and stale snapshot digests refuse")
    func sourceOwnership() throws {
        let pointer = UnsafeMutableRawPointer.allocate(byteCount: 16, alignment: 1)
        defer { pointer.deallocate() }
        pointer.initializeMemory(as: UInt8.self, repeating: 97, count: 16)
        let snapshot = shadowSnapshot(Data(bytesNoCopy: pointer, count: 16, deallocator: .none))
        let producer = try shadowProducer()
        let candidate = try producer.prepare(snapshot: snapshot)
        let context = candidate.contextSHA256
        pointer.storeBytes(of: UInt8(98), as: UInt8.self)
        try #require(snapshot.bytes.first == 98, "Test requires actual external backing")
        #expect(try shadowObject(candidate)["subjectSHA256"] as? String == snapshot.subjectDigest)
        #expect(candidate.contextSHA256 == context)
        let prepared = try producer.preparedEvaluation(for: candidate)
        #expect(try prepared.evaluate(deadline: .now.advanced(by: .milliseconds(900))).outputBytes == candidate.inputBytes)
        shadowRefuses(.snapshotDigestMismatch) { _ = try producer.prepare(snapshot: snapshot) }
    }

    @Test("Minimum and maximum feature boundaries preserve independent binary32 bytes")
    func featureBoundaries() throws {
        let minimum = try shadowProducer(CheckProfile(id: "p", allowedAdvisoryDimensions: [], maximumAdvisoryDimensions: 0))
            .prepare(snapshot: shadowSnapshot(Data([97])))
        #expect(shadowHex(minimum.inputBytes) == "00008035000000000000000000000000")
        let profile = CheckProfile(id: "p", requiredSections: (0..<64).map { "s\($0)" }, maximumAdvisoryDimensions: 4)
        let maximum = try shadowProducer(profile).prepare(snapshot: shadowSnapshot(Data(repeating: 97, count: 1_048_576)))
        #expect(shadowHex(maximum.inputBytes) == "0000803f0000803f0000803f0000803f")
    }

    @Test("Equivalent profiles keep legacy features while new context never masquerades as legacy history")
    func legacyFeatureParity() throws {
        let snapshot = shadowSnapshot()
        let profile = CheckProfile(id: "profile.test", requiredSections: [" Testing ", "Testing", "", "Deployment"],
            allowedAdvisoryDimensions: [.style, .factualSupport, .completeness], maximumAdvisoryDimensions: 2)
        let candidate = try shadowProducer(profile).prepare(snapshot: snapshot)
        let plugin = try ReferenceArtifactPlugin.resolve(.artifactProfileV1, objects: ReferenceArtifactPlugin.embeddedObjects)
        let legacy = try ReferenceArtifactFeatureCapture(plugin: plugin, snapshot: snapshot, profile: profile,
            scopeID: "scope.test", runID: "run.test", expectedSubjectSHA256: snapshot.subjectDigest,
            expectedProfileSHA256: profile.rulesFingerprint, observedThroughEvent: 7, cutoffEvent: 9)
        #expect(candidate.inputBytes == legacy.inputBytes)
        #expect(candidate.contextSHA256 != legacy.contextSHA256)
        #expect(legacy.prepared.preparedSHA256 == (try shadowOracle())["preparedSHA256"] as? String)
    }

    @Test("Metadata binds kind, subject and profile even when numeric features are identical")
    func subjectAndKind() throws {
        let producer = try shadowProducer()
        let baseline = try producer.prepare(snapshot: shadowSnapshot())
        let variants = [try producer.prepare(snapshot: shadowSnapshot(Data("xyz".utf8))),
                        try producer.prepare(snapshot: shadowSnapshot(kind: .text)),
                        try shadowProducer(shadowProfile(id: "other")).prepare(snapshot: shadowSnapshot())]
        let original = try shadowObject(baseline)
        for (candidate, field) in zip(variants, ["subjectSHA256", "artifactKind", "profileSHA256"]) {
            #expect(candidate.inputBytes == baseline.inputBytes)
            #expect(try shadowObject(candidate)[field] as? String != original[field] as? String)
        }
        let renamed = try producer.prepare(snapshot: shadowSnapshot(name: "different-private-name.md"))
        var a = try shadowObject(baseline), b = try shadowObject(renamed)
        a["runID"] = nil; b["runID"] = nil
        #expect(NSDictionary(dictionary: a).isEqual(to: b))
        #expect(!renamed.canonical.contains("different-private-name"))
    }
}
