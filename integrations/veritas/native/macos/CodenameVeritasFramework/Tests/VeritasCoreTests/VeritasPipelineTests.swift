import Foundation
import Testing
@testable import VeritasCore

private actor StubAnalyzer: AdvisoryOrchestrator {
    struct Configuration: Sendable {
        var probe = AnalyzerProbe(
            state: .ready,
            provider: "test",
            route: "injected-test-double",
            contextSize: 4_096,
            adapterContractVersion: "test-advisory-v1",
            modelIdentityStatus: "TEST_MODEL_IDENTITY",
            runtimeFingerprint: ArtifactSnapshot.digest(Data("test-runtime-v1".utf8))
        )
        var planSubjectOverride: String?
        var proposedDimensionNames = [AdvisoryDimension.completeness.rawValue]
        var planRationale = "Bounded test plan."
        var planNonAuthorizing = true
        var planErrorCode: String?
        var findingSubjectOverride: String?
        var findingDimensionOverride: AdvisoryDimension?
        var findingSummary = "Bounded advisory finding."
        var findingNonAuthorizing = true
        var findingErrorCode: String?
    }

    private let configuration: Configuration
    private var probeCalls = 0
    private var planCalls = 0
    private var analysisCalls = 0

    init(_ configuration: Configuration = Configuration()) {
        self.configuration = configuration
    }

    func probe() async -> AnalyzerProbe {
        probeCalls += 1
        return configuration.probe
    }

    func proposePlan(for request: OrchestrationRequest) async throws -> AdvisoryPlan {
        planCalls += 1
        if let code = configuration.planErrorCode {
            throw AdvisoryOrchestrationError.unavailable(code)
        }
        return AdvisoryPlan(
            subjectDigest: configuration.planSubjectOverride ?? request.subjectDigest,
            proposedDimensionNames: configuration.proposedDimensionNames,
            rationale: configuration.planRationale,
            nonAuthorizing: configuration.planNonAuthorizing
        )
    }

    func analyze(_ request: DimensionAnalysisRequest) async throws -> AdvisoryFinding {
        analysisCalls += 1
        if let code = configuration.findingErrorCode {
            throw AdvisoryOrchestrationError.unavailable(code)
        }
        return AdvisoryFinding(
            id: "test-finding",
            subjectDigest: configuration.findingSubjectOverride ?? request.subjectDigest,
            dimension: configuration.findingDimensionOverride ?? request.dimension,
            severity: .warning,
            summary: configuration.findingSummary,
            nonAuthorizing: configuration.findingNonAuthorizing
        )
    }

    func isQuiescent() async -> Bool {
        true
    }

    func callCounts() -> (probe: Int, plan: Int, analysis: Int) {
        (probeCalls, planCalls, analysisCalls)
    }
}

private func snapshot(
    _ text: String = #"{"name":"veritas"}"#,
    kind: ArtifactKind = .json,
    displayName: String = "artifact.json"
) -> ArtifactSnapshot {
    ArtifactSnapshot(displayName: displayName, kind: kind, bytes: Data(text.utf8))
}

