import Foundation
import Testing

@testable import VeritasCore

// MARK: - FI0.8 Protected Authority Tests

/// Targeted tests for the protected-authority envelope: distinct actors,
/// stale/current authority, high-watermark/fork reconciliation, durable
/// provenance, and product integration.
/// This suite binds and round-trips claim fields only. It does not verify
/// protected actors, external authority, AppModel handlers or product integration.
@Suite("FI0.8 — Protected authority envelope")
struct FI08ProtectedAuthorityTests {

  private func envelopeDigest(_ value: String) -> String {
    ArtifactSnapshot.digest(Data(value.utf8))
  }

  private func envelopeScope(
    project: String = "fi08-project",
    access: String = "fi08-access",
    retention: String = "fi08-retention"
  ) -> IncidentLedgerScopeV1 {
    IncidentLedgerScopeV1(
      scopeID: "scope/veritas-private",
      projectDigest: envelopeDigest(project),
      accessPolicyDigest: envelopeDigest(access),
      retentionPolicyDigest: envelopeDigest(retention)
    )
  }

  private func envelopeContext(
    run: String = "fi08-run",
    observedAt: Date = Date(timeIntervalSince1970: 1_800_000_000),
    retentionReviewAt: Date? = Date(timeIntervalSince1970: 1_801_209_600)
  ) -> PipelineIncidentCaptureContextV1 {
    PipelineIncidentCaptureContextV1(
      runObservationDigest: envelopeDigest(run),
      observedAt: observedAt,
      retentionReviewAt: retentionReviewAt
    )
  }

  private func envelopeSnapshot(
    _ bytes: Data = Data("{".utf8),
    kind: ArtifactKind = .json,
    displayName: String = "fi08-artifact.json"
  ) -> ArtifactSnapshot {
    ArtifactSnapshot(displayName: displayName, kind: kind, bytes: bytes)
  }

  private func envelopeResult(
    snapshot: ArtifactSnapshot,
    profile: CheckProfile = .prototype,
    mode: VeritasMode = .assist
  ) async -> PipelineResult {
    await VeritasPipeline(analyzer: DeterministicOnlyOrchestrator()).analyze(
      snapshot: snapshot,
      profile: profile,
      mode: mode
    )
  }

  @Test(
    "Protected authority envelope binds production inputs and refuses unsupported authority claims")
  func protectedAuthorityEnvelope() async throws {
    let scope = envelopeScope(project: "fi08-protected")

    let snapshot = envelopeSnapshot()
    let result = await envelopeResult(snapshot: snapshot)
    let context = envelopeContext(run: "fi08-protected-run")

    // Create a protected authority envelope with distinct actor claims.
    let actorIdentity = envelopeDigest("fi08-actor-identity")
    let actorCapability = envelopeDigest("fi08-actor-capability")
    let protectedAuthority = envelopeDigest("fi08-protected-authority")
    let authorityReceipt = envelopeDigest("fi08-authority-receipt")
    let sourceEventHighWatermark: Int64 = 1_900_000_000
    let highWatermarkDigest = envelopeDigest("fi08-high-watermark")
    let sourceStreamRoot = envelopeDigest("fi08-source-stream-root")
    let forkHead = envelopeDigest("fi08-fork-head")
    let forkMergeRequest = envelopeDigest("fi08-fork-merge")

    let envelope = try ProtectedAuthorityCaptureEnvelopeV1.make(
      snapshot: snapshot,
      profile: .prototype,
      mode: .assist,
      result: result,
      scope: scope,
      context: context,
      actorIdentityDigest: actorIdentity,
      actorCapabilityDigest: actorCapability,
      actorRole: "veritas-protected-fiu08",
      adjudicationClaim: envelopeDigest("fi08-adjudication"),
      protectedAuthorityDigest: protectedAuthority,
      protectedAuthorityVerified: true,
      authorityReceiptDigest: authorityReceipt,
      sourceEventHighWatermark: sourceEventHighWatermark,
      highWatermarkDigest: highWatermarkDigest,
      sourceStreamRootDigest: sourceStreamRoot,
      forkHeadDigest: forkHead,
      forkMergeRequest: forkMergeRequest,
      forkReconciliationVerified: true
    )

    let canonicalData = try envelope.canonicalData()
    #expect(try ProtectedAuthorityCaptureEnvelopeV1.decodeCanonical(canonicalData) == envelope)

    let canonicalText = String(decoding: canonicalData, as: UTF8.self)
    for malformed in [
      "{\"schemaVersion\":2," + canonicalText.dropFirst(),
      "{\"extra\":null," + canonicalText.dropFirst(),
      "{\"extra\":{\"schemaVersion\":2}," + canonicalText.dropFirst(),
      canonicalText.replacingOccurrences(of: "\"schemaVersion\":", with: "\"\\u0073chemaVersion\":"),
      canonicalText + "null",
      "[" + canonicalText + "]",
    ] {
      #expect(throws: ProtectedAuthorityCaptureEnvelopeErrorV1.inputNonCanonical) {
        try ProtectedAuthorityCaptureEnvelopeV1.decodeCanonical(Data(malformed.utf8))
      }
    }

