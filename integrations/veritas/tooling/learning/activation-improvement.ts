import { createHash } from "node:crypto";

// Planning only. Caller declarations and matching hashes do not prove evidence,
// consent, custody or measured improvement. No I/O, model, executor or promotion.
export const PLANNER_VERSION = "activation-improvement-plan-v1";
export const MAX_INPUT_CODE_UNITS = 32_768;
const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
};
const healthStates = ["PASS", "FAIL", "NOT_RUN", "ERROR", "INCONCLUSIVE"] as const;
type Health = typeof healthStates[number];
type Surface = "lesson" | "prompt" | "workflow";
type Feedback = { id: string; sourceDigest: string; surface: Surface; priority: number; eligibility: "VALIDATED" | "CANDIDATE" };
type Input = {
  schemaVersion: 1; activationId: string; mode: "online" | "offline";
  projectDigest: string; environmentDigest: string;
  baselineDigest: string | null; heldoutDigest: string | null;
  baselineHealth: Health;
  budget: { maxCandidates: number; maxFeedback: number };
  feedback: Feedback[];
};
type Status = "BLOCKED" | "NO_CANDIDATE" | "CANDIDATE_PROPOSED" | "ERROR";

function parse(text: unknown): { input: Input; digest: string } | { error: string } {
  if (typeof text !== "string") return { error: "INPUT_NOT_TEXT" };
  if (text.length > MAX_INPUT_CODE_UNITS) return { error: "INPUT_LIMIT" };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { error: "INVALID_JSON" }; }
  if (!record(value) || !keys(value, ["schemaVersion", "activationId", "mode", "projectDigest", "environmentDigest", "baselineDigest", "heldoutDigest", "baselineHealth", "budget", "feedback"])) return { error: "INPUT_SHAPE" };
  if (value.schemaVersion !== 1 || !id(value.activationId) || typeof value.mode !== "string" || !["online", "offline"].includes(value.mode) ||
      !sha(value.projectDigest) || !sha(value.environmentDigest) ||
      (value.baselineDigest !== null && !sha(value.baselineDigest)) ||
      (value.heldoutDigest !== null && !sha(value.heldoutDigest)) ||
      !healthStates.includes(value.baselineHealth as Health)) return { error: "INPUT_FIELDS" };
  const budget = value.budget;
  if (!record(budget) || !keys(budget, ["maxCandidates", "maxFeedback"]) ||
      !Number.isInteger(budget.maxCandidates) || ![0, 1].includes(budget.maxCandidates as number) ||
      !Number.isInteger(budget.maxFeedback) || (budget.maxFeedback as number) < 0 || (budget.maxFeedback as number) > 32) return { error: "BUDGET_SHAPE" };
  if (!Array.isArray(value.feedback) || value.feedback.length > 32) return { error: "FEEDBACK_LIMIT" };
  const feedback: Feedback[] = [];
  const ids = new Set<string>();
  const sources = new Set<string>();
  for (const row of value.feedback) {
    if (!record(row) || !keys(row, ["id", "sourceDigest", "surface", "priority", "eligibility"]) ||
        !id(row.id) || !sha(row.sourceDigest) || typeof row.surface !== "string" || !["lesson", "prompt", "workflow"].includes(row.surface) ||
        !Number.isInteger(row.priority) || (row.priority as number) < 1 || (row.priority as number) > 3 ||
        typeof row.eligibility !== "string" || !["VALIDATED", "CANDIDATE"].includes(row.eligibility)) return { error: "FEEDBACK_FIELDS" };
    if (ids.has(row.id) || sources.has(row.sourceDigest)) return { error: "FEEDBACK_DUPLICATE" };
    ids.add(row.id); sources.add(row.sourceDigest);
    feedback.push({ id: row.id, sourceDigest: row.sourceDigest, surface: row.surface as Surface, priority: row.priority as number, eligibility: row.eligibility as Feedback["eligibility"] });
  }
  const input: Input = {
    schemaVersion: 1, activationId: value.activationId, mode: value.mode as Input["mode"],
    projectDigest: value.projectDigest, environmentDigest: value.environmentDigest,
    baselineDigest: value.baselineDigest, heldoutDigest: value.heldoutDigest,
    baselineHealth: value.baselineHealth as Health,
    budget: { maxCandidates: budget.maxCandidates as number, maxFeedback: budget.maxFeedback as number }, feedback,
  };
  // Exact fixed-shape encoding rejects duplicate keys, unknown fields and alternate
  // encodings without recursively traversing arbitrary caller-supplied objects.
  if (JSON.stringify(input) !== text) return { error: "NONCANONICAL_INPUT" };
  return { input, digest: digest(text) };
}

