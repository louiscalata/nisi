import AppKit
import SwiftUI
import VeritasCore

struct MenuBarView: View {
    @Bindable var model: AppModel
    @State private var presentedReferenceReview: AppModel.ReferenceRunReview?

    var body: some View {
        let truth = ShellTruthV1(input: ShellTruthInputV1(model: model))
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Nisi")
                    .font(.headline)
                Text("Exact-version reliability prototype")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Picker("Desired mode", selection: Binding(
                get: { model.desiredMode },
                set: { model.setMode($0) }
            )) {
                ForEach(VeritasMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier(ShellAccessibilityIDV1.modePicker)
            .accessibilityLabel("Desired mode")
            .accessibilityValue(truth.mode.label)

            ShellTruthBlock(truth: truth)

            Button("Review Reference Run…") {
                if model.prepareReferenceRunReview() { presentedReferenceReview = model.referenceRunReview }
            }
                .disabled(!model.canRunReferenceModel)
                .accessibilityIdentifier("veritas.reference.run-once")
                .accessibilityLabel("Review Reference Run")
                .help(model.referenceRunUnavailableReason ?? "Review exact input and limits before confirming one local reference run.")
            Text(model.referenceRunUnavailableReason ?? "Reference run: \(model.referenceRunState.rawValue). Non-authorizing, no learning or AFM route.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("veritas.reference.status")

            Divider()

            Toggle(
                "Remember deterministic failures locally",
                isOn: Binding(
                    get: { model.incidentCaptureEnabled },
                    set: { model.setIncidentCaptureEnabled($0) }
                )
            )
            .disabled(model.desiredMode != .assist)
            .accessibilityIdentifier(ShellAccessibilityIDV1.historyToggle)
            LabeledContent(
                "Incident history",
                value: model.incidentHistoryAvailability.rawValue
            )
            LabeledContent(
                "Latest capture",
                value: model.incidentCaptureInFlight
                    ? "CAPTURING"
                    : (model.incidentCaptureOutcome?.status.rawValue ?? "NONE")
            )
            if let reason = model.incidentCaptureOutcome?.reason {
                Text(reason.rawValue)
                    .font(.caption2.monospaced())
            } else if let reason = model.incidentHistoryReason {
                Text(reason.rawValue)
                    .font(.caption2.monospaced())
            }
            Text("Opt-in, digest-only, same-user history. It cannot change results, acceptance, prompts, repairs, promotion, or certification.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            DisclosureGroup("Stored fingerprints (\(model.incidentHistory.count))") {
                if model.incidentHistory.isEmpty {
                    Text("No digest-only fingerprints are loaded.")
                        .font(.caption)
                }
                ForEach(model.incidentHistory, id: \.incidentID) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        Text("incident/\(item.incidentDigest.prefix(16))…")
                            .font(.caption2.monospaced())
                        Text(item.failureCodes.map(\.rawValue).joined(separator: ", "))
                            .font(.caption2)
                        Text(item.symptomCodes.map(\.rawValue).joined(separator: ", "))
                            .font(.caption2)
                        HStack {
                            Button("Inspect") { model.inspectIncident(item) }
                            Button("Explain") { model.explainIncident(item) }
                                .accessibilityLabel("Explain recorded incident signals")
                        }
                        .buttonStyle(.borderless)
                        .disabled(model.incidentActionInFlight || model.fileExportInFlight)
                        HStack {
                            Button("Prepare Redacted Export") {
                                model.prepareRedactedIncidentExport(item)
                            }
                            Button("Delete from Active History", role: .destructive) {
                                model.deleteIncident(item)
                            }
                        }
                        .buttonStyle(.borderless)
                        .disabled(model.incidentActionInFlight || model.fileExportInFlight)
                    }
                }
                Text("Fingerprint rows are not verified occurrence counts.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Button("Refresh Local History") {
                model.refreshIncidentHistory()
            }
            .accessibilityIdentifier(ShellAccessibilityIDV1.refreshHistory)
            .disabled(
                model.incidentCaptureInFlight
                    || model.incidentActionInFlight
                    || model.fileExportInFlight
            )

            if let reason = model.incidentActionReason {
                Text(reason.rawValue)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.red)
            }

            if let incident = model.inspectedIncident {
                VStack(alignment: .leading, spacing: 3) {
                    LabeledContent("Selected incident", value: incident.lifecycleState.rawValue)
                    Text("event sha256:\(incident.summary.eventDigest.prefix(16))…")
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                    if let tombstone = incident.tombstone {
                        Text("Logical tombstone · \(tombstone.reason.rawValue) · physical erasure: NO")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            if let explanation = model.incidentExplanation {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Recorded signals · \(explanation.lifecycle)")
                        .font(.caption.bold())
                    ForEach(explanation.signals, id: \.identity) { signal in
                        Text(signal.code).font(.caption2.monospaced())
                        Text(signal.meaning).font(.caption)
                    }
                    Text("Root cause not established · adjudication not performed · no model used.")
                        .font(.caption)
                    Text("Same-user snapshot at \(explanation.asOfLedgerEventCount) ledger events. Not a currentness guarantee, verified occurrence, or permission to act.")
                        .font(.caption2).foregroundStyle(.secondary)
                    Text("explanation sha256:\(explanation.explanationDigest)")
                        .font(.caption2.monospaced()).textSelection(.enabled)
                }
                .accessibilityIdentifier("veritas.incident.explanation")
            }

            if let export = model.preparedIncidentExport {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Redacted incident report prepared")
                        .font(.caption.bold())
                    Text("sha256:\(export.digest)")
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                    Text("Digest-only and non-authorizing. This is not an accepted copy or certificate.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Button("Save New Redacted JSON…") {
                        savePreparedIncidentExport(export)
                    }
                    .disabled(model.fileExportInFlight)
                }
            }

            Divider()

            HStack {
                Button("Choose File…") { chooseFile() }
                    .accessibilityIdentifier(ShellAccessibilityIDV1.chooseFile)
                Button("Analyze") { model.analyzeSelected() }
                    .disabled(model.selectedSnapshot == nil || model.desiredMode == .off)
                    .accessibilityIdentifier(ShellAccessibilityIDV1.analyze)
                    .accessibilityHint(
                        model.selectedSnapshot == nil
                            ? "Choose a file first."
                            : (model.desiredMode == .off ? "Request ASSIST first." : "Runs deterministic checks on the frozen snapshot.")
                    )
            }

            if let snapshot = model.selectedSnapshot {
                Text(snapshot.displayName)
                    .font(.subheadline.weight(.medium))
                Text(model.digestLabel)
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
            } else {
                Text("Select one UTF-8 text, Markdown, or JSON file.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let result = model.result {
                Divider()
                LabeledContent(
                    "Prototype checks",
                    value: "\(result.deterministicPassed ? "PASS" : "FAIL") · \(result.deterministicChecks.count) checks"
                )
                Text("Profile: \(result.profileID)")
                    .font(.caption2.monospaced())
                LabeledContent("Model", value: result.modelParticipation.rawValue)
                LabeledContent("Disposition", value: result.disposition.rawValue)

                if let receipt = result.advisoryReceipt,
                   let receiptDigest = result.advisoryReceiptDigest {
                    LabeledContent(
                        "Advisory receipt",
                        value: "sha256:\(receiptDigest.prefix(16))…"
                    )
                    Text("\(receipt.provider) · \(receipt.modelIdentityStatus)")
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                    Text("The receipt proves observed, validated participation for this snapshot; it grants no authority.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if let coverage = result.advisoryCoverage {
                    LabeledContent(
                        "Advisory coverage",
                        value: coverage.complete
                            ? "complete (\(coverage.analyzedCharacters) characters)"
                            : "partial (\(coverage.analyzedCharacters)/\(coverage.artifactCharacters) characters)"
                    )
                }

                ForEach(result.deterministicChecks) { check in
                    HStack(alignment: .top) {
                        Text(check.status.rawValue)
                            .font(.caption.monospaced().bold())
                            .frame(width: 66, alignment: .leading)
                        Text(check.explanation)
                            .font(.caption)
                    }
                }

                ForEach(result.findings) { finding in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Advisory · \(finding.dimension.rawValue) · \(finding.severity.rawValue)")
                            .font(.caption.bold())
                        Text(finding.summary)
                            .font(.caption)
                    }
                }

                if !result.limitationCodes.isEmpty {
                    DisclosureGroup("Limitations") {
                        ForEach(result.limitationCodes, id: \.self) { code in
                            Text(code)
                                .font(.caption2.monospaced())
                        }
                    }
                }

                HStack {
                    Button("Accept Analyzed Snapshot") { model.acceptExactVersion() }
                        .disabled(!result.canAcceptInsideVeritas)
                        .accessibilityIdentifier(ShellAccessibilityIDV1.accept)
                        .accessibilityHint("Binds only these frozen bytes. Not a certificate.")
                    Button("Clear") { model.clearAcceptance() }
                        .accessibilityIdentifier(ShellAccessibilityIDV1.clear)
                }

                if model.currentness == .current {
                    Button("Export Exact Accepted Copy…") {
                        saveAcceptedCopy()
                    }
                    .disabled(model.fileExportInFlight)
                    .accessibilityIdentifier(ShellAccessibilityIDV1.exportAcceptedCopy)
                    Text("Writes the exact accepted bytes to a new private file. Existing files are never replaced.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            if let receipt = model.lastFileExportReceipt {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Private export verified")
                        .font(.caption.bold())
                    Text("sha256:\(receipt.digest)")
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                    Text("\(receipt.byteCount) bytes · exact readback · no replacement")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()
            Text(ShellTruthV1.scopeStatement)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(ShellTruthV1.indicatorStatement)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(width: 430)
        .sheet(item: $presentedReferenceReview) { review in
            ReferenceRunReviewSheet(review: review,
                confirm: {
                    _ = model.confirmReferenceRunReview(review)
                    if presentedReferenceReview === review { presentedReferenceReview = nil }
                },
                cancel: {
                    model.cancelReferenceRunReview(review)
                    if presentedReferenceReview === review { presentedReferenceReview = nil }
                })
                .onDisappear { model.cancelReferenceRunReview(review) }
        }
    }

    private func chooseFile() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.resolvesAliases = false
        if panel.runModal() == .OK, let url = panel.url {
            model.select(url: url)
        }
    }

    private func savePreparedIncidentExport(_ export: IncidentRedactedExportV1) {
        guard let destination = chooseNewDestination(
            suggestedName: "veritas-incident-\(export.digest.prefix(12)).json"
        ) else { return }
        model.savePreparedIncidentExport(to: destination)
    }

    private func saveAcceptedCopy() {
        let selectedName = model.selectedSnapshot?.displayName ?? "veritas-accepted-copy.txt"
        guard let destination = chooseNewDestination(
            suggestedName: "accepted-\(selectedName)"
        ) else { return }
        model.exportAcceptedCopy(to: destination)
    }

    private func chooseNewDestination(suggestedName: String) -> URL? {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.showsTagField = false
        panel.message = "Choose a new file. Nisi refuses to replace existing files."
        guard panel.runModal() == .OK else { return nil }
        return panel.url
    }
}

/// Rendering is not authenticated consent; the controller checks this exact
/// opaque review again. No default/Return shortcut confirms a model run.
private struct ReferenceRunReviewSheet: View {
    let review: AppModel.ReferenceRunReview
    let confirm: () -> Void
    let cancel: () -> Void
    var body: some View {
        let d = review.descriptor
        VStack(alignment: .leading, spacing: 12) {
            Text("Review one private reference run").font(.headline)
            Text("One local fixed reference-model evaluation. No AFM call, learning, publication or release. Review expires after 60 seconds; an expired confirmation is refused.")
                .font(.caption)
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Input: \(d.artifactKind.rawValue), \(d.inputByteCount) bytes")
                    Text("Input SHA-256: \(d.subjectSHA256)")
                    Text("Profile: \(d.profileID)")
                    Text("Profile SHA-256: \(d.profileSHA256)")
                    Text("Package SHA-256: \(d.packageSHA256)")
                    Text("Build approval receipt SHA-256: \(d.buildReceiptSHA256)")
                    Text("Host epoch: \(d.hostEpoch)")
                    Text("Declared bytes: \(d.declaredBytes) / \(d.byteLimit)")
                    Text("Scalar operations: \(d.scalarOperations) / \(d.operationLimit)")
                    Text("Task slots: \(d.taskSlots) / \(d.taskSlotLimit)")
                }.font(.caption.monospaced()).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("Resource figures are logical declarations, not physical CPU/GPU/RAM reservations. This result cannot certify an artifact or approve another run.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Cancel", role: .cancel, action: cancel).keyboardShortcut(.cancelAction)
                    .accessibilityIdentifier("veritas.reference.review.cancel")
                Spacer()
                Button("Confirm This Run Once", action: confirm)
                    .accessibilityIdentifier("veritas.reference.review.confirm")
            }
        }.padding(20).frame(width: 560, height: 480)
            .accessibilityIdentifier("veritas.reference.review")
    }
}

/// E13 presentation of `ShellTruthV1`. Pure rendering: every string comes from
/// the truth record, so what VoiceOver reads and what tests assert is the
/// same text a sighted participant sees.
private struct ShellTruthBlock: View {
    let truth: ShellTruthV1

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent("Mode", value: truth.mode.label)
            if let explanation = truth.mode.agreement.explanation {
                Text(explanation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            LabeledContent("Routing", value: truth.routing.rawValue)
            LabeledContent("Last decision", value: truth.decision.label)
            LabeledContent("Acceptance", value: truth.acceptance.label)
            LabeledContent("Covered", value: truth.coverage.subject)
            Text("Project: \(truth.coverage.project). Client: \(truth.coverage.client). Outside coverage: \(truth.coverage.outsideCoverage).")
                .font(.caption2)
                .foregroundStyle(.secondary)

            ForEach(Array(truth.refusals.enumerated()), id: \.offset) { index, refusal in
                VStack(alignment: .leading, spacing: 2) {
                    Text("Refusal \(index + 1) · \(refusal.refusalClass.rawValue)")
                        .font(.caption.bold())
                        .foregroundStyle(.red)
                    Text(refusal.exactReason)
                        .font(.caption2.monospaced())
                        .textSelection(.enabled)
                    Text("Preserved: \(refusal.preservedResult)")
                        .font(.caption2)
                    Text("Next: \(refusal.nextSafeAction)")
                        .font(.caption2)
                    if let note = refusal.currency.note {
                        Text(note)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if refusal.artifactVerdictUnaffected {
                        Text("This is not an artifact verdict.")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("\(ShellAccessibilityIDV1.refusal).\(index + 1)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(ShellAccessibilityIDV1.truthBlock)
        .accessibilityLabel("Status truth")
        .accessibilityValue(truth.accessibilitySummary)
    }
}
