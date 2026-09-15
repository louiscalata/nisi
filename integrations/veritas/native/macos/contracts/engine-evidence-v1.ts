// Private MAC1 conformance oracle. Expected checks are declared independently;
// they are never recorded from Swift output. This is not a second full engine.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { canonicalJson } from "../../../tooling/scripts/common.mjs";

type Check = { id: string; status: string; explanation: string };
type Profile = {
  id: string; requiredSections: string[]; allowedAdvisoryDimensions: string[];
  modelParticipationRequired: boolean; maximumAdvisoryDimensions: number;
};
const contract = "veritas-mac1-engine-evidence-v1";
const dimensions = ["completeness", "factual_support", "risk", "style"];
const prototype: Profile = {
  id: "veritas-macos-one-file-v1", requiredSections: [],
  allowedAdvisoryDimensions: dimensions, modelParticipationRequired: false,
  maximumAdvisoryDimensions: 3,
};
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const frame = (value: string) => `${Buffer.byteLength(value, "utf8")}:${value}`;
const list = (values: string[]) => values.map(frame).join("");

function profileFingerprint(profile: Profile, admitted: boolean): string {
  return sha([
    frame("veritas-check-profile-rules-v1"),
    frame(admitted ? "PROFILE_ADMITTED" : "PROFILE_RESOURCE_REFUSED"),
    frame(profile.id), list(profile.requiredSections), list(profile.allowedAdvisoryDimensions),
    frame(profile.modelParticipationRequired ? "model-required" : "model-optional"),
    frame(String(profile.maximumAdvisoryDimensions)),
  ].join("|"));
}

const nonempty: Check = { id: "DET-001-NONEMPTY", status: "PASS", explanation: "The artifact contains bytes." };
const utf8: Check = { id: "DET-002-UTF8", status: "PASS", explanation: "The complete snapshot decodes as UTF-8." };
const sections: Check = { id: "DET-003-REQUIRED-SECTIONS", status: "PASS", explanation: "This profile declares no mandatory sections." };
const json: Check = { id: "DET-003-JSON-STRUCTURE", status: "PASS", explanation: "The snapshot is a JSON object or array." };
const jsonFailure = (explanation: string): Check[] => [nonempty, utf8, { ...json, status: "FAIL", explanation }];
const sectionCheck = (status: string, explanation: string): Check[] => [nonempty, utf8, { ...sections, status, explanation }];

type Request = { kind: string; utf8?: string; hex?: string; repeat: number; mode: string; profile: Profile };
type OracleCase = {
  label: string; request: Request; expectedChecks: Check[];
  normalizedProfile: Profile; profileAdmitted: boolean;
};
const cases: OracleCase[] = [];
function add(label: string, kind: string, text: string, expectedChecks: Check[], options: {
  mode?: string; repeat?: number; hex?: string; profile?: Partial<Profile>;
  normalized?: Partial<Profile>; admitted?: boolean;
} = {}) {
  const profile = { ...prototype, ...options.profile };
  cases.push({
    label,
    request: { kind, ...(options.hex === undefined ? { utf8: text } : { hex: options.hex }),
      repeat: options.repeat ?? 1, mode: options.mode ?? "ASSIST", profile },
    expectedChecks, normalizedProfile: { ...profile, ...options.normalized },
    profileAdmitted: options.admitted ?? true,
  });
}

add("valid JSON object", "json", '{"name":"veritas"}', [nonempty, utf8, json]);
add("valid JSON array", "json", "[1,true,null]", [nonempty, utf8, json]);
add("duplicate JSON key", "json", '{"a":1,"a":2}', jsonFailure("The JSON snapshot contains a duplicate object key."));
add("Unicode-equivalent JSON keys", "json", '{"caf\\u00e9":1,"cafe\\u0301":2}', jsonFailure("The JSON snapshot contains Unicode-equivalent object keys."));
add("NUL JSON key", "json", '{"\\u0000":1}', jsonFailure("The JSON snapshot contains a NUL object key."));
add("invalid UTF-8", "text", "", [nonempty,
  { id: "DET-002-UTF8", status: "FAIL", explanation: "The prototype accepts UTF-8 input only." },
  { id: "DET-003-STRUCTURE", status: "NOT_RUN", explanation: "Structure checks require valid UTF-8 text." }], { hex: "ff" });
add("empty direct snapshot", "text", "", [
  { ...nonempty, status: "FAIL", explanation: "The artifact is empty." }, utf8, sections]);