/** Deterministic proposal only; no persistent activation ledger or global hook.
 * previousInputText checks only the supplied predecessor. It cannot detect an
 * omitted/tampered history. A future trusted owner must supply complete custody.
 */
export function planActivationImprovement(inputText: unknown, previousInputText: unknown = null) {
  const parsed = parse(inputText);
  const input = "input" in parsed ? parsed.input : null;
  const inputDigest = "digest" in parsed ? parsed.digest : null;
  const finish = (status: Status, reason: string, selected: Feedback | null = null) => {
    const body = {
    plannerVersion: PLANNER_VERSION, status, reason,
    activationId: input?.activationId ?? null, inputDigest,
    projectDigest: input?.projectDigest ?? null, environmentDigest: input?.environmentDigest ?? null,
    stableBaselineDigest: input?.baselineDigest ?? null, heldoutDigest: input?.heldoutDigest ?? null,
    candidate: selected === null ? null : Object.freeze({
      feedbackId: selected.id, sourceDigest: selected.sourceDigest, surface: selected.surface,
      requiredEvaluation: "SAME_FIXED_HELDOUT_BASELINE_COMPARISON_AND_REQUIRED_NO_REGRESSION_GATES",
    }),
    evidenceStatus: "DECLARATIONS_NOT_VERIFIED", measuredGain: null,
    activeBaselineChanged: false, authorizing: false, promotionAllowed: false,
    executionAllowed: false, networkAllowed: false, modelCallsAllowed: false,
    replayProtection: "SUPPLIED_PREVIOUS_INPUT_ONLY",
    };
    // An unsigned content identity, not authentication or protected custody.
    const planDigest = digest("veritas:activation-improvement-plan:v1\0" + JSON.stringify(body));
    return Object.freeze({ ...body, planDigest });
  };
  if ("error" in parsed) return finish("ERROR", parsed.error);
  if (previousInputText !== null) {
    const previous = parse(previousInputText);
    if ("error" in previous) return finish("ERROR", "PREVIOUS_INPUT_INVALID");
    if (previous.input.activationId === parsed.input.activationId && previous.digest !== parsed.digest)
      return finish("BLOCKED", "ACTIVATION_REPLAY_CONFLICT");
  }
  const current = parsed.input;
  if (current.mode !== "online") return finish("BLOCKED", "NOT_ONLINE_ACTIVATION");
  if (current.baselineDigest === null) return finish("BLOCKED", "BASELINE_MISSING");
  if (current.heldoutDigest === null) return finish("BLOCKED", "HELDOUT_MISSING");
  if (current.baselineHealth !== "PASS") return finish("BLOCKED", "BASELINE_NOT_PASS");
  if (current.budget.maxCandidates === 0 || current.feedback.length > current.budget.maxFeedback)
    return finish("BLOCKED", "BUDGET_EXHAUSTED");
  const eligible = current.feedback.filter(row => row.eligibility === "VALIDATED")
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const selected = eligible[0];
  return selected ? finish("CANDIDATE_PROPOSED", "EVALUATION_REQUIRED", selected) : finish("NO_CANDIDATE", "NO_ELIGIBLE_FEEDBACK");
}
