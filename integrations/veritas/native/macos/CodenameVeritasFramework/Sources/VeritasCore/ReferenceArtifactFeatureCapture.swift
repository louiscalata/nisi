import Foundation

// Closed pre-analysis adapter over existing app values. No outcome/history fields,
// automatic source access, consent proof, training or probability estimate.
struct ReferenceArtifactFeatureCapture: Sendable {
    enum Failure: Error, Equatable, Sendable {
        case invalidScopeID, invalidRunID, malformedSubjectDigest, malformedProfileDigest
        case invalidEvent, postCutoff, snapshotByteCount, profileResourceRefused
        case subjectDigestMismatch, snapshotDigestMismatch, invalidUTF8, profileDigestMismatch
    }

    let subjectSHA256: String
    let profileSHA256: String
    let contextSHA256: String
    let inputBytes: Data
    let prepared: PreparedReferenceMLPEvaluation

    init(plugin: ReferenceArtifactPlugin, snapshot: ArtifactSnapshot, profile: CheckProfile,
         scopeID: String, runID: String, expectedSubjectSHA256: String, expectedProfileSHA256: String,
         observedThroughEvent: Int, cutoffEvent: Int) throws {
        guard Self.validID(scopeID) else { throw Failure.invalidScopeID }
        guard Self.validID(runID) else { throw Failure.invalidRunID }
        guard Self.validDigest(expectedSubjectSHA256) else { throw Failure.malformedSubjectDigest }
        guard Self.validDigest(expectedProfileSHA256) else { throw Failure.malformedProfileDigest }
        guard (0...2_147_483_647).contains(observedThroughEvent),
              (0...2_147_483_647).contains(cutoffEvent) else { throw Failure.invalidEvent }
        guard observedThroughEvent <= cutoffEvent else { throw Failure.postCutoff }
        guard (1...1_048_576).contains(snapshot.bytes.count) else { throw Failure.snapshotByteCount }
        guard profile.resourceLimitsAdmitted else { throw Failure.profileResourceRefused }

        // Hash and decode the same bounded owned copy; Data may have external backing.
        // Caller must not concurrently mutate that backing while this copy is in progress.
        let owned = Data([UInt8](snapshot.bytes))
        let subject = ArtifactSnapshot.digest(owned)
        guard subject == expectedSubjectSHA256 else { throw Failure.subjectDigestMismatch }
        guard subject == snapshot.subjectDigest else { throw Failure.snapshotDigestMismatch }
        guard String(data: owned, encoding: .utf8) != nil else { throw Failure.invalidUTF8 }
        let profileDigest = profile.rulesFingerprint
        guard profileDigest == expectedProfileSHA256 else { throw Failure.profileDigestMismatch }

        // Exact powers-of-two scaling of already bounded effective configuration.
        // Maximum dimensions is the stored clamped setting, not min(allowed, maximum).
        let features: [Float] = [Float(owned.count) / 1_048_576,
            Float(profile.requiredSections.count) / 64,
            Float(profile.allowedAdvisoryDimensions.count) / 4,
            Float(profile.maximumAdvisoryDimensions) / 4]
        var input = Data()
        for value in features {
            for shift in [0, 8, 16, 24] { input.append(UInt8(truncatingIfNeeded: value.bitPattern >> shift)) }
        }
        let inputDigest = ArtifactSnapshot.digest(input)
        // Events/scope bind what the trusted developer caller supplied. They do not
        // authenticate source history, current consent, or pre-outcome availability.
        let frame = "veritas/bn01/artifact-feature-binding/v1\0" +
            "scope=\(scopeID)\0subject=\(subject)\0kind=\(snapshot.kind.rawValue)\0" +
            "profile=\(profileDigest)\0schema=\(plugin.featureSchemaSHA256)\0" +
            "preprocessing=\(plugin.preprocessingSHA256)\0package=\(plugin.packageSHA256)\0" +
            "observed=\(observedThroughEvent)\0cutoff=\(cutoffEvent)\0input=\(inputDigest)\0"
        let context = ArtifactSnapshot.digest(Data(frame.utf8))
        prepared = try PreparedReferenceMLPEvaluation(model: plugin.model, scopeID: scopeID, runID: runID,
            inputBytes: input, expectedModelSHA256: plugin.model.modelSHA256,
            expectedInputSHA256: inputDigest, contextSHA256: context)
        inputBytes = input
        subjectSHA256 = subject
        profileSHA256 = profileDigest
        contextSHA256 = context
    }

    private static func validID(_ text: String) -> Bool {
        let bytes = Array(text.utf8.prefix(97))
        return !bytes.isEmpty && bytes.count <= 96 && (97...122).contains(bytes[0]) &&
            bytes.dropFirst().allSatisfy { (97...122).contains($0) || (48...57).contains($0) || [45,46,95].contains($0) }
    }
    private static func validDigest(_ text: String) -> Bool {
        let bytes = Array(text.utf8.prefix(65))
        return bytes.count == 64 && bytes.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
