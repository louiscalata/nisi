import Foundation

public enum CheckStatus: String, Codable, Sendable {
    case pass = "PASS"
    case fail = "FAIL"
    case notRun = "NOT_RUN"
    case error = "ERROR"
    case inconclusive = "INCONCLUSIVE"
}

public struct CheckOutcome: Codable, Equatable, Sendable, Identifiable {
    public let id: String
    public let status: CheckStatus
    public let explanation: String

    public init(id: String, status: CheckStatus, explanation: String) {
        self.id = id
        self.status = status
        self.explanation = explanation
    }
}

public enum AdvisoryDimension: String, Codable, CaseIterable, Sendable {
    case completeness
    case factualSupport = "factual_support"
    case style
    case risk
}

public struct CheckProfile: Equatable, Sendable {
    public static let rulesetVersion = "veritas-check-profile-rules-v1"
    public static let maximumIDBytes = 128
    public static let maximumRequiredSections = 64
    public static let maximumRequiredSectionBytes = 256
    public static let maximumRequiredSectionTotalBytes = 8_192

    public let id: String
    public let requiredSections: [String]
    public let allowedAdvisoryDimensions: Set<AdvisoryDimension>
    public let modelParticipationRequired: Bool
    public let maximumAdvisoryDimensions: Int
    /// False means caller-controlled profile material exceeded the frozen
    /// deterministic resource envelope. Invalid raw strings are not retained or
    /// fingerprinted, and the gate refuses before analyzer work.
    public let resourceLimitsAdmitted: Bool

    public init(
        id: String,
        requiredSections: [String] = [],
        allowedAdvisoryDimensions: Set<AdvisoryDimension> = Set(AdvisoryDimension.allCases),
        modelParticipationRequired: Bool = false,
        maximumAdvisoryDimensions: Int = 3
    ) {
        let idAdmitted = !id.isEmpty && id.utf8.count <= Self.maximumIDBytes
        var sectionBytes = 0
        var sectionsAdmitted = requiredSections.count <= Self.maximumRequiredSections
        if sectionsAdmitted {
            for section in requiredSections {
                let count = section.utf8.count
                if count > Self.maximumRequiredSectionBytes
                    || sectionBytes > Self.maximumRequiredSectionTotalBytes - count {
                    sectionsAdmitted = false
                    break
                }
                sectionBytes += count
            }
        }
        self.resourceLimitsAdmitted = idAdmitted && sectionsAdmitted
        self.id = idAdmitted ? id : "veritas-unadmitted-profile"
        if sectionsAdmitted {
            self.requiredSections = Array(Set(requiredSections.map {
                $0.trimmingCharacters(in: .whitespacesAndNewlines)
            }))
                .filter { !$0.isEmpty }
                .sorted()
        } else {
            self.requiredSections = []
        }
        self.allowedAdvisoryDimensions = allowedAdvisoryDimensions
        self.modelParticipationRequired = modelParticipationRequired
        self.maximumAdvisoryDimensions = max(0, min(maximumAdvisoryDimensions, 4))
    }

    public static let prototype = CheckProfile(
        id: "veritas-macos-one-file-v1",
        requiredSections: [],
        allowedAdvisoryDimensions: [.completeness, .factualSupport, .style, .risk],
        modelParticipationRequired: false,
        maximumAdvisoryDimensions: 3
    )

    public var rulesFingerprint: String {
        func encode(_ value: String) -> String {
            "\(value.utf8.count):\(value)"
        }
        func encodeList(_ values: [String]) -> String {
            values.map(encode).joined()
        }
        let fields = [
            encode(Self.rulesetVersion),
            encode(resourceLimitsAdmitted ? "PROFILE_ADMITTED" : "PROFILE_RESOURCE_REFUSED"),
            encode(id),
            encodeList(requiredSections),
            encodeList(allowedAdvisoryDimensions.map(\.rawValue).sorted()),
            encode(modelParticipationRequired ? "model-required" : "model-optional"),
            encode(String(maximumAdvisoryDimensions)),
        ]
        let unambiguous = fields.joined(separator: "|")
        return ArtifactSnapshot.digest(Data(unambiguous.utf8))
    }
}

public struct DeterministicGateRunner: Sendable {
    public init() {}