add("missing Markdown heading", "markdown", "# Summary", sectionCheck("FAIL", "Missing required section markers: Testing."), { profile: { requiredSections: ["Testing"] } });
add("present Markdown heading", "markdown", "## testing\n\nCovered.", sectionCheck("PASS", "Every required section marker is present."), { profile: { requiredSections: ["Testing"] } });
add("missing text marker", "text", "Rollback is discussed inline.", sectionCheck("FAIL", "Missing required standalone section markers: Rollback."), { profile: { requiredSections: ["Rollback"] } });
add("present text marker", "text", " rollback \nSteps follow.", sectionCheck("PASS", "Every required section marker is present as a standalone line."), { profile: { requiredSections: ["Rollback"] } });
add("off short-circuits even invalid input", "json", "bad", [], { mode: "OFF" });
add("enforce refuses even valid input", "json", "{}", [], { mode: "ENFORCE" });
add("required model unavailable", "json", "{}", [nonempty, utf8, json], { profile: { modelParticipationRequired: true } });
const profileRefusal = [{ id: "DET-000-PROFILE-RESOURCE-LIMIT", status: "FAIL", explanation: "The check profile exceeds the deterministic resource limits." }];
add("oversized profile ID", "text", "ok", profileRefusal, {
  profile: { id: "a".repeat(129) }, normalized: { id: "veritas-unadmitted-profile" }, admitted: false,
});
add("too many required sections", "text", "ok", profileRefusal, {
  profile: { requiredSections: Array.from({ length: 65 }, (_, i) => `section-${i}`) },
  normalized: { requiredSections: [] }, admitted: false,
});
add("oversized direct snapshot", "text", "a", [{ id: "DET-000-SNAPSHOT-BYTE-LIMIT", status: "FAIL", explanation: "The artifact exceeds the deterministic snapshot byte limit." }], { repeat: 1_048_577 });
add("raw Unicode profile framing", "text", "café / 🧪\n", [nonempty, utf8, sections], { profile: { id: "cafe\u0301/🧪" } });
add("profile trim deduplicate and order", "markdown", "# Testing\n# Rollback", sectionCheck("PASS", "Every required section marker is present."), {
  profile: { requiredSections: ["Testing", " Testing ", "Rollback"] },
  normalized: { requiredSections: ["Rollback", "Testing"] },
});
add("dimension set ordering and lower clamp", "text", "ok", [nonempty, utf8, sections], {
  profile: { allowedAdvisoryDimensions: ["style", "risk"], maximumAdvisoryDimensions: -8 },
  normalized: { allowedAdvisoryDimensions: ["risk", "style"], maximumAdvisoryDimensions: 0 },
});
assert.equal(cases.length, 20);

const vectors = cases.map((c, index) => {
  const r = c.request;
  const bytes = r.hex === undefined ? Buffer.from(r.utf8!.repeat(r.repeat), "utf8") : Buffer.from(r.hex, "hex");
  const subjectDigest = sha(bytes);
  const fingerprint = profileFingerprint(c.normalizedProfile, c.profileAdmitted);
  const passed = c.expectedChecks.length > 0 && c.expectedChecks.every(check => check.status === "PASS");
  const unavailable = r.mode === "ASSIST" && passed;
  const required = c.normalizedProfile.modelParticipationRequired;
  const expected = {
    subjectDigest, artifactKind: r.kind, profileID: c.normalizedProfile.id,
    profileFingerprint: fingerprint, mode: r.mode,
    disposition: r.mode === "OFF" ? "OFF" : r.mode === "ENFORCE" || (unavailable && required)
      ? "BLOCKED" : unavailable ? "DEGRADED" : "NEEDS_ATTENTION",
    deterministicChecks: c.expectedChecks, deterministicPassed: passed,
    modelParticipation: unavailable ? "UNAVAILABLE" : "NOT_RUN",
    // Explicit nulls, not omissions. null and absent are different facts under
    // the MAC1 contract (R5), and the envelope says which one it means. A probe
    // that did not run is `null`; a probe that ran reports counts it did not
    // observe as `null` too, rather than dropping the keys.
    analyzerProbe: unavailable ? {
      state: "DEGRADED", provider: "none", route: "deterministic-only",
      reasonCode: "MAC1_MODEL_UNAVAILABLE", adapterContractVersion: "deterministic-only-v1",
      modelIdentityStatus: "NO_MODEL", runtimeFingerprint: sha("deterministic-only-v1|MAC1_MODEL_UNAVAILABLE"),
      contextSize: null, requestTokenCount: null,
    } : null,
    advisoryCoverage: null, advisoryReceipt: null,
    advisoryPlan: [], findings: [], canAcceptInsideVeritas: unavailable && !required,
    limitationCodes: r.mode === "OFF" ? ["MODE_OFF_NO_ANALYSIS"] : r.mode === "ENFORCE"
      ? ["ENFORCE_ROUTE_NOT_IMPLEMENTED", "NO_EXTERNAL_ACTION_WITHHELD"]
      : unavailable ? ["MAC1_MODEL_UNAVAILABLE", required ? "REQUIRED_MODEL_EVIDENCE_MISSING" : "OPTIONAL_MODEL_EVIDENCE_MISSING", "DETERMINISTIC_RESULT_PRESERVED"]
      : ["DETERMINISTIC_GATE_FAILED_MODEL_SKIPPED"],
  };
  const canonical = canonicalJson(expected);
  return { id: `MAC1-EV-${String(index + 1).padStart(3, "0")}`, label: c.label, request: r,
    expectedCanonical: canonical, expectedDigest: sha(canonical), expectedProfileFingerprint: fingerprint };
});
const fixture = `${JSON.stringify({
  schemaVersion: 1, contract, scope: "ACTUAL_SWIFT_PIPELINE_DETERMINISTIC_ONLY_EVIDENCE_ENVELOPE",
  fullEngineParity: false, modelExecuted: false, externalAuthority: false,
  vectors,
}, null, 2)}\n`;
const fixtureURL = new URL("../CodenameVeritasFramework/Tests/VeritasCoreTests/Fixtures/engine-evidence-v1.json", import.meta.url);
if (process.argv[2] === "--print") process.stdout.write(fixture);
else if (process.argv[2] === "--check") {
  assert.equal(readFileSync(fixtureURL, "utf8"), fixture, "Frozen MAC1 vectors drifted; never update from Swift output.");
  console.log(JSON.stringify({ status: "PASS_PRIVATE_CONFORMANCE_ORACLE_ONLY", cases: vectors.length, fixtureSha256: sha(fixture), fullEngineParity: false }));
} else throw new Error("Use --check, or --print to propose an explicitly reviewed fixture update.");
