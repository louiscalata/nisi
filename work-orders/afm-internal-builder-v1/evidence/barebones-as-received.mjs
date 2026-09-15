import { canonicalizeJSONV1 } from '../../../canonical/canonical-json-v1.mjs';

// PURE-REGION-BEGIN
// Pure region: no side effects, no I/O, no mutation, no dynamic imports.

const AFM_BUILDER_PROFILE_V1 = 'nisi-afm-internal-builder-v1';
const AFM_BUILDER_LIMITS_V1 = Object.freeze({
  receipts: 16,
  steps: 16,
  checks: 16,
  checksPerProposal: 3,
  explanationLength: 512
});
const AFM_BUILDER_CODES_V1 = Object.freeze([
  'AFM_BUILDER_NOT_OBJECT',
  'AFM_BUILDER_UNKNOWN_MEMBER',
  'AFM_BUILDER_MISSING_MEMBER',
  'AFM_BUILDER_SCHEMA_VERSION',
  'AFM_BUILDER_PROJECT',
  'AFM_BUILDER_WORK_ORDER',
  'AFM_BUILDER_ALLOWED_STEPS',
  'AFM_BUILDER_ALLOWED_CHECKS',
  'AFM_BUILDER_RECEIPTS',
  'AFM_BUILDER_PROPOSAL'
]);

// readAfmBuilderPackV1(input) -> { ok: boolean, profile, ... } (see spec)
// Validates and returns a canonicalized pack or first error.
function readAfmBuilderPackV1(input) {
  // TODO(mac-fill)
}

// afmBuilderPackHashV1(pack) -> sha256 hex string of canonicalized pack
// Deterministic hash over pack members.
function afmBuilderPackHashV1(pack) {
  // TODO(mac-fill)
}

// proposeAfmBuilderStepV1(readPackResult, policy) -> { ok: boolean, profile, ... }
// Generates a proposal or rejects with AFM_BUILDER_PROPOSAL.
function proposeAfmBuilderStepV1(readPackResult, policy) {
  // TODO(mac-fill)
}

// proposalModuleSourceV1(proposalResult) -> string (valid Node ESM module)
// Generates a self-contained module that exports the proposal.
function proposalModuleSourceV1(proposalResult) {
  // TODO(mac-fill)
}

// PURE-REGION-END

export {
  readAfmBuilderPackV1,
  afmBuilderPackHashV1,
  proposeAfmBuilderStepV1,
  proposalModuleSourceV1
};
