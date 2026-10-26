import Foundation

/// Declarations supplied by the host, not authenticated tenant or owner identity.
public struct HistoricalGateScopeV1: Equatable, Sendable {
    public let projectDigest: String
    public let ownerDigest: String
    public init(projectDigest: String, ownerDigest: String) {
        self.projectDigest = projectDigest; self.ownerDigest = ownerDigest
    }
}

public enum HistoricalGateImportRefusalV1: String, Error, Equatable, Sendable {
    case invalidDeclaration, scopeMismatch, sourceMismatch, sourceLimit, rowCount, malformedRow, relationshipLimit
}
public enum HistoricalGateRecordKindV1: String, Encodable, Sendable {
    case ruleFinding, taskDisposition, assertedAdjudication
}
public enum HistoricalGateRelationKindV1: String, Encodable, Sendable {
    case canonicalDuplicate, sourceEventConflict, repeatedFindingLabels, assertedAdjudicationReference
}

public struct HistoricalGateObservationV1: Encodable, Equatable, Sendable {
    public let rowOrdinal: Int
    public let observationID: String
    public let rawRowDigest: String
    public let canonicalRowDigest: String
    public let kind: HistoricalGateRecordKindV1
    public let sourceQualityCodes: [String]
    public let status = "CANDIDATE"
    public let authorizing = false
    fileprivate init(ordinal: Int, provenance: String, raw: String, canonical: String, kind: HistoricalGateRecordKindV1, quality: [String]) {
        rowOrdinal = ordinal; rawRowDigest = raw; canonicalRowDigest = canonical; self.kind = kind
        sourceQualityCodes = quality
        observationID = VeritasDigestFrameV1.digest(domain: "veritas-historical-gate-observation-v1",
            fields: [provenance, String(ordinal), raw, canonical, kind.rawValue, "CANDIDATE", String(quality.count)] + quality)
    }
}
public struct HistoricalGateRelationV1: Encodable, Equatable, Sendable {
    // Duplicate/conflict/repeat: later row -> earlier row. Asserted reference:
    // adjudication -> finding, regardless of row order. Multiple kinds per pair
    // are retained and separately charged. No edge implies temporal causality.
    public let fromOrdinal: Int
    public let toOrdinal: Int
    public let kind: HistoricalGateRelationKindV1
    fileprivate init(_ from: Int, _ to: Int, _ kind: HistoricalGateRelationKindV1) {
        fromOrdinal = from; toOrdinal = to; self.kind = kind
    }
}
public struct HistoricalGateBatchV1: Encodable, Equatable, Sendable {
    public let schemaVersion = 1
    public let profile = "veritas-private-historical-gate-staging-v1"
    public let status = "CANDIDATE_OBSERVATIONS_STAGED_IN_MEMORY"
    public let projectDigest: String
    public let ownerDigest: String
    public let batchIDDigest: String
    public let sourceDigest: String
    public let parserVersion = "legacy-mac-gate-three-shapes-v1"
    public let canonicalizerVersion = MAC1JSONV1.profile
    public let relationshipRule = "LATER_TO_EARLIER_EXCEPT_ASSERTED_ADJUDICATION_TO_FINDING_V1"
    public let provenanceDigest: String
    public let observations: [HistoricalGateObservationV1]
    public let relationships: [HistoricalGateRelationV1]
    public let batchDigest: String
    public let confirmedIncidentCount = 0
    public let authorizing = false
    public let durableImportPerformed = false
    public let historicalFactsVerified = false
    public let limitationCodes = ["DECLARED_SCOPE_AND_PIN_NOT_AUTHENTICATED_ORIGIN", "CANDIDATES_NOT_CONFIRMED_FAILURES",
        "SHORT_HASH_LABELS_NOT_ARTIFACT_IDENTITIES", "RELATIONS_NOT_INDEPENDENCE_OR_CAUSALITY",
        "ASSERTED_ADJUDICATION_NOT_AUTHORIZED_ADJUDICATION", "IN_MEMORY_ONE_SOURCE_SESSION_NOT_DURABLE_IMPORT",
        "NO_CROSS_SNAPSHOT_DEDUPLICATION", "NO_SEMANTIC_CONTRADICTION_RESOLUTION", "NO_RAW_IDENTIFIERS_IN_OUTPUT",
        "DIGEST_ONLY_NOT_ANONYMITY", "NO_MODEL_POLICY_PROMOTION_OR_CERTIFICATION_EFFECT"]

