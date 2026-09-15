import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
// Constants and pure functions only — no side effects.

const AFM_INTERNAL_BUILDER_V2_PROFILE = 'nisi-afm-internal-builder-v2';

const AFM_INTERNAL_BUILDER_V2_LIMITS_V1 = Object.freeze({ checks: 32, checksPerPlan: 3, checkNameLength: 64, argvMax: 8, argvEntryLength: 128, timeoutSeconds: 300, outputBytes: 1048576 });

const AFM_INTERNAL_BUILDER_V2_CODES_V1 = Object.freeze([ 'AFM_BUILDER_V2_NOT_OBJECT', 'AFM_BUILDER_V2_UNKNOWN_MEMBER', 'AFM_BUILDER_V2_MISSING_MEMBER', 'AFM_BUILDER_V2_GRANT', 'AFM_BUILDER_V2_COMMAND', 'AFM_BUILDER_V2_BUDGET', 'AFM_BUILDER_V2_PIN', 'AFM_BUILDER_V2_PLAN' ]);

/**
 * Validates caller-consented grant policy { checks, manifestHash, budget }.
 * @param {unknown} input — candidate grant policy object.
 * @returns {{ ok: boolean, profile: string, ... }} validation result.
 */
function readTestRunGrantV1(input) {
  // TODO(mac-fill)
}

/**
 * Maps an accepted v1 proposal's testsToRun onto grant commands into a typed run plan.
 * @param {unknown} proposalResult — accepted v1 proposal result.
 * @param {unknown} grantPolicy — validated grant policy.
 * @returns {{ ok: boolean, profile: string, ... }} plan result.
 */
function planDeterministicTestRunV1(proposalResult, grantPolicy) {
  // TODO(mac-fill)
}

/**
 * Computes deterministic SHA-256 hex hash over the plan's five canonical fields.
 * @param {unknown} plan — plan object.
 * @returns {string} sha256 hex string.
 */
function testRunPlanHashV1(plan) {
  // TODO(mac-fill)
}

/**
 * Renders a self-contained frozen module exporting the plan.
 * @param {unknown} planResult — plan result object.
 * @returns {string} valid Node ESM module source.
 */
function testRunPlanSourceV1(planResult) {
  // TODO(mac-fill)
}

// PURE-REGION-END
export { readTestRunGrantV1, planDeterministicTestRunV1, testRunPlanHashV1, testRunPlanSourceV1 };