@Suite("Codename Veritas deterministic core")
struct VeritasPipelineTests {
    @Test("Snapshot digest is stable and byte-sensitive")
    func digestBinding() {
        let first = snapshot()
        let same = snapshot()
        let changed = snapshot(#"{"name":"Veritas"}"#)

        #expect(first.subjectDigest == same.subjectDigest)
        #expect(first.subjectDigest != changed.subjectDigest)
        #expect(first.subjectDigest.count == 64)
    }

    @Test("A valid JSON object passes deterministic checks")
    func validJSONGate() {
        let outcomes = DeterministicGateRunner().run(
            snapshot: snapshot(),
            profile: .prototype
        )

        #expect(outcomes.count == 3)
        #expect(outcomes.allSatisfy { $0.status == .pass })
    }

    @Test("Duplicate and ambiguous JSON object keys fail closed before Foundation parsing")
    func strictJSONKeyGate() throws {
        let cases: [(String, String)] = [
            (#"{"same":1,"same":2}"#, "The JSON snapshot contains a duplicate object key."),
            (#"{"same":1,"\u0073ame":2}"#, "The JSON snapshot contains a duplicate object key."),
            (#"{"caf\u00e9":1,"cafe\u0301":2}"#, "The JSON snapshot contains Unicode-equivalent object keys."),
            (#"{"\u0000":1}"#, "The JSON snapshot contains a NUL object key."),
            (#"{"outer":{"same":1,"same":2}}"#, "The JSON snapshot contains a duplicate object key."),
        ]

        for (bytes, expectedExplanation) in cases {
            let outcomes = DeterministicGateRunner().run(
                snapshot: snapshot(bytes),
                profile: .prototype
            )
            #expect(outcomes.count == 3)
            #expect(outcomes[2].id == "DET-003-JSON-STRUCTURE")
            #expect(outcomes[2].status == .fail)
            #expect(outcomes[2].explanation == expectedExplanation)
        }

        let distinct = DeterministicGateRunner().run(
            snapshot: snapshot(#"{"cafe":1,"caf\u00e9":2}"#),
            profile: .prototype
        )
        #expect(distinct.allSatisfy { $0.status == .pass })

        // U11: the production readers use exact top-level identities. Values
        // and nested keys may not impersonate a top-level capability member.
        let shape = try StrictJSONDocumentValidator.inspectTopLevelObject(Data(
            #"{"\u0073tatus":"UNSUPPORTED","nested":{"status":"SUPPORTED","hidden":1},"array":[{"hidden":2}],"null":null,"number":1.5,"boolean":true,"cafe\u0301":"cafe\u0301","\ud83e\uddea":"\ud83e\uddea","escapes":"\"\\\/\b\f\n\r\t\u0000\ufeff"}"#.utf8
        ))
        let expectedKeys = ["status", "nested", "array", "null", "number", "boolean", "cafe\u{301}", "🧪", "escapes"]
        #expect(shape.keys == Set(expectedKeys.map { Data($0.utf8) }))
        #expect(shape.string(for: "status") == "UNSUPPORTED")
        #expect(shape.string(for: "nested") == nil)
        #expect(shape.string(for: "hidden") == nil)
        #expect(shape.string(for: "null") == nil)
        #expect(shape.string(for: "number") == nil)
        #expect(shape.string(for: "boolean") == nil)
        #expect(shape.string(for: "🧪") == "🧪")
        #expect(shape.string(for: "café") == nil)
        #expect(shape.string(for: "cafe\u{301}").map { Data($0.utf8) } == Data("cafe\u{301}".utf8))
        #expect(shape.string(for: "escapes").map { Data($0.utf8) } == Data("\"\\/\u{8}\u{c}\n\r\t\u{0}\u{feff}".utf8))
        #expect(try StrictJSONDocumentValidator.inspectTopLevelObject(Data("{}".utf8)).keys.isEmpty)

        for text in [
            #"{"v":"\ud800"}"#, #"{"v":"\udc00"}"#,
            #"{"v":"\ud800\u0041"}"#, #"{"v":"\ud800x"}"#,
            #"{"v":"\uZZZZ"}"#, #"{"v":"\x00"}"#,
            #"{"v":"\u123"}"#, "{\"v\":\"\n\"}",
            #"{"v":"unterminated}"#, #"{"v":1}false"#,
            #"{"v":1,}"#, #"{"v":[1,]}"#,
            #"{"v":{"x":1,"\u0078":2}}"#,
            #"{"x":1,"x":2}"#, #"{"x":1,"\u0078":2}"#,
            #"{"caf\u00e9":1,"cafe\u0301":2}"#,
            #"{"\u0000":1}"#, "[]", "null", "1", "\"text\"",
            "\u{feff}{}",
        ] {
            #expect(throws: (any Error).self) {
                try StrictJSONDocumentValidator.inspectTopLevelObject(Data(text.utf8))
            }
        }
        let invalidSequences: [[UInt8]] = [[0xc0, 0xaf], [0xed, 0xa0, 0x80], [0xff], [0xe2, 0x82]]
        for invalidUTF8 in invalidSequences {
            let malformed = Data("{\"v\":\"".utf8) + Data(invalidUTF8) + Data("\"}".utf8)
            #expect(throws: (any Error).self) {
                try StrictJSONDocumentValidator.inspectTopLevelObject(malformed)
            }
        }
        // Canonical evidence R3 is a separate open contract. Do not silently
        // prohibit legal fractional/exponent numbers in user artifacts.
        for text in [#"{"n":1.5}"#, #"{"n":1e-7}"#, #"{"n":-0}"#, #"{"n":9007199254740992}"#] {
            #expect(DeterministicGateRunner().run(snapshot: snapshot(text), profile: .prototype)
                .allSatisfy { $0.status == .pass })
        }
    }

    @Test("Direct snapshots are bounded at the production gate before model work")
    func directSnapshotByteLimit() async {
        let prefix = Data("{\"payload\":\"".utf8)
        let suffix = Data("\"}".utf8)
        let fillerCount = ArtifactSnapshotter.prototypeByteLimit - prefix.count - suffix.count
        var admittedBytes = prefix
        admittedBytes.append(Data(repeating: 0x61, count: fillerCount))
        admittedBytes.append(suffix)
        #expect(admittedBytes.count == ArtifactSnapshotter.prototypeByteLimit)

        let admitted = ArtifactSnapshot(
            displayName: "at-limit.json",
            kind: .json,
            bytes: admittedBytes
        )
        #expect(DeterministicGateRunner().run(
            snapshot: admitted,
            profile: .prototype
        ).allSatisfy { $0.status == .pass })

        var refusedBytes = admittedBytes
        refusedBytes.append(0x20)
        let refused = ArtifactSnapshot(
            displayName: "over-limit.json",
            kind: .json,
            bytes: refusedBytes
        )
        let analyzer = StubAnalyzer()
        let result = await VeritasPipeline(analyzer: analyzer).analyze(
            snapshot: refused,
            profile: .prototype,
            mode: .assist
        )
        let counts = await analyzer.callCounts()

        #expect(result.deterministicChecks == [CheckOutcome(
            id: "DET-000-SNAPSHOT-BYTE-LIMIT",
            status: .fail,
            explanation: "The artifact exceeds the deterministic snapshot byte limit."
        )])
        #expect(result.disposition == .needsAttention)
        #expect(result.modelParticipation == .notRun)
        #expect(counts.probe == 0)
        #expect(counts.plan == 0)
        #expect(counts.analysis == 0)
    }

    @Test("Profile resources are bounded before fingerprinting or model work")
    func profileResourceLimits() async {
        let admittedID = String(repeating: "p", count: CheckProfile.maximumIDBytes)
        let admittedSections = Array(
            repeating: String(repeating: "s", count: CheckProfile.maximumRequiredSectionBytes),
            count: CheckProfile.maximumRequiredSectionTotalBytes
                / CheckProfile.maximumRequiredSectionBytes
        )
        let admitted = CheckProfile(id: admittedID, requiredSections: admittedSections)
        #expect(admitted.resourceLimitsAdmitted)
        #expect(admitted.rulesFingerprint.utf8.count == 64)

        let countBoundary = CheckProfile(
            id: "count-boundary",
            requiredSections: Array(
                repeating: "s",
                count: CheckProfile.maximumRequiredSections
            )
        )
        #expect(countBoundary.resourceLimitsAdmitted)

        let refusedProfiles = [
            CheckProfile(
                id: String(repeating: "p", count: CheckProfile.maximumIDBytes + 1)
            ),
            CheckProfile(
                id: "too-many-sections",
                requiredSections: Array(
                    repeating: "s",
                    count: CheckProfile.maximumRequiredSections + 1
                )
            ),
            CheckProfile(
                id: "oversized-section",
                requiredSections: [
                    String(repeating: "s", count: CheckProfile.maximumRequiredSectionBytes + 1),
                ]
            ),
            CheckProfile(
                id: "oversized-total",
                requiredSections: admittedSections + ["x"]
            ),
        ]

        for profile in refusedProfiles {
            let analyzer = StubAnalyzer()
            let result = await VeritasPipeline(analyzer: analyzer).analyze(
                snapshot: snapshot(),
                profile: profile,
                mode: .assist
            )
            let counts = await analyzer.callCounts()
            #expect(!profile.resourceLimitsAdmitted)
            #expect(profile.rulesFingerprint.utf8.count == 64)
            #expect(result.deterministicChecks == [CheckOutcome(
                id: "DET-000-PROFILE-RESOURCE-LIMIT",
                status: .fail,
                explanation: "The check profile exceeds the deterministic resource limits."
            )])
            #expect(result.disposition == .needsAttention)
            #expect(result.modelParticipation == .notRun)
            #expect(counts.probe == 0)
            #expect(counts.plan == 0)
            #expect(counts.analysis == 0)
        }
    }

    @Test("Invalid JSON fails closed and never calls the analyzer")
    func invalidJSONSkipsAnalyzer() async {
        let analyzer = StubAnalyzer()
        let pipeline = VeritasPipeline(analyzer: analyzer)
        let result = await pipeline.analyze(
            snapshot: snapshot("{", kind: .json),
            profile: .prototype,
            mode: .assist
        )
        let counts = await analyzer.callCounts()

        #expect(result.disposition == .needsAttention)
        #expect(result.deterministicPassed == false)
        #expect(result.modelParticipation == .notRun)
        #expect(result.canAcceptInsideVeritas == false)
        #expect(counts.probe == 0)
        #expect(counts.plan == 0)
        #expect(counts.analysis == 0)
    }

    @Test("OFF performs no checks and grants no acceptance")
    func offIsNonAuthorizing() async {
        let analyzer = StubAnalyzer()
        let result = await VeritasPipeline(analyzer: analyzer).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .off
        )
        let counts = await analyzer.callCounts()

        #expect(result.disposition == .off)
        #expect(result.deterministicChecks.isEmpty)
        #expect(result.canAcceptInsideVeritas == false)
        #expect(counts.probe == 0)
    }

    @Test("Optional analyzer loss degrades without discarding deterministic evidence")
    func optionalAnalyzerFallback() async {
        var configuration = StubAnalyzer.Configuration()
        configuration.probe = AnalyzerProbe(
            state: .degraded,
            provider: "test",
            route: "unavailable",
            reasonCode: "TEST_MODEL_UNAVAILABLE"
        )
        let result = await VeritasPipeline(analyzer: StubAnalyzer(configuration)).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        #expect(result.disposition == .degraded)
        #expect(result.deterministicPassed)
        #expect(result.modelParticipation == .unavailable)
        #expect(result.canAcceptInsideVeritas)
        #expect(result.limitationCodes.contains("TEST_MODEL_UNAVAILABLE"))
        #expect(result.limitationCodes.contains("MODEL_FINDINGS_NON_AUTHORIZING") == false)
    }

    @Test("Required analyzer loss blocks acceptance")
    func requiredAnalyzerFallback() async {
        var configuration = StubAnalyzer.Configuration()
        configuration.probe = AnalyzerProbe(
            state: .degraded,
            provider: "test",
            route: "unavailable",
            reasonCode: "TEST_MODEL_UNAVAILABLE"
        )
        let profile = CheckProfile(
            id: "required-model-test",
            modelParticipationRequired: true
        )
        let result = await VeritasPipeline(analyzer: StubAnalyzer(configuration)).analyze(
            snapshot: snapshot(),
            profile: profile,
            mode: .assist
        )

        #expect(result.disposition == .blocked)
        #expect(result.deterministicPassed)
        #expect(result.canAcceptInsideVeritas == false)
        #expect(result.limitationCodes.contains("REQUIRED_MODEL_EVIDENCE_MISSING"))
    }

    @Test("Unicode numeric analyzer fingerprints are blocked before model work")
    func unicodeRuntimeFingerprintIsRefused() async {
        for glyph in ["١", "１"] {
            var configuration = StubAnalyzer.Configuration()
            configuration.probe = AnalyzerProbe(
                state: .ready,
                provider: "test",
                route: "invalid-runtime-fingerprint",
                contextSize: 4_096,
                adapterContractVersion: "test-advisory-v1",
                modelIdentityStatus: "TEST_MODEL_IDENTITY",
                runtimeFingerprint: String(repeating: glyph, count: 64)
            )
            let analyzer = StubAnalyzer(configuration)
            let artifact = snapshot()
            let result = await VeritasPipeline(analyzer: analyzer).analyze(
                snapshot: artifact,
                profile: .prototype,
                mode: .assist
            )
            let counts = await analyzer.callCounts()

            #expect(result.disposition == .blocked)
            #expect(result.deterministicPassed)
            #expect(result.modelParticipation == .failed)
            #expect(result.advisoryReceipt == nil)
            #expect(result.advisoryPlan.isEmpty)
            #expect(result.findings.isEmpty)
            #expect(!result.canAcceptInsideVeritas)
            #expect(result.limitationCodes.contains("ANALYZER_RUNTIME_FINGERPRINT_INVALID"))
            #expect(counts.probe == 1)
            #expect(counts.plan == 0)
            #expect(counts.analysis == 0)

            let ledger = PrototypeAcceptanceLedger()
            do {
                _ = try await ledger.accept(
                    snapshot: artifact,
                    profile: .prototype,
                    mode: .assist,
                    mutationSequence: 1,
                    result: result
                )
                Issue.record("Invalid model provenance must not reach acceptance.")
            } catch {
                #expect(await ledger.currentness(
                    snapshot: artifact,
                    profile: .prototype,
                    mode: .assist,
                    result: result
                ) == .none)
            }
        }
    }

    @Test("ENFORCE is visibly blocked until an enforcement boundary exists")
    func enforceIsNotAVisualAlias() async {
        let analyzer = StubAnalyzer()
        let result = await VeritasPipeline(analyzer: analyzer).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .enforce
        )
        let counts = await analyzer.callCounts()

        #expect(result.disposition == .blocked)
        #expect(result.canAcceptInsideVeritas == false)
        #expect(result.limitationCodes.contains("ENFORCE_ROUTE_NOT_IMPLEMENTED"))
        #expect(counts.probe == 0)
    }

    @Test("A validated advisory plan participates but remains non-authorizing")
    func validatedAdvisoryPlan() async {
        var configuration = StubAnalyzer.Configuration()
        configuration.proposedDimensionNames = [
            AdvisoryDimension.completeness.rawValue,
            AdvisoryDimension.risk.rawValue,
        ]
        let result = await VeritasPipeline(analyzer: StubAnalyzer(configuration)).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        #expect(result.disposition == .ready)
        #expect(result.modelParticipation == .participated)
        #expect(result.advisoryPlan == [.completeness, .risk])
        #expect(result.findings.count == 2)
        #expect(result.findings.allSatisfy { $0.nonAuthorizing })
        #expect(result.limitationCodes.contains("MODEL_FINDINGS_NON_AUTHORIZING"))
        #expect(result.advisoryReceipt?.outcome == .completed)
        #expect(result.advisoryReceipt?.nonAuthorizing == true)
        #expect(result.advisoryReceipt?.adapterContractVersion == "test-advisory-v1")
        #expect(result.advisoryReceipt?.modelIdentityStatus == "TEST_MODEL_IDENTITY")
        #expect(result.advisoryReceipt?.stages.map(\.stage) == [
            .probe, .plan, .finding, .finding,
        ])
        #expect(result.advisoryReceipt?.stages.map(\.ordinal) == [0, 1, 2, 3])
        #expect(result.advisoryReceipt?.stages.allSatisfy { $0.outcome == .observed } == true)
        #expect(result.advisoryReceiptDigest?.count == 64)
    }

    @Test("A complete receipt is deterministic and runtime changes stale acceptance")
    func advisoryReceiptCurrentness() async throws {
        let artifact = snapshot()
        let profile = CheckProfile.prototype
        let firstPipeline = VeritasPipeline(analyzer: StubAnalyzer())
        let first = await firstPipeline.analyze(
            snapshot: artifact,
            profile: profile,
            mode: .assist
        )
        let repeated = await VeritasPipeline(analyzer: StubAnalyzer()).analyze(
            snapshot: artifact,
            profile: profile,
            mode: .assist
        )

        var changedConfiguration = StubAnalyzer.Configuration()
        changedConfiguration.probe = AnalyzerProbe(
            state: .ready,
            provider: "test",
            route: "injected-test-double",
            contextSize: 4_096,
            adapterContractVersion: "test-advisory-v1",
            modelIdentityStatus: "TEST_MODEL_IDENTITY",
            runtimeFingerprint: ArtifactSnapshot.digest(Data("test-runtime-v2".utf8))
        )
        let changed = await VeritasPipeline(
            analyzer: StubAnalyzer(changedConfiguration)
        ).analyze(
            snapshot: artifact,
            profile: profile,
            mode: .assist
        )

        #expect(first.advisoryReceiptDigest == repeated.advisoryReceiptDigest)
        #expect(first.advisoryReceiptDigest != changed.advisoryReceiptDigest)
        let ledger = PrototypeAcceptanceLedger()
        _ = try await ledger.accept(
            snapshot: artifact,
            profile: profile,
            mode: .assist,
            mutationSequence: 1,
            result: first
        )
        #expect(await ledger.currentness(
            snapshot: artifact,
            profile: profile,
            mode: .assist,
            result: changed
        ) == .stale)
    }

    @Test("Claimed model participation without a complete receipt is unacceptably forged")
    func missingAdvisoryReceiptIsRefused() async {
        let artifact = snapshot()
        let profile = CheckProfile.prototype
        let forged = PipelineResult(
            subjectDigest: artifact.subjectDigest,
            artifactKind: artifact.kind,
            profileID: profile.id,
            profileFingerprint: profile.rulesFingerprint,
            mode: .assist,
            disposition: .ready,
            deterministicChecks: DeterministicGateRunner().run(
                snapshot: artifact,
                profile: profile
            ),
            deterministicPassed: true,
            modelParticipation: .participated,
            analyzerProbe: AnalyzerProbe(
                state: .ready,
                provider: "forged",
                route: "forged"
            ),
            advisoryReceipt: nil,
            advisoryCoverage: AdvisoryCoverage(
                artifactCharacters: artifact.text?.count ?? 0,
                analyzedCharacters: artifact.text?.count ?? 0
            ),
            advisoryPlan: [.completeness],
            findings: [],
            canAcceptInsideVeritas: true,
            limitationCodes: []
        )
        let ledger = PrototypeAcceptanceLedger()
        var refused = false

        do {
            _ = try await ledger.accept(
                snapshot: artifact,
                profile: profile,
                mode: .assist,
                mutationSequence: 1,
                result: forged
            )
        } catch {
            refused = true
        }

        #expect(forged.resultEvidenceDigest == nil)
        #expect(refused)
    }

    @Test(
        "Malformed or authority-seeking plans degrade",
        arguments: [
            (["unknown"], true, "PLAN_UNKNOWN_DIMENSION"),
            (["risk", "risk"], true, "PLAN_DUPLICATE_DIMENSION"),
            (["risk"], false, "PLAN_ATTEMPTED_AUTHORITY"),
            (["risk", "style", "completeness", "factual_support"], true, "PLAN_DIMENSION_LIMIT"),
        ]
    )
    func invalidPlans(
        names: [String],
        nonAuthorizing: Bool,
        expectedCode: String
    ) async {
        var configuration = StubAnalyzer.Configuration()
        configuration.proposedDimensionNames = names
        configuration.planNonAuthorizing = nonAuthorizing
        let result = await VeritasPipeline(analyzer: StubAnalyzer(configuration)).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        #expect(result.disposition == .degraded)
        #expect(result.modelParticipation == .failed)
        #expect(result.findings.isEmpty)
        #expect(result.limitationCodes.contains(expectedCode))
    }

    @Test("A mismatched finding is discarded and degrades the route")
    func mismatchedFinding() async {
        var configuration = StubAnalyzer.Configuration()
        configuration.findingSubjectOverride = String(repeating: "0", count: 64)
        let result = await VeritasPipeline(analyzer: StubAnalyzer(configuration)).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        #expect(result.disposition == .degraded)
        #expect(result.findings.isEmpty)
        #expect(result.limitationCodes.contains("FINDING_SUBJECT_MISMATCH"))
    }

    @Test("Whitespace-only advisory rationale and findings fail at the core boundary")
    func whitespaceOnlyAdvisoryEvidence() async {
        var emptyRationale = StubAnalyzer.Configuration()
        emptyRationale.planRationale = "  \n\t "
        let rationaleResult = await VeritasPipeline(
            analyzer: StubAnalyzer(emptyRationale)
        ).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        var emptyFinding = StubAnalyzer.Configuration()
        emptyFinding.findingSummary = "  \n\t "
        let findingResult = await VeritasPipeline(
            analyzer: StubAnalyzer(emptyFinding)
        ).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        #expect(rationaleResult.disposition == .degraded)
        #expect(rationaleResult.limitationCodes.contains("PLAN_RATIONALE_INVALID"))
        #expect(findingResult.disposition == .degraded)
        #expect(findingResult.findings.isEmpty)
        #expect(findingResult.limitationCodes.contains("FINDING_SUMMARY_INVALID"))
    }

    @Test("Whitespace padding cannot bypass advisory evidence bounds")
    func paddedAdvisoryEvidenceIsBounded() async {
        var paddedRationale = StubAnalyzer.Configuration()
        paddedRationale.planRationale = String(repeating: " ", count: 512) + "x"
        let rationaleResult = await VeritasPipeline(
            analyzer: StubAnalyzer(paddedRationale)
        ).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        var paddedFinding = StubAnalyzer.Configuration()
        paddedFinding.findingSummary = String(repeating: " ", count: 512) + "x"
        let findingResult = await VeritasPipeline(
            analyzer: StubAnalyzer(paddedFinding)
        ).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        #expect(rationaleResult.disposition == .degraded)
        #expect(rationaleResult.limitationCodes.contains("PLAN_RATIONALE_INVALID"))
        #expect(findingResult.disposition == .degraded)
        #expect(findingResult.findings.isEmpty)
        #expect(findingResult.limitationCodes.contains("FINDING_SUMMARY_INVALID"))
    }

    @Test("Accepted advisory findings store canonical bounded text")
    func advisoryFindingTextIsNormalized() async {
        var configuration = StubAnalyzer.Configuration()
        configuration.findingSummary = "  Bounded advisory finding.  \n"
        let result = await VeritasPipeline(
            analyzer: StubAnalyzer(configuration)
        ).analyze(
            snapshot: snapshot(),
            profile: .prototype,
            mode: .assist
        )

        #expect(result.disposition == .ready)
        #expect(result.findings.first?.summary == "Bounded advisory finding.")
    }

    @Test("A required analyzer cannot satisfy the gate with an empty plan")
    func requiredAnalyzerEmptyPlan() async {
        var configuration = StubAnalyzer.Configuration()
        configuration.proposedDimensionNames = []
        let profile = CheckProfile(
            id: "required-model-empty-plan",
            modelParticipationRequired: true
        )
        let result = await VeritasPipeline(analyzer: StubAnalyzer(configuration)).analyze(
            snapshot: snapshot(),
            profile: profile,
            mode: .assist
        )

        #expect(result.disposition == .blocked)
        #expect(result.canAcceptInsideVeritas == false)
        #expect(result.limitationCodes.contains("PLAN_REQUIRED_DIMENSION_MISSING"))
    }

    @Test("Partial advisory coverage is explicit and cannot satisfy a required-model profile")
    func partialCoverage() async {
        let longText = String(repeating: "a", count: 8_001)
        let optional = await VeritasPipeline(analyzer: StubAnalyzer()).analyze(
            snapshot: snapshot(longText, kind: .text, displayName: "long.txt"),
            profile: .prototype,
            mode: .assist
        )
        let requiredProfile = CheckProfile(
            id: "required-full-coverage",
            modelParticipationRequired: true
        )
        let required = await VeritasPipeline(analyzer: StubAnalyzer()).analyze(
            snapshot: snapshot(longText, kind: .text, displayName: "long.txt"),
            profile: requiredProfile,
            mode: .assist
        )

        #expect(optional.disposition == .degraded)
        #expect(optional.canAcceptInsideVeritas)
        #expect(optional.advisoryCoverage?.complete == false)
        #expect(optional.limitationCodes.contains("PARTIAL_ADVISORY_COVERAGE"))
        #expect(required.disposition == .blocked)
        #expect(required.canAcceptInsideVeritas == false)
        #expect(required.limitationCodes.contains("REQUIRED_MODEL_COVERAGE_INCOMPLETE"))
    }

    @Test("Markdown requirements must be headings, not incidental prose")
    func markdownHeadingChecks() {
        let profile = CheckProfile(id: "markdown-headings", requiredSections: ["Testing"])
        let proseOnly = DeterministicGateRunner().run(
            snapshot: snapshot("There is no Testing section.", kind: .markdown, displayName: "doc.md"),
            profile: profile
        )
        let heading = DeterministicGateRunner().run(
            snapshot: snapshot("# Testing\nEvidence.", kind: .markdown, displayName: "doc.md"),
            profile: profile
        )

        #expect(proseOnly.last?.status == .fail)
        #expect(heading.last?.status == .pass)
    }

    @Test("Acceptance is bound to the exact bytes and profile")
    func exactVersionCurrentness() async throws {
        let artifact = snapshot()
        let profile = CheckProfile.prototype
        let result = await VeritasPipeline(analyzer: StubAnalyzer()).analyze(
            snapshot: artifact,
            profile: profile,
            mode: .assist
        )
        let ledger = PrototypeAcceptanceLedger()

        _ = try await ledger.accept(
            snapshot: artifact,
            profile: profile,
            mode: .assist,
            mutationSequence: 1,
            result: result
        )
        #expect(await ledger.currentness(
            snapshot: artifact,
            profile: profile,
            mode: .assist,
            result: result
        ) == .current)
        #expect(await ledger.currentness(
            snapshot: snapshot(#"{"name":"changed"}"#),
            profile: profile,
            mode: .assist,
            result: result
        ) == .stale)
        #expect(await ledger.currentness(
            snapshot: artifact,
            profile: CheckProfile(id: "changed-profile"),
            mode: .assist,
            result: result
        ) == .stale)
        #expect(await ledger.currentness(
            snapshot: artifact,
            profile: CheckProfile(id: profile.id, requiredSections: ["Changed rule"]),
            mode: .assist,
            result: result
        ) == .stale)
    }

    @Test("The ledger independently refuses empty evidence without consuming acceptance state")
    func forgedAcceptanceIsRefused() async throws {
        let artifact = snapshot()
        let profile = CheckProfile.prototype
        let genuine = await VeritasPipeline(analyzer: StubAnalyzer()).analyze(
            snapshot: artifact,
            profile: profile,
            mode: .assist
        )
        try #require(genuine.deterministicPassed)
        try #require(!genuine.deterministicChecks.isEmpty)
        try #require(genuine.deterministicChecks.allSatisfy { $0.status == .pass })
        try #require(genuine.canAcceptInsideVeritas)
        let ledger = PrototypeAcceptanceLedger()
        let initial = try await ledger.accept(
            snapshot: artifact,
            profile: profile,
            mode: .assist,
            mutationSequence: 1,
            result: genuine
        )

        // Retain the old contradictory-flag case, then isolate empty evidence:
        // every other acceptance field is favorable, including the digest.
        // Removing the explicit nonempty guard must fail the second case.
        for claimedPass in [false, true] {
            let forged = PipelineResult(
                subjectDigest: artifact.subjectDigest,
                artifactKind: artifact.kind,
                profileID: profile.id,
                profileFingerprint: profile.rulesFingerprint,
                mode: .assist,
                disposition: .ready,
                deterministicChecks: [],
                deterministicPassed: claimedPass,
                modelParticipation: .notRun,
                analyzerProbe: nil,
                advisoryCoverage: nil,
                advisoryPlan: [],
                findings: [],
                canAcceptInsideVeritas: true,
                limitationCodes: []
            )
            try #require(forged.resultEvidenceDigest != nil)
            try #require(forged.resultEvidenceDigest != genuine.resultEvidenceDigest)
            var refusal: AdvisoryOrchestrationError?
            do {
                _ = try await ledger.accept(
                    snapshot: artifact,
                    profile: profile,
                    mode: .assist,
                    mutationSequence: 2,
                    result: forged
                )
            } catch let error as AdvisoryOrchestrationError {
                refusal = error
            }
            #expect(refusal == .invalidFinding("ACCEPT_DETERMINISTIC_EVIDENCE_INVALID"))
            #expect(await ledger.currentness(
                snapshot: artifact, profile: profile, mode: .assist, result: genuine
            ) == .current)
        }

        // A refused attempt must not advance the mutation sequence or replace
        // the accepted version. The same next sequence still accepts real evidence.
        let refreshed = try await ledger.accept(
            snapshot: artifact,
            profile: profile,
            mode: .assist,
            mutationSequence: 2,
            result: genuine
        )
        #expect(refreshed == initial)
        #expect(await ledger.currentness(
            snapshot: artifact, profile: profile, mode: .assist, result: genuine
        ) == .current)
    }

    @Test("Acceptance cannot cross artifact interpretation kinds")
    func artifactKindSubstitutionIsRefused() async throws {
        let jsonArtifact = snapshot()
        let textArtifact = ArtifactSnapshot(
            displayName: "artifact.txt",
            kind: .text,
            bytes: jsonArtifact.bytes
        )
        let profile = CheckProfile.prototype
        let result = await VeritasPipeline(analyzer: StubAnalyzer()).analyze(
            snapshot: jsonArtifact,
            profile: profile,
            mode: .assist
        )
        let ledger = PrototypeAcceptanceLedger()
        var refused = false

        do {
            _ = try await ledger.accept(
                snapshot: textArtifact,
                profile: profile,
                mode: .assist,
                mutationSequence: 1,
                result: result
            )
        } catch {
            refused = true
        }

        #expect(refused)
    }

    @Test("Profile fingerprints cannot collide through list delimiters")
    func profileFingerprintListFraming() {
        let split = CheckProfile(id: "same", requiredSections: ["a", "b"])
        let embeddedDelimiter = CheckProfile(id: "same", requiredSections: ["a\u{1F}b"])

        #expect(split.rulesFingerprint != embeddedDelimiter.rulesFingerprint)
    }

    @Test("Acceptance mutations are ordered and stale work cannot undo clear")
    func acceptanceMutationOrdering() async throws {
        let artifact = snapshot()
        let profile = CheckProfile.prototype
        let result = await VeritasPipeline(analyzer: StubAnalyzer()).analyze(
            snapshot: artifact,
            profile: profile,
            mode: .assist
        )
        let ledger = PrototypeAcceptanceLedger()

        _ = try await ledger.accept(
            snapshot: artifact,
            profile: profile,
            mode: .assist,
            mutationSequence: 1,
            result: result
        )
        #expect(await ledger.clear(mutationSequence: 2))

        var staleAcceptRefused = false
        do {
            _ = try await ledger.accept(
                snapshot: artifact,
                profile: profile,
                mode: .assist,
                mutationSequence: 1,
                result: result
            )
        } catch {
            staleAcceptRefused = true
        }

        #expect(staleAcceptRefused)
        #expect(await ledger.currentness(
            snapshot: artifact,
            profile: profile,
            mode: .assist,
            result: result
        ) == .none)
    }
}