    public func run(snapshot: ArtifactSnapshot, profile: CheckProfile) -> [CheckOutcome] {
        guard profile.resourceLimitsAdmitted else {
            return [CheckOutcome(
                id: "DET-000-PROFILE-RESOURCE-LIMIT",
                status: .fail,
                explanation: "The check profile exceeds the deterministic resource limits."
            )]
        }
        guard snapshot.bytes.count <= ArtifactSnapshotter.prototypeByteLimit else {
            return [CheckOutcome(
                id: "DET-000-SNAPSHOT-BYTE-LIMIT",
                status: .fail,
                explanation: "The artifact exceeds the deterministic snapshot byte limit."
            )]
        }
        var outcomes = [CheckOutcome]()
        outcomes.append(CheckOutcome(
            id: "DET-001-NONEMPTY",
            status: snapshot.bytes.isEmpty ? .fail : .pass,
            explanation: snapshot.bytes.isEmpty ? "The artifact is empty." : "The artifact contains bytes."
        ))

        guard let text = snapshot.text else {
            outcomes.append(CheckOutcome(
                id: "DET-002-UTF8",
                status: .fail,
                explanation: "The prototype accepts UTF-8 input only."
            ))
            outcomes.append(CheckOutcome(
                id: "DET-003-STRUCTURE",
                status: .notRun,
                explanation: "Structure checks require valid UTF-8 text."
            ))
            return outcomes
        }

        outcomes.append(CheckOutcome(
            id: "DET-002-UTF8",
            status: .pass,
            explanation: "The complete snapshot decodes as UTF-8."
        ))

        switch snapshot.kind {
        case .json:
            outcomes.append(jsonOutcome(bytes: snapshot.bytes))
        case .markdown:
            outcomes.append(markdownSectionsOutcome(text: text, profile: profile))
        case .text:
            outcomes.append(textSectionsOutcome(text: text, profile: profile))
        }
        return outcomes
    }

    private func jsonOutcome(bytes: Data) -> CheckOutcome {
        do {
            try StrictJSONDocumentValidator.validate(bytes)
            let object = try JSONSerialization.jsonObject(with: bytes, options: [])
            let validTopLevel = object is [String: Any] || object is [Any]
            return CheckOutcome(
                id: "DET-003-JSON-STRUCTURE",
                status: validTopLevel ? .pass : .fail,
                explanation: validTopLevel
                    ? "The snapshot is a JSON object or array."
                    : "The prototype profile requires a JSON object or array."
            )
        } catch StrictJSONValidationFailure.duplicateObjectKey {
            return CheckOutcome(
                id: "DET-003-JSON-STRUCTURE",
                status: .fail,
                explanation: "The JSON snapshot contains a duplicate object key."
            )
        } catch StrictJSONValidationFailure.unicodeEquivalentObjectKey {
            return CheckOutcome(
                id: "DET-003-JSON-STRUCTURE",
                status: .fail,
                explanation: "The JSON snapshot contains Unicode-equivalent object keys."
            )
        } catch StrictJSONValidationFailure.nulObjectKey {
            return CheckOutcome(
                id: "DET-003-JSON-STRUCTURE",
                status: .fail,
                explanation: "The JSON snapshot contains a NUL object key."
            )
        } catch StrictJSONValidationFailure.byteLimitExceeded {
            return CheckOutcome(
                id: "DET-003-JSON-STRUCTURE",
                status: .fail,
                explanation: "The JSON snapshot exceeds the deterministic byte limit."
            )
        } catch StrictJSONValidationFailure.nestingLimitExceeded {
            return CheckOutcome(
                id: "DET-003-JSON-STRUCTURE",
                status: .fail,
                explanation: "The JSON snapshot exceeds the deterministic nesting limit."
            )
        } catch StrictJSONValidationFailure.objectKeyLimitExceeded {
            return CheckOutcome(
                id: "DET-003-JSON-STRUCTURE",
                status: .fail,
                explanation: "The JSON snapshot exceeds the deterministic object-key limit."
            )
        } catch {
            return CheckOutcome(
                id: "DET-003-JSON-STRUCTURE",
                status: .fail,
                explanation: "The snapshot is not valid JSON."
            )
        }
    }

    private func markdownSectionsOutcome(text: String, profile: CheckProfile) -> CheckOutcome {
        guard !profile.requiredSections.isEmpty else {
            return CheckOutcome(
                id: "DET-003-REQUIRED-SECTIONS",
                status: .pass,
                explanation: "This profile declares no mandatory sections."
            )
        }
        let headings = Set(text.split(whereSeparator: \.isNewline).compactMap { line -> String? in
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.first == "#" else { return nil }
            let title = trimmed.drop(while: { $0 == "#" || $0.isWhitespace })
            guard !title.isEmpty else { return nil }
            return title.lowercased()
        })
        let missing = profile.requiredSections.filter { !headings.contains($0.lowercased()) }
        return CheckOutcome(
            id: "DET-003-REQUIRED-SECTIONS",
            status: missing.isEmpty ? .pass : .fail,
            explanation: missing.isEmpty
                ? "Every required section marker is present."
                : "Missing required section markers: \(missing.joined(separator: ", "))."
        )
    }

    private func textSectionsOutcome(text: String, profile: CheckProfile) -> CheckOutcome {
        guard !profile.requiredSections.isEmpty else {
            return CheckOutcome(
                id: "DET-003-REQUIRED-SECTIONS",
                status: .pass,
                explanation: "This profile declares no mandatory sections."
            )
        }
        let normalizedLines = Set(text.split(whereSeparator: \.isNewline).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
        let missing = profile.requiredSections.filter { !normalizedLines.contains($0.lowercased()) }
        return CheckOutcome(
            id: "DET-003-REQUIRED-SECTIONS",
            status: missing.isEmpty ? .pass : .fail,
            explanation: missing.isEmpty
                ? "Every required section marker is present as a standalone line."
                : "Missing required standalone section markers: \(missing.joined(separator: ", "))."
        )
    }
}
