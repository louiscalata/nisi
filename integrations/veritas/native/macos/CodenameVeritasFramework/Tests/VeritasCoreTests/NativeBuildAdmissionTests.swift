import CryptoKit
import Foundation
import Testing
@testable import VeritasCore

#if DEBUG
// Published-in-test fixture material only. Never a production admission key.
private let buildFixtureKey = try! Curve25519.Signing.PrivateKey(rawRepresentation: Data(repeating: 7, count: 32))
private func buildFields(start: UInt64 = 1_000, end: UInt64 = 11_000) -> [String] {
    ["1", "arm64-macos27-single-image-reference-v1", String(repeating: "a", count: 40), "fixture.executable", "2",
     String(repeating: "b", count: 64), String(repeating: "c", count: 64), String(repeating: "d", count: 64),
     String(start), String(end)]
}
private func buildBody(_ fields: [String], domain: String = "veritas/native-build-admission/v1") -> Data {
    var result = Data()
    for (index, value) in ([domain] + fields).enumerated() {
        let bytes = Array(value.utf8)
        result.append(index == 0 ? 0 : 1)
        for shift in stride(from: 56, through: 0, by: -8) { result.append(UInt8(truncatingIfNeeded: UInt64(bytes.count) >> shift)) }
        result.append(contentsOf: bytes)
    }
    return result
}
private func signedBuild(_ body: Data) throws -> Data { body + (try buildFixtureKey.signature(for: body)) }

@MainActor private final class BuildValidationTestState {
    var valid = true
    var calls = 0
}

@Suite("Native detached build admission", .serialized)
@MainActor struct NativeBuildAdmissionTests {
    @Test func independentlyFramedSignedClaimsAreValidatedBeforeUse() throws {
        let envelope = try signedBuild(buildBody(buildFields()))
        var calls = 0
        let admission = try NativeBuildAdmission.forSignatureTests(envelope,
            publicKey: buildFixtureKey.publicKey.rawRepresentation, nowMilliseconds: 1_000) { claims in
            calls += 1
            #expect(claims.cdhash == String(repeating: "a", count: 40))
            #expect(claims.sourceManifestSHA256 == String(repeating: "c", count: 64))
            #expect(claims.reviewedReceiptSHA256 == String(repeating: "d", count: 64))
            #expect(claims.flags == 2 && claims.identifier == "fixture.executable")
        }
        #expect(calls == 1)
        #expect(admission.receiptSHA256 == ArtifactSnapshot.digest(envelope))
        try admission.revalidate(); #expect(calls == 2)
    }

    @Test func noProductionKeyOrIssuerCanBeInferred() {
        #expect(throws: NativeBuildAdmission.Failure.productionAuthorityUnavailable) { _ = try NativeBuildAdmission.production() }
        #expect(throws: ReferenceArtifactShadowRunOwner.Failure.buildAdmissionRefused) { _ = try ReferenceArtifactShadowRunOwner() }
    }

    @Test(arguments: ["body", "signature", "wrong-key", "short-key", "empty", "oversize", "truncated"])
    func unsignedTamperedAndWrongKeyEnvelopesNeverReachRuntime(kind: String) throws {
        var envelope = try signedBuild(buildBody(buildFields()))
        var key = buildFixtureKey.publicKey.rawRepresentation
        switch kind {
        case "body": envelope[20] ^= 1
        case "signature": envelope[envelope.count - 1] ^= 1
        case "wrong-key": key = Curve25519.Signing.PrivateKey().publicKey.rawRepresentation
        case "short-key": key = Data(key.dropLast())
        case "empty": envelope = Data()
        case "oversize": envelope = Data(repeating: 0, count: 2_049)
        default: envelope = Data(envelope.dropLast())
        }
        var calls = 0
        #expect(throws: (any Error).self) {
            _ = try NativeBuildAdmission.forSignatureTests(envelope, publicKey: key, nowMilliseconds: 1_000) { _ in calls += 1 }
        }
        #expect(calls == 0)
    }

    @Test(arguments: ["version", "profile", "integer", "hash", "field-count", "domain", "tag", "length", "suffix", "too-long"])
    func correctlySignedMalformedPayloadStillRefuses(kind: String) throws {
        var fields = buildFields(), domain = "veritas/native-build-admission/v1"
        switch kind {
        case "version": fields[0] = "2"
        case "profile": fields[1] = "other-profile"
        case "integer": fields[4] = "02"
        case "hash": fields[2] = String(repeating: "A", count: 40)
        case "field-count": fields.append("ALLOW")
        case "domain": domain = "other-domain"
        case "too-long": fields[3] = String(repeating: "x", count: 129)
        default: break
        }
        var body = buildBody(fields, domain: domain)
        if kind == "tag" { body[0] = 1 }
        if kind == "length" { body[1] = 0xff }
        if kind == "suffix" { body.append(0) }
        let envelope = try signedBuild(body)
        var calls = 0
        #expect(throws: kind == "profile" ? NativeBuildAdmission.Failure.unsupportedProfile : .malformedEnvelope) {
            _ = try NativeBuildAdmission.forSignatureTests(envelope, publicKey: buildFixtureKey.publicKey.rawRepresentation,
                nowMilliseconds: 1_000) { _ in calls += 1 }
        }
        #expect(calls == 0)
    }

    @Test(arguments: [UInt64(999), 11_000, 12_000])
    func signedWallClockWindowRefusesBeforeRuntime(now: UInt64) throws {
        let envelope = try signedBuild(buildBody(buildFields()))
        var calls = 0
        #expect(throws: NativeBuildAdmission.Failure.outsideValidityWindow) {
            _ = try NativeBuildAdmission.forSignatureTests(envelope, publicKey: buildFixtureKey.publicKey.rawRepresentation,
                nowMilliseconds: now) { _ in calls += 1 }
        }
        #expect(calls == 0)
    }

    @Test func liveValidationFailurePermanentlyRevokesThatAdmission() throws {
        let state = BuildValidationTestState()
        let admission = try NativeBuildAdmission.forSignatureTests(try signedBuild(buildBody(buildFields())),
            publicKey: buildFixtureKey.publicKey.rawRepresentation, nowMilliseconds: 1_000) { _ in
            state.calls += 1
            if !state.valid { throw NativeBuildAdmission.Failure.identityMismatch }
        }
        state.valid = false
        #expect(throws: NativeBuildAdmission.Failure.identityMismatch) { try admission.revalidate() }
        state.valid = true
        #expect(throws: NativeBuildAdmission.Failure.revoked) { try admission.revalidate() }
        #expect(state.calls == 2)
    }

    @Test func continuousDeadlineCannotBeExtendedByRepeatedValidation() async throws {
        let envelope = try signedBuild(buildBody(buildFields(start: 1_000, end: 1_050)))
        var calls = 0
        let admission = try NativeBuildAdmission.forSignatureTests(envelope,
            publicKey: buildFixtureKey.publicKey.rawRepresentation, nowMilliseconds: 1_000) { _ in calls += 1 }
        try await Task.sleep(for: .milliseconds(60))
        #expect(throws: NativeBuildAdmission.Failure.outsideValidityWindow) { try admission.revalidate() }
        #expect(calls == 1)
    }
}
#endif
