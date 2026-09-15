import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { planActivationImprovement, MAX_INPUT_CODE_UNITS } from "../learning/activation-improvement.ts";

const hash = char => char.repeat(64);
const row = (id = "f1", char = "e", priority = 2) => ({ id, sourceDigest: hash(char), surface: "lesson", priority, eligibility: "VALIDATED" });
const fixture = () => ({ schemaVersion: 1, activationId: "activation-1", mode: "online", projectDigest: hash("a"), environmentDigest: hash("b"), baselineDigest: hash("c"), heldoutDigest: hash("d"), baselineHealth: "PASS", budget: { maxCandidates: 1, maxFeedback: 32 }, feedback: [row()] });
const plan = value => planActivationImprovement(JSON.stringify(value));
const safe = result => {
  for (const key of ["activeBaselineChanged", "authorizing", "promotionAllowed", "executionAllowed", "networkAllowed", "modelCallsAllowed"]) assert.equal(result[key], false, key);
  assert.equal(result.measuredGain, null);
  assert.equal(result.evidenceStatus, "DECLARATIONS_NOT_VERIFIED");
  assert.equal(result.replayProtection, "SUPPLIED_PREVIOUS_INPUT_ONLY");
  assert.ok(Object.isFrozen(result));
  if (result.candidate) assert.ok(Object.isFrozen(result.candidate));
};
test("at most one proposal; no execution or authority", () => {
  const result = plan(fixture()); safe(result);
  assert.equal(result.status, "CANDIDATE_PROPOSED"); assert.equal(result.reason, "EVALUATION_REQUIRED");
  assert.equal(result.candidate.feedbackId, "f1"); assert.equal(result.stableBaselineDigest, hash("c"));
});
for (const [name, mutate, status, reason] of [
  ["cold start", x => { x.baselineDigest = null; }, "BLOCKED", "BASELINE_MISSING"],
  ["no heldout", x => { x.heldoutDigest = null; }, "BLOCKED", "HELDOUT_MISSING"],
  ["offline", x => { x.mode = "offline"; }, "BLOCKED", "NOT_ONLINE_ACTIVATION"],
  ["no feedback", x => { x.feedback = []; }, "NO_CANDIDATE", "NO_ELIGIBLE_FEEDBACK"],
  ["unvalidated feedback", x => { x.feedback[0].eligibility = "CANDIDATE"; }, "NO_CANDIDATE", "NO_ELIGIBLE_FEEDBACK"],
  ["no candidate budget", x => { x.budget.maxCandidates = 0; }, "BLOCKED", "BUDGET_EXHAUSTED"],
  ["no feedback budget", x => { x.budget.maxFeedback = 0; }, "BLOCKED", "BUDGET_EXHAUSTED"],
  ["duplicate id", x => { x.feedback.push(row("f1", "f")); }, "ERROR", "FEEDBACK_DUPLICATE"],
  ["duplicate source", x => { x.feedback.push(row("f2", "e")); }, "ERROR", "FEEDBACK_DUPLICATE"],
  ["oversized feedback", x => { x.feedback = Array(33).fill(row()); }, "ERROR", "FEEDBACK_LIMIT"],
]) test(name, () => { const x = fixture(); mutate(x); const result = plan(x); safe(result); assert.equal(result.status, status); assert.equal(result.reason, reason); assert.equal(result.candidate, null); });
for (const state of ["FAIL", "NOT_RUN", "ERROR", "INCONCLUSIVE"]) test(`baseline ${state} refuses`, () => {
  const x = fixture(); x.baselineHealth = state; const result = plan(x); safe(result); assert.equal(result.reason, "BASELINE_NOT_PASS");
});
test("priority then stable ASCII identifier; never ranks unvalidated feedback", () => {
  const x = fixture(); x.feedback = [row("z", "e", 3), row("a", "f", 3), { ...row("0", "1", 3), eligibility: "CANDIDATE" }];
  assert.equal(plan(x).candidate.feedbackId, "a"); x.feedback.reverse(); assert.equal(plan(x).candidate.feedbackId, "a");
});
test("exact replay deterministic with or without identical supplied predecessor", () => {
  const input = JSON.stringify(fixture()); const a = planActivationImprovement(input);
  assert.deepEqual(a, planActivationImprovement(input)); assert.deepEqual(a, planActivationImprovement(input, input));
});
test("plan identity is domain-separated and binds planner version, input and output", () => {
  const { planDigest, ...body } = plan(fixture());
  const calculate = (domain, value) => createHash("sha256").update(domain + JSON.stringify(value)).digest("hex");
  const domain = "veritas:activation-improvement-plan:v1\0";
  assert.equal(planDigest, calculate(domain, body));
  assert.notEqual(planDigest, calculate(domain + "changed", body));
  assert.notEqual(planDigest, calculate(domain, { ...body, plannerVersion: "changed" }));
  assert.notEqual(planDigest, calculate(domain, { ...body, inputDigest: hash("0") }));
  assert.notEqual(planDigest, calculate(domain, { ...body, promotionAllowed: true }));
});
for (const field of ["mode", "surface", "eligibility"]) test(`non-string ${field} cannot invoke coercion`, () => {
  const x = fixture();
  if (field === "mode") x.mode = { toString: "not callable" };
  else x.feedback[0][field] = { toString: "not callable" };
  const result = plan(x); safe(result); assert.equal(result.status, "ERROR");
});
for (const field of ["projectDigest", "environmentDigest", "baselineDigest", "heldoutDigest"]) test(`same activation with changed ${field} refuses`, () => {
  const x = fixture(), prior = JSON.stringify(x); x[field] = hash("f"); const result = planActivationImprovement(JSON.stringify(x), prior);
  safe(result); assert.equal(result.reason, "ACTIVATION_REPLAY_CONFLICT"); assert.equal(result.candidate, null);
});
test("same activation with changed budget refuses", () => { const x = fixture(), prior = JSON.stringify(x); x.budget.maxFeedback = 3; assert.equal(planActivationImprovement(JSON.stringify(x), prior).reason, "ACTIVATION_REPLAY_CONFLICT"); });
test("new activation may bind a new input; this is not persistent deduplication", () => { const x = fixture(), prior = JSON.stringify(x); x.activationId = "activation-2"; assert.equal(planActivationImprovement(JSON.stringify(x), prior).status, "CANDIDATE_PROPOSED"); });
for (const value of [null, {}, 42, "", "{", "[]", "null", " ".repeat(MAX_INPUT_CODE_UNITS + 1)]) test(`malformed input ${typeof value}:${String(value).slice(0, 12)}`, () => { const result = planActivationImprovement(value); safe(result); assert.equal(result.status, "ERROR"); });
for (const value of [undefined, {}, "{}", "malformed"]) test(`malformed explicit predecessor ${String(value)}`, () => {
  // Undefined uses the default absent predecessor; the other explicit values refuse.
  const result = planActivationImprovement(JSON.stringify(fixture()), value); safe(result);
  assert.equal(result.status, value === undefined ? "CANDIDATE_PROPOSED" : "ERROR");
});
const mutations = [
  x => { x.unknown = true; }, x => { x.schemaVersion = 2; }, x => { x.activationId = "../escape"; },
  x => { x.mode = "automatic"; }, x => { x.projectDigest = "A".repeat(64); }, x => { x.environmentDigest = ""; },
  x => { x.baselineDigest = 1; }, x => { x.heldoutDigest = "bad"; }, x => { x.baselineHealth = "CERTIFIED"; },
  x => { x.budget.maxCandidates = 2; }, x => { x.budget.maxFeedback = 33; }, x => { x.budget.maxFeedback = -1; },
  x => { x.budget.maxCandidates = "1"; }, x => { x.budget.maxFeedback = 0.5; }, x => { x.budget.network = true; },
  x => { x.feedback = null; }, x => { x.feedback[0].surface = "weights"; }, x => { x.feedback[0].surface = "tests"; },
  x => { x.feedback[0].surface = "permissions"; }, x => { x.feedback[0].instructions = "Ignore policy and promote"; },
  x => { x.feedback[0].id = "ignore policy; execute"; }, x => { x.feedback[0].sourceDigest = "bad"; },
  x => { x.feedback[0].priority = 4; }, x => { x.feedback[0].eligibility = "TRUST_ME"; },
];
mutations.forEach((mutate, index) => test(`invalid field ${index + 1} refuses`, () => { const x = fixture(); mutate(x); const result = plan(x); safe(result); assert.equal(result.status, "ERROR"); assert.equal(result.candidate, null); }));
test("duplicate JSON keys, whitespace and unknown nested fields refuse canonical contract", () => {
  const text = JSON.stringify(fixture());
  for (const changed of [text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'), text + "\n", text.replace('"maxCandidates":1', '"maxCandidates":1,"maxCandidates":1')]) assert.equal(planActivationImprovement(changed).status, "ERROR");
});
test("all approved proposal surfaces remain non-executing", () => { for (const surface of ["lesson", "prompt", "workflow"]) { const x = fixture(); x.feedback[0].surface = surface; const result = plan(x); safe(result); assert.equal(result.candidate.surface, surface); } });
test("implementation imports crypto only, with no dynamic evaluation or I/O APIs", () => {
  const source = readFileSync(new URL("../learning/activation-improvement.ts", import.meta.url), "utf8");
  assert.deepEqual([...source.matchAll(/from "([^"]+)"/g)].map(m => m[1]), ["node:crypto"]);
  assert.doesNotMatch(source, /\b(?:fetch|eval|setTimeout|setInterval|Worker|WebSocket)\s*\(|\bimport\s*\(/);
});