    // Verify the envelope has all protected-authority claims.
    #expect(envelope.actorIdentityDigest != nil)
    #expect(envelope.actorCapabilityDigest != nil)
    #expect(envelope.protectedAuthorityDigest != nil)
    #expect(envelope.protectedAuthorityVerified == true)
    #expect(envelope.authorityReceiptDigest != nil)
    #expect(envelope.sourceEventHighWatermark != nil)
    #expect(envelope.highWatermarkDigest != nil)
    #expect(envelope.sourceStreamRootDigest != nil)
    #expect(envelope.forkHeadDigest != nil)
    #expect(envelope.forkMergeRequest != nil)
    #expect(envelope.forkReconciliationVerified == true)

    // Verify the envelope has the correct status fields.
    #expect(envelope.highWatermarkStatus == .supported)
    #expect(envelope.protectedAuthorityStatus == .supported)

    // Now test that a non-protected envelope is correctly identified.
    let nonProtectedEnvelope = try ProtectedAuthorityCaptureEnvelopeV1.make(
      snapshot: snapshot,
      profile: .prototype,
      mode: .assist,
      result: result,
      scope: scope,
      context: context,
      actorIdentityDigest: nil,
      actorCapabilityDigest: nil,
      actorRole: nil,
      adjudicationClaim: nil,
      protectedAuthorityDigest: nil,
      protectedAuthorityVerified: nil,
      authorityReceiptDigest: nil,
      sourceEventHighWatermark: nil,
      highWatermarkDigest: nil,
      sourceStreamRootDigest: nil,
      forkHeadDigest: nil,
      forkMergeRequest: nil,
      forkReconciliationVerified: nil
    )

    #expect(nonProtectedEnvelope.actorIdentityDigest == nil)
    #expect(nonProtectedEnvelope.protectedAuthorityDigest == nil)
    #expect(nonProtectedEnvelope.sourceEventHighWatermark == nil)
    #expect(nonProtectedEnvelope.forkHeadDigest == nil)
    #expect(nonProtectedEnvelope.highWatermarkStatus == .unsupported)
    #expect(nonProtectedEnvelope.protectedAuthorityStatus == .unsupported)

