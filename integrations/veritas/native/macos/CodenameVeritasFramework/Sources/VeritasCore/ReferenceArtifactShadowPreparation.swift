import Foundation

/// Internal typed producer for the later native run owner. Not a consent or
/// execution authority, plugin loader, learning route, or app integration.
final class ReferenceArtifactShadowPreparation: Sendable {
    static let contextDomain = "veritas/bn01/native-shadow-preparation/v1"
    static let maximumEncodedMetadataBytes = 4_096

    enum Failure: Error, Equatable, Sendable {
        case invalidScopeID, profileResourceRefused, snapshotByteCount
        case snapshotDigestMismatch, invalidUTF8, canonicalProfileMismatch, foreignCandidate
        case metadataBudgetExceeded
    }

    fileprivate final class Origin: Sendable {}
    private let origin = Origin()
    private let scopeID: String
    private let producerID = "producer." + UUID().uuidString.lowercased()
    private let profile: CheckProfile
    private let profileSHA256: String
    private let plugin: ReferenceArtifactPlugin

    struct Candidate: Sendable {
        fileprivate let origin: Origin
        fileprivate let prepared: PreparedReferenceMLPEvaluation
        let canonical: String
        let canonicalSHA256: String
        let contextSHA256: String
        let inputBytes: Data

        var authoritative: Bool { false }
        var runID: String { prepared.runID }
        var preparedSHA256: String { prepared.preparedSHA256 }

        // No synthesized module-visible initializer and no serialized reattachment.
        fileprivate init(origin: Origin, prepared: PreparedReferenceMLPEvaluation,
                         canonical: MAC1JSONV1.Result, contextSHA256: String, inputBytes: Data) {
            self.origin = origin
            self.prepared = prepared
            self.canonical = canonical.canonical
            self.canonicalSHA256 = canonical.sha256
            self.contextSHA256 = contextSHA256
            self.inputBytes = inputBytes
        }
    }

    // Explicit typed projection, not a caller-supplied dictionary or JSON blob.
    // No optionals, nulls, dates, floats, artifact text, profile text or outcomes.
    private struct Metadata: Encodable {
        let schemaVersion = 1
        let purpose = "SHADOW_PREPARATION"
        let canonicalProfile = MAC1JSONV1.profile
        let scopeID, producerID, runID, artifactKind, subjectSHA256: String
        let byteCount: Int
        let profileRuleset = CheckProfile.rulesetVersion
        let profileSHA256: String
        let profileResourcesAdmitted = true
        let packageSHA256, featureSchemaSHA256, preprocessingSHA256, modelSHA256: String
        let inputEncoding = "f32-le"
        let inputWidth = 4
        let inputSHA256: String
        let authoritative = false
        let consent = "NOT_ESTABLISHED"
        let runtime = "NOT_ATTESTED"
        let history = "NOT_INCLUDED"
    }

    convenience init(scopeID: String, profile: CheckProfile) throws {
        try self.init(scopeID: scopeID, profile: profile,
            plugin: .resolve(.artifactProfileV1, objects: ReferenceArtifactPlugin.embeddedObjects))
    }

    // The bridge selects one closed, source-pinned plan before admission. This
    // initializer accepts the actual resolved object, never serialized authority.
    init(scopeID: String, profile: CheckProfile, plugin: ReferenceArtifactPlugin) throws {
        let bytes = Array(scopeID.utf8.prefix(97))
        guard !bytes.isEmpty, bytes.count <= 96, (97...122).contains(bytes[0]),
              bytes.dropFirst().allSatisfy({ (97...122).contains($0) || (48...57).contains($0)
                  || [45, 46, 95].contains($0) }) else { throw Failure.invalidScopeID }
        guard profile.resourceLimitsAdmitted else { throw Failure.profileResourceRefused }
        self.scopeID = scopeID
        self.profile = profile
        profileSHA256 = profile.rulesFingerprint
        self.plugin = plugin
    }

    func prepare(snapshot: ArtifactSnapshot) throws -> Candidate {
        guard (1...1_048_576).contains(snapshot.bytes.count) else { throw Failure.snapshotByteCount }
        // Caller must not race mutation during this synchronous copy. All later
        // hashing, decoding and feature construction refer only to owned bytes.
        let owned = Data([UInt8](snapshot.bytes))
        let subject = ArtifactSnapshot.digest(owned)
        guard subject == snapshot.subjectDigest else { throw Failure.snapshotDigestMismatch }
        guard String(data: owned, encoding: .utf8) != nil else { throw Failure.invalidUTF8 }

        // Same four features as the legacy adapter; do not synthesize its caller-
        // supplied history/event fields to reuse its different context domain.
        let features: [Float] = [Float(owned.count) / 1_048_576,
            Float(profile.requiredSections.count) / 64,
            Float(profile.allowedAdvisoryDimensions.count) / 4,
            Float(profile.maximumAdvisoryDimensions) / 4]
        var input = Data()
        for value in features {
            for shift in [0, 8, 16, 24] { input.append(UInt8(truncatingIfNeeded: value.bitPattern >> shift)) }
        }
        let inputDigest = ArtifactSnapshot.digest(input)
        let runID = "run." + UUID().uuidString.lowercased()
        let metadata = Metadata(scopeID: scopeID, producerID: producerID, runID: runID,
            artifactKind: snapshot.kind.rawValue, subjectSHA256: subject, byteCount: owned.count,
            profileSHA256: profileSHA256, packageSHA256: plugin.packageSHA256,
            featureSchemaSHA256: plugin.featureSchemaSHA256, preprocessingSHA256: plugin.preprocessingSHA256,
            modelSHA256: plugin.model.modelSHA256, inputSHA256: inputDigest)
        // The only non-fixed-width metadata string is the validated <=96-byte
        // ASCII scope. Digests, UUIDs, enum kind and ruleset are source-controlled;
        // no user profile identifier or artifact text enters this encoder.
        let encoded = try JSONEncoder().encode(metadata)
        guard encoded.count <= Self.maximumEncodedMetadataBytes else { throw Failure.metadataBudgetExceeded }
        let canonical = try MAC1JSONV1.canonicalize(encoded)
        guard canonical.canonical.utf8.count <= Self.maximumEncodedMetadataBytes else { throw Failure.metadataBudgetExceeded }
        guard canonical.profile == MAC1JSONV1.profile else { throw Failure.canonicalProfileMismatch }
        let context = VeritasDigestFrameV1.digest(domain: Self.contextDomain, payload: Data(canonical.canonical.utf8))
        let prepared = try PreparedReferenceMLPEvaluation(model: plugin.model, scopeID: scopeID, runID: runID,
            inputBytes: input, expectedModelSHA256: plugin.model.modelSHA256,
            expectedInputSHA256: inputDigest, contextSHA256: context)
        return Candidate(origin: origin, prepared: prepared, canonical: canonical,
                         contextSHA256: context, inputBytes: input)
    }

    /// Same-process origin check only. Repeated diagnostic retrieval is allowed;
    /// this is deliberately not named grant/permit and cannot establish consent.
    func preparedEvaluation(for candidate: Candidate) throws -> PreparedReferenceMLPEvaluation {
        guard candidate.origin === origin else { throw Failure.foreignCandidate }
        return candidate.prepared
    }
}