    fileprivate init(scope: HistoricalGateScopeV1, batchID: String, source: String, provenance: String,
                     observations: [HistoricalGateObservationV1], relationships: [HistoricalGateRelationV1]) {
        projectDigest = scope.projectDigest; ownerDigest = scope.ownerDigest
        batchIDDigest = ArtifactSnapshot.digest(Data(batchID.utf8)); sourceDigest = source
        provenanceDigest = provenance; self.observations = observations; self.relationships = relationships
        batchDigest = VeritasDigestFrameV1.digest(domain: "veritas-historical-gate-batch-v1",
            fields: [provenance, "LATER_TO_EARLIER_EXCEPT_ASSERTED_ADJUDICATION_TO_FINDING_V1", String(observations.count)] + observations.map(\.observationID)
                + [String(relationships.count)] + relationships.flatMap { [String($0.fromOrdinal), String($0.toOrdinal), $0.kind.rawValue] })
    }
}
public struct HistoricalGateImportReceiptV1: Encodable, Sendable {
    public let replayed: Bool
    public let addedObservationCount: Int
    public let batch: HistoricalGateBatchV1
    fileprivate init(replayed: Bool, batch: HistoricalGateBatchV1) {
        self.replayed = replayed; self.batch = batch; addedObservationCount = replayed ? 0 : batch.observations.count
    }
}