    // Verify round-trip for non-protected envelope.
    let nonCanonicalData = try nonProtectedEnvelope.canonicalData()
    #expect(
      try ProtectedAuthorityCaptureEnvelopeV1.decodeCanonical(nonCanonicalData)
        == nonProtectedEnvelope)

    // Verify scope binding.
    #expect(envelope.hasSameScope(as: scope))
    let alternateScope = envelopeScope(project: "fi08-alternate")
    #expect(!envelope.hasSameScope(as: alternateScope))

  }

  @Test("Protected authority envelope refuses malformed claims")
  func protectedAuthorityRefusesMalformedClaims() async throws {
    let scope = envelopeScope(project: "fi08-malformed")

    let snapshot = envelopeSnapshot()
    let result = await envelopeResult(snapshot: snapshot)
    let context = envelopeContext(run: "fi08-malformed-run")

    // Test malformed actor identity.
    do {
      _ = try ProtectedAuthorityCaptureEnvelopeV1.make(
        snapshot: snapshot,
        profile: .prototype,
        mode: .assist,
        result: result,
        scope: scope,
        context: context,
        actorIdentityDigest: "not-a-digest",
        actorCapabilityDigest: nil,
        actorRole: nil,
        adjudicationClaim: nil,
        protectedAuthorityDigest: nil,
        protectedAuthorityVerified: nil,
        authorityReceiptDigest: nil,
        sourceEventHighWatermark: nil,
        highWatermarkDigest: nil,
        sourceStreamRootDigest: nil,
        forkHeadDigest: nil,
        forkMergeRequest: nil,
        forkReconciliationVerified: nil
      )
      Issue.record("Malformed actor identity must throw.")
    } catch {
      #expect(error is ProtectedAuthorityCaptureEnvelopeErrorV1)
    }

    // Test malformed protected authority digest.
    do {
      _ = try ProtectedAuthorityCaptureEnvelopeV1.make(
        snapshot: snapshot,
        profile: .prototype,
        mode: .assist,
        result: result,
        scope: scope,
        context: context,
        actorIdentityDigest: nil,
        actorCapabilityDigest: nil,
        actorRole: nil,
        adjudicationClaim: nil,
        protectedAuthorityDigest: "not-a-digest",
        protectedAuthorityVerified: nil,
        authorityReceiptDigest: nil,
        sourceEventHighWatermark: nil,
        highWatermarkDigest: nil,
        sourceStreamRootDigest: nil,
        forkHeadDigest: nil,
        forkMergeRequest: nil,
        forkReconciliationVerified: nil
      )
      Issue.record("Malformed protected authority must throw.")
    } catch {
      #expect(error is ProtectedAuthorityCaptureEnvelopeErrorV1)
    }

    // Test malformed high-watermark digest.
    do {
      _ = try ProtectedAuthorityCaptureEnvelopeV1.make(
        snapshot: snapshot,
        profile: .prototype,
        mode: .assist,
        result: result,
        scope: scope,
        context: context,
        actorIdentityDigest: nil,
        actorCapabilityDigest: nil,
        actorRole: nil,
        adjudicationClaim: nil,
        protectedAuthorityDigest: nil,
        protectedAuthorityVerified: nil,
        authorityReceiptDigest: nil,
        sourceEventHighWatermark: 1_900_000_000,
        highWatermarkDigest: "not-a-digest",
        sourceStreamRootDigest: nil,
        forkHeadDigest: nil,
        forkMergeRequest: nil,
        forkReconciliationVerified: nil
      )
      Issue.record("Malformed high-watermark must throw.")
    } catch {
      #expect(error is ProtectedAuthorityCaptureEnvelopeErrorV1)
    }

    // Test malformed fork head digest.
    do {
      _ = try ProtectedAuthorityCaptureEnvelopeV1.make(
        snapshot: snapshot,
        profile: .prototype,
        mode: .assist,
        result: result,
        scope: scope,
        context: context,
        actorIdentityDigest: nil,
        actorCapabilityDigest: nil,
        actorRole: nil,
        adjudicationClaim: nil,
        protectedAuthorityDigest: nil,
        protectedAuthorityVerified: nil,
        authorityReceiptDigest: nil,
        sourceEventHighWatermark: nil,
        highWatermarkDigest: nil,
        sourceStreamRootDigest: nil,
        forkHeadDigest: "not-a-digest",
        forkMergeRequest: nil,
        forkReconciliationVerified: nil
      )
      Issue.record("Malformed fork head must throw.")
    } catch {
      #expect(error is ProtectedAuthorityCaptureEnvelopeErrorV1)
    }

  }

  @Test("Protected authority envelope supports stale/current authority")
  func protectedAuthoritySupportsStaleCurrentAuthority() async throws {
    let scope = envelopeScope(project: "fi08-stale-current")

    let snapshot = envelopeSnapshot()
    let result = await envelopeResult(snapshot: snapshot)
    let context = envelopeContext(run: "fi08-stale-current-run")

    // Create an envelope with verified protected authority.
    let verifiedEnvelope = try ProtectedAuthorityCaptureEnvelopeV1.make(
      snapshot: snapshot,
      profile: .prototype,
      mode: .assist,
      result: result,
      scope: scope,
      context: context,
      actorIdentityDigest: envelopeDigest("fi08-actor-verified"),
      actorCapabilityDigest: envelopeDigest("fi08-actor-capability-verified"),
      actorRole: "veritas-protected-fiu08-verified",
      adjudicationClaim: envelopeDigest("fi08-adjudication-verified"),
      protectedAuthorityDigest: envelopeDigest("fi08-protected-verified"),
      protectedAuthorityVerified: true,
      authorityReceiptDigest: envelopeDigest("fi08-authority-receipt-verified"),
      sourceEventHighWatermark: 1_900_000_000,
      highWatermarkDigest: envelopeDigest("fi08-high-watermark-verified"),
      sourceStreamRootDigest: envelopeDigest("fi08-source-stream-root-verified"),
      forkHeadDigest: envelopeDigest("fi08-fork-head-verified"),
      forkMergeRequest: envelopeDigest("fi08-fork-merge-verified"),
      forkReconciliationVerified: true
    )

    #expect(verifiedEnvelope.protectedAuthorityVerified == true)
    #expect(verifiedEnvelope.protectedAuthorityStatus == .supported)

    // Create an envelope with unverified protected authority (stale).
    let unverifiedEnvelope = try ProtectedAuthorityCaptureEnvelopeV1.make(
      snapshot: snapshot,
      profile: .prototype,
      mode: .assist,
      result: result,
      scope: scope,
      context: context,
      actorIdentityDigest: envelopeDigest("fi08-actor-unverified"),
      actorCapabilityDigest: envelopeDigest("fi08-actor-capability-unverified"),
      actorRole: "veritas-protected-fiu08-unverified",
      adjudicationClaim: envelopeDigest("fi08-adjudication-unverified"),
      protectedAuthorityDigest: envelopeDigest("fi08-protected-unverified"),
      protectedAuthorityVerified: false,
      authorityReceiptDigest: envelopeDigest("fi08-authority-receipt-unverified"),
      sourceEventHighWatermark: 1_900_000_000,
      highWatermarkDigest: envelopeDigest("fi08-high-watermark-unverified"),
      sourceStreamRootDigest: envelopeDigest("fi08-source-stream-root-unverified"),
      forkHeadDigest: envelopeDigest("fi08-fork-head-unverified"),
      forkMergeRequest: envelopeDigest("fi08-fork-merge-unverified"),
      forkReconciliationVerified: false
    )

    #expect(unverifiedEnvelope.protectedAuthorityVerified == false)
    #expect(unverifiedEnvelope.protectedAuthorityStatus == .supported)

    // Verify round-trip for both.
    let verifiedCanonical = try verifiedEnvelope.canonicalData()
    #expect(
      try ProtectedAuthorityCaptureEnvelopeV1.decodeCanonical(verifiedCanonical) == verifiedEnvelope
    )

    let unverifiedCanonical = try unverifiedEnvelope.canonicalData()
    #expect(
      try ProtectedAuthorityCaptureEnvelopeV1.decodeCanonical(unverifiedCanonical)
        == unverifiedEnvelope)

  }

  @Test("Protected authority envelope supports durable provenance")
  func protectedAuthoritySupportsDurableProvenance() async throws {
    let scope = envelopeScope(project: "fi08-provenance")

    let snapshot = envelopeSnapshot()
    let result = await envelopeResult(snapshot: snapshot)
    let context = envelopeContext(run: "fi08-provenance-run")

    // Create an envelope with all durable-provenance claims.
    let envelope = try ProtectedAuthorityCaptureEnvelopeV1.make(
      snapshot: snapshot,
      profile: .prototype,
      mode: .assist,
      result: result,
      scope: scope,
      context: context,
      actorIdentityDigest: envelopeDigest("fi08-actor-provenance"),
      actorCapabilityDigest: envelopeDigest("fi08-actor-capability-provenance"),
      actorRole: "veritas-protected-fiu08-provenance",
      adjudicationClaim: envelopeDigest("fi08-adjudication-provenance"),
      protectedAuthorityDigest: envelopeDigest("fi08-protected-provenance"),
      protectedAuthorityVerified: true,
      authorityReceiptDigest: envelopeDigest("fi08-authority-receipt-provenance"),
      sourceEventHighWatermark: 1_900_000_000,
      highWatermarkDigest: envelopeDigest("fi08-high-watermark-provenance"),
      sourceStreamRootDigest: envelopeDigest("fi08-source-stream-root-provenance"),
      forkHeadDigest: envelopeDigest("fi08-fork-head-provenance"),
      forkMergeRequest: envelopeDigest("fi08-fork-merge-provenance"),
      forkReconciliationVerified: true
    )

    // Verify all durable-provenance claims are present.
    #expect(envelope.actorIdentityDigest != nil)
    #expect(envelope.actorCapabilityDigest != nil)
    #expect(envelope.protectedAuthorityDigest != nil)
    #expect(envelope.authorityReceiptDigest != nil)
    #expect(envelope.sourceEventHighWatermark != nil)
    #expect(envelope.highWatermarkDigest != nil)
    #expect(envelope.sourceStreamRootDigest != nil)
    #expect(envelope.forkHeadDigest != nil)
    #expect(envelope.forkMergeRequest != nil)
    #expect(envelope.forkReconciliationVerified == true)

    // Verify round-trip.
    let canonicalData = try envelope.canonicalData()
    #expect(try ProtectedAuthorityCaptureEnvelopeV1.decodeCanonical(canonicalData) == envelope)

  }

  @Test("Protected authority envelope binds product-integration claim fields")
  func protectedAuthoritySupportsProductIntegration() async throws {
    let scope = envelopeScope(project: "fi08-product-integration")

    let snapshot = envelopeSnapshot()
    let result = await envelopeResult(snapshot: snapshot)
    let context = envelopeContext(run: "fi08-product-integration-run")

    // Create an envelope with all product-integration claims.
    let envelope = try ProtectedAuthorityCaptureEnvelopeV1.make(
      snapshot: snapshot,
      profile: .prototype,
      mode: .assist,
      result: result,
      scope: scope,
      context: context,
      actorIdentityDigest: envelopeDigest("fi08-actor-product"),
      actorCapabilityDigest: envelopeDigest("fi08-actor-capability-product"),
      actorRole: "veritas-protected-fiu08-product",
      adjudicationClaim: envelopeDigest("fi08-adjudication-product"),
      protectedAuthorityDigest: envelopeDigest("fi08-protected-product"),
      protectedAuthorityVerified: true,
      authorityReceiptDigest: envelopeDigest("fi08-authority-receipt-product"),
      sourceEventHighWatermark: 1_900_000_000,
      highWatermarkDigest: envelopeDigest("fi08-high-watermark-product"),
      sourceStreamRootDigest: envelopeDigest("fi08-source-stream-root-product"),
      forkHeadDigest: envelopeDigest("fi08-fork-head-product"),
      forkMergeRequest: envelopeDigest("fi08-fork-merge-product"),
      forkReconciliationVerified: true
    )

    // Verify all product-integration claims are present.
    #expect(envelope.actorIdentityDigest != nil)
    #expect(envelope.actorCapabilityDigest != nil)
    #expect(envelope.protectedAuthorityDigest != nil)
    #expect(envelope.authorityReceiptDigest != nil)
    #expect(envelope.sourceEventHighWatermark != nil)
    #expect(envelope.highWatermarkDigest != nil)
    #expect(envelope.sourceStreamRootDigest != nil)
    #expect(envelope.forkHeadDigest != nil)
    #expect(envelope.forkMergeRequest != nil)
    #expect(envelope.forkReconciliationVerified == true)

    // Verify round-trip.
    let canonicalData = try envelope.canonicalData()
    #expect(try ProtectedAuthorityCaptureEnvelopeV1.decodeCanonical(canonicalData) == envelope)

  }
}

