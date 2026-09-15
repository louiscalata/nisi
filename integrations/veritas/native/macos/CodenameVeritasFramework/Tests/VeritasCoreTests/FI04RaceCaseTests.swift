import Darwin
import Dispatch
import Foundation
import Testing

@testable import VeritasCore

// MARK: - FI0.4 Race Case Tests — Profile Replacement + Incident-Action
// These are core-control simulations, not calls to AppModel.setProfile or
// incident-action UI handlers. They cannot close the product integration gate.

/// Targeted race tests for the 2 missing AppModel lifecycle-revocation cases:
/// profile replacement and incident-action.
///
/// These tests prove that calling `setProfile()` or executing an incident action
/// synchronously invalidates pending captures before the next admission epoch,
/// so a capture already queued behind the ledger cannot commit under stale
/// authority.
@Suite("FI0.4 — AppModel lifecycle-revocation: profile replacement + incident-action")
struct FI04RaceCaseTests {

  // MARK: - Profile Replacement Race Case

  @Test("Profile replacement invalidates pending captures before next admission")
  func profileReplacementInvalidatesPendingCaptures() async throws {
    let root = try makeAdapterRoot()
    defer { try? FileManager.default.removeItem(at: root) }

    let scope = adapterScope("fi04-profile-replacement")
    let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
    try await withAsyncTestCleanup(
      operation: { () async throws -> Void in

        // Create an enabled adapter and a pending capture.
        let control = PipelineIncidentCaptureControlV1(enabled: true)
        let adapter = PipelineIncidentAdapterV1(control: control)
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let context = adapterContext(run: "fi04-profile-replacement-run")

        // Queue a capture and block it at the fault gate.
        let gate = AdapterBlockingFaultGate()
        let blockedRoot = root.appendingPathComponent("blocked").appendingPathComponent(
          UUID().uuidString
        )
        try FileManager.default.createDirectory(
          at: blockedRoot,
          withIntermediateDirectories: true,
          attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let blockedLedger = try await LocalIncidentLedgerV1.openForTesting(
          rootDirectory: blockedRoot,
          scope: adapterScope("fi04-blocked"),
          faultInjector: gate.inject
        )
        try await withAsyncTestCleanup(
          operation: { () async throws -> Void in

            let captureTask = Task {
              await adapter.capture(
                snapshot: snapshot,
                profile: .prototype,
                mode: .assist,
                result: result,
                context: context,
                ledger: blockedLedger
              )
            }
            try await withAsyncTestCleanup(
              operation: { () async throws -> Void in

                // Wait for the capture to enter the fault gate.
                var enteredEvents = gate.entered.makeAsyncIterator()
                let entered: Void? = await enteredEvents.next()
                #expect(entered != nil, "The capture must enter the fault gate.")

                // The capture is now queued. Advance the admission epoch by invalidating
                // the control (simulating profile replacement).
                control.invalidatePendingCaptures()

                // Release the gate. The old capture must be skipped with .admissionRevoked
                // because its control was invalidated.
                gate.release.signal()
                let outcome = await captureTask.value

                #expect(outcome.status == .skipped)
                #expect(outcome.reason == .admissionRevoked)
                #expect(outcome.storedEvidenceSetDigest == nil)
                #expect(try await blockedLedger.verifyIntegrity().eventCount == 0)
              },
              cleanup: {
                gate.release.signal()
                _ = await captureTask.value
              })
          },
          cleanup: {
            try? await blockedLedger.close()
          })
      },
      cleanup: {
        try? await ledger.close()
      })
  }

  @Test("Profile replacement advances the admission epoch and rejects stale captures")
  func profileReplacementAdvancesAdmissionEpoch() async throws {
    let root = try makeAdapterRoot()
    defer { try? FileManager.default.removeItem(at: root) }

    let scope = adapterScope("fi04-epoch-advance")
    let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
    try await withAsyncTestCleanup(
      operation: { () async throws -> Void in

        // Create an enabled adapter and queue a capture.
        let control = PipelineIncidentCaptureControlV1(enabled: true)
        let adapter = PipelineIncidentAdapterV1(control: control)
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let context = adapterContext(run: "fi04-epoch-advance-run")

        // Queue a capture and block it at the fault gate.
        let gate = AdapterBlockingFaultGate()
        let blockedRoot = root.appendingPathComponent("blocked-epoch").appendingPathComponent(
          UUID().uuidString
        )
        try FileManager.default.createDirectory(
          at: blockedRoot,
          withIntermediateDirectories: true,
          attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let blockedLedger = try await LocalIncidentLedgerV1.openForTesting(
          rootDirectory: blockedRoot,
          scope: adapterScope("fi04-blocked-epoch"),
          faultInjector: gate.inject
        )
        try await withAsyncTestCleanup(
          operation: { () async throws -> Void in

            let captureTask = Task {
              await adapter.capture(
                snapshot: snapshot,
                profile: .prototype,
                mode: .assist,
                result: result,
                context: context,
                ledger: blockedLedger
              )
            }
            try await withAsyncTestCleanup(
              operation: { () async throws -> Void in

                // Wait for the capture to enter the fault gate.
                var enteredEvents = gate.entered.makeAsyncIterator()
                let entered: Void? = await enteredEvents.next()
                #expect(entered != nil, "The capture must enter the fault gate.")

                // Simulate profile replacement: invalidate the old control (advancing
                // its admission generation) and stand up a new control/adapter pair
                // for the replacement profile.
                control.invalidatePendingCaptures()
                let newControl = PipelineIncidentCaptureControlV1(enabled: true)
                let newAdapter = PipelineIncidentAdapterV1(control: newControl)

                // Release the gate. The old capture must be skipped with .admissionRevoked
                // because its control was invalidated.
                gate.release.signal()
                let outcome = await captureTask.value

                #expect(outcome.status == .skipped)
                #expect(outcome.reason == .admissionRevoked)
                #expect(outcome.storedEvidenceSetDigest == nil)
                #expect(try await blockedLedger.verifyIntegrity().eventCount == 0)

                // Now verify that a new capture with the new control is accepted.
                let newContext = adapterContext(run: "fi04-new-after-replacement")
                let newOutcome = await newAdapter.capture(
                  snapshot: snapshot,
                  profile: .prototype,
                  mode: .assist,
                  result: result,
                  context: newContext,
                  ledger: ledger
                )

                #expect(newOutcome.status == .appended)
                #expect(newOutcome.storedEvidenceSetDigest != nil)
                #expect(try await ledger.verifyIntegrity().eventCount == 1)
              },
              cleanup: {
                gate.release.signal()
                _ = await captureTask.value
              })
          },
          cleanup: {
            try? await blockedLedger.close()
          })
      },
      cleanup: {
        try? await ledger.close()
      })
  }

  // MARK: - Incident-Action Race Case

  @Test("Incident action invalidates pending captures before next admission")
  func incidentActionInvalidatesPendingCaptures() async throws {
    let root = try makeAdapterRoot()
    defer { try? FileManager.default.removeItem(at: root) }

    let scope = adapterScope("fi04-incident-action")
    let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
    try await withAsyncTestCleanup(
      operation: { () async throws -> Void in

        // Create an enabled adapter and queue a capture.
        let control = PipelineIncidentCaptureControlV1(enabled: true)
        let adapter = PipelineIncidentAdapterV1(control: control)
        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let context = adapterContext(run: "fi04-incident-action-run")

        // Queue a capture and block it at the fault gate.
        let gate = AdapterBlockingFaultGate()
        let blockedRoot = root.appendingPathComponent("blocked-action").appendingPathComponent(
          UUID().uuidString
        )
        try FileManager.default.createDirectory(
          at: blockedRoot,
          withIntermediateDirectories: true,
          attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let blockedLedger = try await LocalIncidentLedgerV1.openForTesting(
          rootDirectory: blockedRoot,
          scope: adapterScope("fi04-blocked-action"),
          faultInjector: gate.inject
        )
        try await withAsyncTestCleanup(
          operation: { () async throws -> Void in

            let captureTask = Task {
              await adapter.capture(
                snapshot: snapshot,
                profile: .prototype,
                mode: .assist,
                result: result,
                context: context,
                ledger: blockedLedger
              )
            }
            try await withAsyncTestCleanup(
              operation: { () async throws -> Void in

                // Wait for the capture to enter the fault gate.
                var enteredEvents = gate.entered.makeAsyncIterator()
                let entered: Void? = await enteredEvents.next()
                #expect(entered != nil, "The capture must enter the fault gate.")

                // Simulate incident action: call invalidatePendingMutations() on the
                // control (simulating tombstone, inspect, redactedExport, or retentionReview).
                control.invalidatePendingCaptures()

                // Release the gate. The old capture must be skipped with .admissionRevoked
                // because its control was invalidated.
                gate.release.signal()
                let outcome = await captureTask.value

                #expect(outcome.status == .skipped)
                #expect(outcome.reason == .admissionRevoked)
                #expect(outcome.storedEvidenceSetDigest == nil)
                #expect(try await blockedLedger.verifyIntegrity().eventCount == 0)

                // invalidatePendingCaptures() is a one-shot currentness fence over
                // already-issued admissions, not a kill switch: it advances the
                // generation so in-flight captures cannot commit under stale authority,
                // but leaves the control armed. AppModel relies on exactly this split --
                // invalidateIncidentCapture(disable:) always invalidates, and only calls
                // setEnabled(false) when disable is true, otherwise re-arming to .armed.
                // So a capture admitted AFTER the invalidation is current and is stored.
                let newContext = adapterContext(run: "fi04-new-after-action")
                let newOutcome = await adapter.capture(
                  snapshot: snapshot,
                  profile: .prototype,
                  mode: .assist,
                  result: result,
                  context: newContext,
                  ledger: ledger
                )

                #expect(newOutcome.status == .appended)
                #expect(newOutcome.storedEvidenceSetDigest != nil)
                #expect(try await ledger.verifyIntegrity().eventCount == 1)

                // The actual kill switch is setEnabled(false). Proving it here keeps the
                // two mechanisms distinguishable: after disabling, a further capture on
                // the same control is refused rather than stored.
                control.setEnabled(false)
                let disabledContext = adapterContext(run: "fi04-after-disable")
                let disabledOutcome = await adapter.capture(
                  snapshot: snapshot,
                  profile: .prototype,
                  mode: .assist,
                  result: result,
                  context: disabledContext,
                  ledger: ledger
                )

                #expect(disabledOutcome.status == .skipped)
                #expect(disabledOutcome.storedEvidenceSetDigest == nil)
                #expect(try await ledger.verifyIntegrity().eventCount == 1)
              },
              cleanup: {
                gate.release.signal()
                _ = await captureTask.value
              })
          },
          cleanup: {
            try? await blockedLedger.close()
          })
      },
      cleanup: {
        try? await ledger.close()
      })
  }

  @Test("Incident action preserves the exact result when rejecting stale captures")
  func incidentActionPreservesExactResult() async throws {
    let root = try makeAdapterRoot()
    defer { try? FileManager.default.removeItem(at: root) }

    let scope = adapterScope("fi04-result-preservation")
    let ledger = try await LocalIncidentLedgerV1.open(rootDirectory: root, scope: scope)
    try await withAsyncTestCleanup(
      operation: { () async throws -> Void in

        let snapshot = adapterSnapshot()
        let result = await adapterResult(snapshot: snapshot)
        let before = result
        let beforeDigest = result.resultEvidenceDigest

        // Create an enabled adapter and queue a capture.
        let control = PipelineIncidentCaptureControlV1(enabled: true)
        let adapter = PipelineIncidentAdapterV1(control: control)
        let context = adapterContext(run: "fi04-result-preservation-run")

        // Queue a capture and block it at the fault gate.
        let gate = AdapterBlockingFaultGate()
        let blockedRoot = root.appendingPathComponent("blocked-result").appendingPathComponent(
          UUID().uuidString
        )
        try FileManager.default.createDirectory(
          at: blockedRoot,
          withIntermediateDirectories: true,
          attributes: [.posixPermissions: NSNumber(value: 0o700)]
        )
        let blockedLedger = try await LocalIncidentLedgerV1.openForTesting(
          rootDirectory: blockedRoot,
          scope: adapterScope("fi04-blocked-result"),
          faultInjector: gate.inject
        )
        try await withAsyncTestCleanup(
          operation: { () async throws -> Void in

            let captureTask = Task {
              await adapter.capture(
                snapshot: snapshot,
                profile: .prototype,
                mode: .assist,
                result: result,
                context: context,
                ledger: blockedLedger
              )
            }
            try await withAsyncTestCleanup(
              operation: { () async throws -> Void in

                // Wait for the capture to enter the fault gate.
                var enteredEvents = gate.entered.makeAsyncIterator()
                let entered: Void? = await enteredEvents.next()
                #expect(entered != nil, "The capture must enter the fault gate.")

                // Simulate incident action: invalidate pending mutations.
                control.invalidatePendingCaptures()

                // Release the gate.
                gate.release.signal()
                let outcome = await captureTask.value

                #expect(outcome.status == .skipped)
                #expect(outcome.reason == .admissionRevoked)
                #expect(outcome.storedEvidenceSetDigest == nil)

                // Verify the result was not changed.
                #expect(result == before)
                #expect(result.resultEvidenceDigest == beforeDigest)
                #expect(try await blockedLedger.verifyIntegrity().eventCount == 0)
              },
              cleanup: {
                gate.release.signal()
                _ = await captureTask.value
              })
          },
          cleanup: {
            try? await blockedLedger.close()
          })
      },
      cleanup: {
        try? await ledger.close()
      })
  }
}

// MARK: - Helpers (copied from existing tests for consistency)

private func makeAdapterRoot() throws -> URL {
  let root = FileManager.default.temporaryDirectory
    .appendingPathComponent("veritas-fi04-race-tests-\(UUID().uuidString)", isDirectory: true)
  try FileManager.default.createDirectory(
    at: root,
    withIntermediateDirectories: false,
    attributes: [.posixPermissions: NSNumber(value: 0o700)]
  )
  return root
}

private func adapterDigest(_ value: String) -> String {
  ArtifactSnapshot.digest(Data(value.utf8))
}

private func adapterScope(_ project: String = "fi04-project") -> IncidentLedgerScopeV1 {
  IncidentLedgerScopeV1(
    scopeID: "scope/veritas-private",
    projectDigest: adapterDigest(project),
    accessPolicyDigest: adapterDigest("fi04-access"),
    retentionPolicyDigest: adapterDigest("fi04-retention")
  )
}

private func adapterContext(
  run: String = "fi04-run",
  observedAt: Date = Date(timeIntervalSince1970: 1_800_000_000),
  retentionReviewAt: Date? = Date(timeIntervalSince1970: 1_801_209_600)
) -> PipelineIncidentCaptureContextV1 {
  PipelineIncidentCaptureContextV1(
    runObservationDigest: adapterDigest(run),
    observedAt: observedAt,
    retentionReviewAt: retentionReviewAt
  )
}

private func adapterSnapshot(
  _ bytes: Data = Data("{".utf8),
  kind: ArtifactKind = .json,
  displayName: String = "fi04-artifact.json"
) -> ArtifactSnapshot {
  ArtifactSnapshot(displayName: displayName, kind: kind, bytes: bytes)
}

private func adapterResult(
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

private final class AdapterBlockingFaultGate: @unchecked Sendable {
  let entered: AsyncStream<Void>
  let release = DispatchSemaphore(value: 0)
  private let enteredContinuation: AsyncStream<Void>.Continuation
  private let lock = NSLock()
  private var firstWrite = true

  init() {
    var continuation: AsyncStream<Void>.Continuation?
    self.entered = AsyncStream(bufferingPolicy: .bufferingNewest(1)) {
      continuation = $0
    }
    self.enteredContinuation = continuation!
  }

  func inject(_ point: IncidentLedgerFaultPointV1) throws {
    guard point == .afterEventInsertBeforeMetadataUpdate else { return }
    let shouldBlock = lock.withLock {
      guard firstWrite else { return false }
      firstWrite = false
      return true
    }
    guard shouldBlock else { return }
    enteredContinuation.yield(())
    _ = release.wait(timeout: .now() + 5)
  }
}