/// No filesystem, network, ledger writes, model calls or external authority.
/// A session owns one exact bounded snapshot. Parse all rows and links before
/// committing state; actor isolation prevents concurrent duplicate materialization.
public actor HistoricalGateImportSessionV1 {
    public static let maximumBytes = 1_048_576
    public static let maximumRows = 512
    public static let maximumRowBytes = 8_192
    public static let maximumRelationships = 2_048
    private let scope: HistoricalGateScopeV1
    private let batchID: String
    private let source: String
    private let rows: Int
    private var staged: HistoricalGateBatchV1?

    public init(scope: HistoricalGateScopeV1, batchID: String, sourceSHA256: String, expectedRows: Int) throws {
        guard Self.hex(scope.projectDigest, count: 64), Self.hex(scope.ownerDigest, count: 64),
              Self.hex(sourceSHA256, count: 64), Self.label(batchID), (1...Self.maximumRows).contains(expectedRows)
        else { throw HistoricalGateImportRefusalV1.invalidDeclaration }
        self.scope = scope; self.batchID = batchID; source = sourceSHA256; rows = expectedRows
    }

    public func importSnapshot(_ bytes: Data, scope: HistoricalGateScopeV1, batchID: String) throws -> HistoricalGateImportReceiptV1 {
        try Task.checkCancellation()
        guard scope == self.scope, batchID == self.batchID else { throw HistoricalGateImportRefusalV1.scopeMismatch }
        guard !bytes.isEmpty, bytes.count <= Self.maximumBytes else { throw HistoricalGateImportRefusalV1.sourceLimit }
        guard ArtifactSnapshot.digest(bytes) == source else { throw HistoricalGateImportRefusalV1.sourceMismatch }
#if DEBUG
        afterSourceValidationForTesting?()
#endif
        try Task.checkCancellation()
        if let staged { return .init(replayed: true, batch: staged) }
        // LF framing is exact: CRLF is allowed as row whitespace, but blank rows,
        // a BOM and invalid UTF-8 are not silently dropped or repaired.
        var lines = bytes.split(separator: 10, omittingEmptySubsequences: false)
        if bytes.last == 10 { lines.removeLast() }
        guard lines.count == rows else { throw HistoricalGateImportRefusalV1.rowCount }
        let provenance = VeritasDigestFrameV1.digest(domain: "veritas-historical-gate-provenance-v1",
            fields: [scope.projectDigest, scope.ownerDigest, batchID, source, String(rows),
                     "legacy-mac-gate-three-shapes-v1", MAC1JSONV1.profile, "ONE_BASED_LF_ROWS_EXCLUDE_LF_V1"])
        var parsed: [Parsed] = [], observations: [HistoricalGateObservationV1] = []
        for (index, line) in lines.enumerated() {
            try Task.checkCancellation()
            let row = try Self.parse(Data(line))
            parsed.append(row)
            observations.append(.init(ordinal: index + 1, provenance: provenance,
                raw: ArtifactSnapshot.digest(Data(line)), canonical: row.canonicalDigest, kind: row.kind, quality: row.quality))
        }
        var links: [HistoricalGateRelationV1] = []
        func link(_ from: Int, _ to: Int, _ kind: HistoricalGateRelationKindV1) throws {
            guard links.count < Self.maximumRelationships else { throw HistoricalGateImportRefusalV1.relationshipLimit }
            links.append(.init(from + 1, to + 1, kind))
        }
        for i in parsed.indices {
            try Task.checkCancellation()
            for j in 0..<i {
                let a = parsed[i], b = parsed[j]
                if a.canonicalDigest == b.canonicalDigest { try link(i, j, .canonicalDuplicate) }
                if a.wire.event_id == b.wire.event_id && a.canonicalDigest != b.canonicalDigest {
                    try link(i, j, .sourceEventConflict)
                }
                if a.kind == .ruleFinding, b.kind == .ruleFinding,
                   a.wire.rule_id == b.wire.rule_id, a.wire.candidate_sha256 == b.wire.candidate_sha256,
                   a.wire.match_hash == b.wire.match_hash { try link(i, j, .repeatedFindingLabels) }
                if a.wire.run_id == b.wire.run_id, a.wire.rule_id == b.wire.rule_id {
                    if a.kind == .assertedAdjudication && b.kind == .ruleFinding { try link(i, j, .assertedAdjudicationReference) }
                    if b.kind == .assertedAdjudication && a.kind == .ruleFinding { try link(j, i, .assertedAdjudicationReference) }
                }
            }
        }
        let batch = HistoricalGateBatchV1(scope: scope, batchID: batchID, source: source,
            provenance: provenance, observations: observations, relationships: links)
        try Task.checkCancellation()
        staged = batch // The only state change. Failures never leave partial candidates.
        return .init(replayed: false, batch: batch)
    }

#if DEBUG
    var stagedObservationCountForTesting: Int { staged?.observations.count ?? 0 }
    private var afterSourceValidationForTesting: (@Sendable () -> Void)?
    func setAfterSourceValidationForTesting(_ body: (@Sendable () -> Void)?) { afterSourceValidationForTesting = body }
#endif

    private struct Wire: Decodable {
        let event_id: String, ts: String, host: String, run_id: String, attempt: String, outcome: String
        let kind: String?
        let candidate_sha256: String?, ruleset_hash: String?, ast_grep_version: String?, rule_id: String?, severity: String?, match_hash: String?, language: String?
        let terminal_reason: String?, gate_status: String?, gate_rules: [String]?, model_verify_status: String?
        let findings_truncated: Bool?, verified: Bool?
    }
    private struct Parsed { let wire: Wire; let kind: HistoricalGateRecordKindV1; let canonicalDigest: String; let quality: [String] }
    private static func parse(_ bytes: Data) throws -> Parsed {
        guard !bytes.isEmpty, bytes.count <= maximumRowBytes else { throw HistoricalGateImportRefusalV1.malformedRow }
        do {
            let canonical = try MAC1JSONV1.canonicalize(bytes)
            let shape = try StrictJSONDocumentValidator.inspectTopLevelObject(bytes)
            let common = ["event_id", "ts", "host", "run_id", "attempt", "outcome"]
            let kind: HistoricalGateRecordKindV1, fields: [String]
            switch shape.string(for: "kind") {
            case nil:
                kind = .ruleFinding
                fields = common + ["candidate_sha256", "ruleset_hash", "ast_grep_version", "rule_id", "severity", "match_hash", "language"]
            case "task_disposition":
                kind = .taskDisposition
                fields = common + ["kind", "terminal_reason", "gate_status", "gate_rules", "ruleset_hash", "model_verify_status", "findings_truncated", "verified"]
            case "adjudication":
                kind = .assertedAdjudication; fields = common + ["kind", "rule_id"]
            default: throw HistoricalGateImportRefusalV1.malformedRow
            }
            guard shape.keys == Set(fields.map { Data($0.utf8) }) else { throw HistoricalGateImportRefusalV1.malformedRow }
            let wire = try JSONDecoder().decode(Wire.self, from: bytes)
            guard hex(wire.event_id, count: 16), wire.host == "mac", label(wire.run_id), label(wire.attempt),
                  validTimestamp(wire.ts), ["unadjudicated", "task_policy_conflict"].contains(wire.outcome)
            else { throw HistoricalGateImportRefusalV1.malformedRow }
            switch kind {
            case .ruleFinding:
                guard let candidate = wire.candidate_sha256, hex(candidate, count: 16),
                      let rules = wire.ruleset_hash, hex(rules, count: 16), let match = wire.match_hash, hex(match, count: 16),
                      let rule = wire.rule_id, label(rule), let version = wire.ast_grep_version,
                      !version.isEmpty, version.utf8.count <= 64, version.utf8.allSatisfy({ (32...126).contains($0) }),
                      ["error", "warning"].contains(wire.severity), wire.language == "python"
                else { throw HistoricalGateImportRefusalV1.malformedRow }
            case .taskDisposition:
                // Historical task-final records explicitly allow a null ruleset
                // label. Preserve that evidence gap; never fabricate an identity.
                guard wire.attempt == "task-final", wire.ruleset_hash.map({ hex($0, count: 16) }) ?? true,
                      let reason = wire.terminal_reason, label(reason), ["PASS", "FAIL", "NOT_RUN"].contains(wire.gate_status),
                      ["PASS", "FAIL", "not-run", "UNAVAILABLE"].contains(wire.model_verify_status),
                      let labels = wire.gate_rules, labels.count <= 32, Set(labels).count == labels.count,
                      labels.allSatisfy(label), wire.findings_truncated != nil, wire.verified != nil
                else { throw HistoricalGateImportRefusalV1.malformedRow }
            case .assertedAdjudication:
                guard wire.attempt == "adjudication", let rule = wire.rule_id, label(rule)
                else { throw HistoricalGateImportRefusalV1.malformedRow }
            }
            var quality: [String] = []
            if kind == .ruleFinding || wire.ruleset_hash != nil { quality.append("SOURCE_HASH_LABELS_ABBREVIATED") }
            if kind == .taskDisposition {
                if wire.ruleset_hash == nil { quality.append("RULESET_LABEL_ABSENT") }
                if wire.verified == true && (wire.ruleset_hash == nil || wire.gate_status != "PASS" || wire.model_verify_status != "PASS" || wire.findings_truncated == true) {
                    quality.append("SOURCE_VERIFIED_WITH_INCOMPLETE_CHECK_EVIDENCE")
                }
                if wire.findings_truncated == true { quality.append("SOURCE_FINDINGS_TRUNCATED") }
            }
            if kind == .assertedAdjudication { quality.append("SOURCE_ADJUDICATION_NOT_AUTHENTICATED") }
            return .init(wire: wire, kind: kind, canonicalDigest: canonical.sha256, quality: quality.sorted())
        } catch { throw HistoricalGateImportRefusalV1.malformedRow }
    }
    private static func hex(_ value: String, count: Int) -> Bool {
        value.utf8.count == count && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
    private static func label(_ value: String) -> Bool {
        (1...128).contains(value.utf8.count) && value.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [45, 46, 47, 95].contains($0)
        }
    }
    private static func validTimestamp(_ value: String) -> Bool {
        guard value.utf8.count == 24 else { return false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZ"; formatter.isLenient = false
        let suffix = String(value.suffix(5))
        guard suffix.first == "+" || suffix.first == "-", let hours = Int(suffix.dropFirst().prefix(2)),
              let minutes = Int(suffix.suffix(2)), hours <= 14, minutes < 60, hours < 14 || minutes == 0,
              let zone = TimeZone(secondsFromGMT: (suffix.first == "-" ? -1 : 1) * (hours * 3600 + minutes * 60))
        else { return false }
        formatter.timeZone = zone
        guard let date = formatter.date(from: value) else { return false }
        return formatter.string(from: date) == value
    }
}