// MARK: - Helpers (copied from existing tests for consistency)

private func envelopeDigest(_ value: String) -> String {
  ArtifactSnapshot.digest(Data(value.utf8))
}

// MARK: - Capability status observed through the canonical wire
//
// `highWatermarkStatus` / `protectedAuthorityStatus` are `private` on the
// envelope inside VeritasCore, so `@testable import` cannot reach them. The
// envelope emits the very same values on its canonical wire as
// `highWatermarkSupported` / `protectedAuthoritySupported`, so read them back
// from there. This keeps the assertions above observing the envelope's own
// derivation; a `nil` (no canonical data, or key missing/invalid) makes those
// comparisons fail rather than pass.
extension ProtectedAuthorityCaptureEnvelopeV1 {
  fileprivate var highWatermarkStatus: ProtectedAuthorityCapabilityStatusV1? {
    canonicalWireStatus(forKey: "highWatermarkSupported")
  }

  fileprivate var protectedAuthorityStatus: ProtectedAuthorityCapabilityStatusV1? {
    canonicalWireStatus(forKey: "protectedAuthoritySupported")
  }

  private func canonicalWireStatus(forKey key: String) -> ProtectedAuthorityCapabilityStatusV1? {
    guard let data = try? canonicalData(),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let rawValue = object[key] as? String
    else {
      return nil
    }
    return ProtectedAuthorityCapabilityStatusV1(rawValue: rawValue)
  }
}
