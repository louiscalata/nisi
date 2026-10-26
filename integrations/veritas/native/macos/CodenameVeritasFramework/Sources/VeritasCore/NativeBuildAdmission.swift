import CryptoKit
import Darwin
import Foundation
import MachO
import Security

/// Same-process exact-build selection for the first, statically linked reference
/// profile. Not hardened-runtime attestation, arbitrary loaded-image admission,
/// notarization, release authorization, user consent or a model correctness claim.
@MainActor
package final class NativeBuildAdmission {
    package enum Failure: Error, Equatable {
        case productionAuthorityUnavailable, malformedEnvelope, signatureInvalid
        case unsupportedProfile, outsideValidityWindow, revoked
        case liveCodeUnavailable, signatureValidityFailed, signingInformationUnavailable
        case unsupportedImageLayout, malformedIdentity, identityMismatch
    }
    // Immutable Sendable protocol constants are not actor-owned runtime state.
    nonisolated static let domain = "veritas/native-build-admission/v1"
    nonisolated static let profile = "arm64-macos27-single-image-reference-v1"
    nonisolated static let maximumEnvelopeBytes = 2_048

    struct Claims: Sendable {
        let cdhash, identifier: String
        let flags: UInt32
        let entitlementsSHA256, sourceManifestSHA256, reviewedReceiptSHA256: String
        let notBeforeMilliseconds, expiresMilliseconds: UInt64
        fileprivate init(_ fields: [String]) throws {
            guard fields.count == 10, fields[0] == "1" else { throw Failure.malformedEnvelope }
            guard fields[1] == NativeBuildAdmission.profile else { throw Failure.unsupportedProfile }
            guard Self.hex(fields[2], count: 40), (1...128).contains(fields[3].utf8.count),
                  fields[3].utf8.allSatisfy({ $0 >= 32 && $0 != 127 }),
                  let flags = UInt32(fields[4]), String(flags) == fields[4],
                  Self.hex(fields[5], count: 64), Self.hex(fields[6], count: 64), Self.hex(fields[7], count: 64),
                  let start = UInt64(fields[8]), String(start) == fields[8],
                  let end = UInt64(fields[9]), String(end) == fields[9], end > start,
                  end - start <= 3_600_000
            else { throw Failure.malformedEnvelope }
            cdhash = fields[2]; identifier = fields[3]; self.flags = flags
            entitlementsSHA256 = fields[5]; sourceManifestSHA256 = fields[6]; reviewedReceiptSHA256 = fields[7]
            notBeforeMilliseconds = start; expiresMilliseconds = end
        }
        private static func hex(_ text: String, count: Int) -> Bool {
            text.utf8.count == count && text.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
        }
    }

    package struct Observation: Sendable {
        package let cdhash, identifier: String
        package let flags: UInt32
        package let entitlementsSHA256: String
        package var authoritative: Bool { false }
        fileprivate init(cdhash: String, identifier: String, flags: UInt32, entitlementsSHA256: String) {
            self.cdhash = cdhash; self.identifier = identifier; self.flags = flags
            self.entitlementsSHA256 = entitlementsSHA256
        }
    }

    package let receiptSHA256: String
    private let deadline: ContinuousClock.Instant
    private let validateCurrent: @MainActor () throws -> Void
    private var isRevoked = false
    private init(receiptSHA256: String, deadline: ContinuousClock.Instant,
                 validateCurrent: @escaping @MainActor () throws -> Void) {
        self.receiptSHA256 = receiptSHA256; self.deadline = deadline; self.validateCurrent = validateCurrent
    }

    /// Louis is the chosen approver; no production issuer/key is provisioned. Never learn
    /// a trusted key/hash from the candidate, environment, defaults or model text.
    static func production() throws -> NativeBuildAdmission { throw Failure.productionAuthorityUnavailable }

    func revalidate() throws {
        guard !isRevoked else { throw Failure.revoked }
        guard ContinuousClock().now < deadline else { throw Failure.outsideValidityWindow }
        do { try validateCurrent() } catch { isRevoked = true; throw error }
        guard ContinuousClock().now < deadline else { isRevoked = true; throw Failure.outsideValidityWindow }
    }
    func revoke() { isRevoked = true }

    // Signed fixed-order tagged fields, followed by the 64-byte Ed25519 signature.
    // Bounds are checked before copies/parsing; tags, length, domain, field count,
    // canonical integers, extra bytes and unknown profile/version all fail closed.
    private static func verifiedClaims(_ envelope: Data, key: Data) throws -> (Claims, String) {
        guard (65...maximumEnvelopeBytes).contains(envelope.count), key.count == 32 else { throw Failure.malformedEnvelope }
        let owned = Data([UInt8](envelope)), body = Data(owned.dropLast(64)), signature = Data(owned.suffix(64))
        let publicKey: Curve25519.Signing.PublicKey
        do { publicKey = try .init(rawRepresentation: key) } catch { throw Failure.signatureInvalid }
        guard publicKey.isValidSignature(signature, for: body) else { throw Failure.signatureInvalid }
        let bytes = [UInt8](body)
        var offset = 0, fields: [String] = []
        while offset < bytes.count {
            guard bytes.count - offset >= 9, fields.count < 11 else { throw Failure.malformedEnvelope }
            let tag = bytes[offset]; offset += 1
            var length: UInt64 = 0
            for _ in 0..<8 { length = (length << 8) | UInt64(bytes[offset]); offset += 1 }
            guard length <= 128, length <= UInt64(bytes.count - offset),
                  tag == (fields.isEmpty ? 0 : 1),
                  let field = String(bytes: bytes[offset..<(offset + Int(length))], encoding: .utf8)
            else { throw Failure.malformedEnvelope }
            fields.append(field); offset += Int(length)
        }
        guard fields.count == 11, fields.removeFirst() == domain else { throw Failure.malformedEnvelope }
        return (try Claims(fields), ArtifactSnapshot.digest(owned))
    }

    private static func verified(_ envelope: Data, key: Data, nowMilliseconds: UInt64,
                                 validate: @escaping @MainActor (Claims) throws -> Void) throws -> NativeBuildAdmission {
        let (claims, digest) = try verifiedClaims(envelope, key: key)
        guard claims.notBeforeMilliseconds <= nowMilliseconds, nowMilliseconds < claims.expiresMilliseconds
        else { throw Failure.outsideValidityWindow }
        let deadline = ContinuousClock().now.advanced(by: .milliseconds(Int64(claims.expiresMilliseconds - nowMilliseconds)))
        let admitted = NativeBuildAdmission(receiptSHA256: digest, deadline: deadline) { try validate(claims) }
        try admitted.revalidate()
        return admitted
    }

    // Public Security APIs: observe the calling process, validate first, extract
    // bounded API metadata, then validate again against its exact code-directory hash.
    // The entitlement API can reconstitute XML from DER: its blob is an OS API
    // representation, not necessarily the original embedded XML bytes. CDHash
    // separately binds the signed executable. A new OS representation may refuse.
    // An observation of one's own hash is diagnostic, NEVER an approval issuer.
    package static func observeCurrent() throws -> Observation {
        try requireSingleImage()
        var live: SecCode?
        guard SecCodeCopySelf([], &live) == errSecSuccess, let live else { throw Failure.liveCodeUnavailable }
        guard SecCodeCheckValidity(live, .noNetworkAccess, nil) == errSecSuccess else { throw Failure.signatureValidityFailed }
        var disk: SecStaticCode?
        guard SecCodeCopyStaticCode(live, [], &disk) == errSecSuccess, let disk else { throw Failure.signingInformationUnavailable }
        var dictionary: CFDictionary?
        guard SecCodeCopySigningInformation(disk, [], &dictionary) == errSecSuccess,
              let info = dictionary as? [String: Any],
              let cdhash = info[kSecCodeInfoUnique as String] as? Data, cdhash.count == 20,
              let identifier = info[kSecCodeInfoIdentifier as String] as? String,
              (1...128).contains(identifier.utf8.count),
              let flags = info[kSecCodeInfoFlags as String] as? NSNumber,
              CFGetTypeID(flags) == CFNumberGetTypeID(), flags.int64Value >= 0,
              flags.uint64Value <= UInt64(UInt32.max)
        else { throw Failure.malformedIdentity }
        let entitlementDigest: String
        if let raw = info[kSecCodeInfoEntitlements as String] {
            guard let data = raw as? Data, data.count <= 65_536 else { throw Failure.malformedIdentity }
            entitlementDigest = VeritasDigestFrameV1.digest(domain: "veritas/code-entitlements/v1", frames: [Data([1]), data])
        } else {
            // If dictionary entitlements exist without their API blob, do not
            // invent an empty entitlement identity or unordered serialization.
            guard info[kSecCodeInfoEntitlementsDict as String] == nil else { throw Failure.malformedIdentity }
            entitlementDigest = VeritasDigestFrameV1.digest(domain: "veritas/code-entitlements/v1", frames: [Data([0])])
        }
        let hash = cdhash.map { String(format: "%02x", $0) }.joined()
        try requireCode(live, cdhash: hash)
        return Observation(cdhash: hash, identifier: identifier, flags: flags.uint32Value, entitlementsSHA256: entitlementDigest)
    }

    private static func validateLive(_ expected: Claims) throws {
        let observed = try observeCurrent()
        guard observed.cdhash == expected.cdhash, observed.identifier == expected.identifier,
              observed.flags == expected.flags, observed.entitlementsSHA256 == expected.entitlementsSHA256
        else { throw Failure.identityMismatch }
        var live: SecCode?
        guard SecCodeCopySelf([], &live) == errSecSuccess, let live else { throw Failure.liveCodeUnavailable }
        // The independently signed expectation, not the observation, selects this requirement.
        try requireCode(live, cdhash: expected.cdhash)
        try requireSingleImage()
    }

    private static func requireCode(_ live: SecCode, cdhash: String) throws {
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString("cdhash H\"\(cdhash)\"" as CFString, [], &requirement) == errSecSuccess,
              let requirement else { throw Failure.malformedIdentity }
        guard SecCodeCheckValidity(live, .noNetworkAccess, requirement) == errSecSuccess else { throw Failure.signatureValidityFailed }
    }

    private static func requireSingleImage() throws {
        // This function-pointer thunk is emitted in VeritasCore. Refuse a host
        // whose Core code lives in a separate image instead of pretending the
        // host's signature covers it. A future multi-image profile needs its own
        // reviewed image graph. No guarantee about all third-party loaded code.
        let anchor: @convention(c) () -> UInt32 = { 0x564e4931 }
        var image = Dl_info()
        guard dladdr(unsafeBitCast(anchor, to: UnsafeRawPointer.self), &image) != 0,
              let base = image.dli_fbase, let main = _dyld_get_image_header(0),
              base == UnsafeMutableRawPointer(mutating: main)
        else { throw Failure.unsupportedImageLayout }
    }

#if DEBUG
    // All caller-selected keys, clocks and synthetic validators are DEBUG-only.
    // These factories cannot configure a production authority.
    package static func forSignedFixture(_ envelope: Data, publicKey: Data, nowMilliseconds: UInt64) throws -> NativeBuildAdmission {
        try verified(envelope, key: publicKey, nowMilliseconds: nowMilliseconds, validate: validateLive)
    }
    static func forSignatureTests(_ envelope: Data, publicKey: Data, nowMilliseconds: UInt64,
                                 validate: @escaping @MainActor (Claims) throws -> Void) throws -> NativeBuildAdmission {
        try verified(envelope, key: publicKey, nowMilliseconds: nowMilliseconds, validate: validate)
    }
    static func forIsolatedOwnerTests(_ validate: @escaping @MainActor () throws -> Void = {}) -> NativeBuildAdmission {
        NativeBuildAdmission(receiptSHA256: String(repeating: "0", count: 64),
            deadline: .now.advanced(by: .seconds(30)), validateCurrent: validate)
    }
#endif
}
