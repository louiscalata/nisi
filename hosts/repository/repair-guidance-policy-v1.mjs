// PRIVATE arm-invariant policy identity derived from fixed issued guidance.
// Source/task identities remain on the separate arm registration, not this hash.
import { readRepairGuidanceV1, registerRepairGuidanceV1 } from '../../adapters/repair-guidance-v1.mjs';
import { cloneFreeze, stableStringify, sha256Text } from '../../workflow/contracts.mjs';

export function describeRepairGuidancePolicyV1(registration) {
  const r = readRepairGuidanceV1(registration, registration?.api);
  const on = registerRepairGuidanceV1({arm:'ON',api:r.api,binding:r.binding});
  const identity = { schemaVersion:'nisi-repair-guidance-policy-v1',version:r.version,api:r.api,
    applicationPoint:r.applicationPoint,baseSystemPromptSha256:r.baseSystemPromptSha256,
    onSystemPromptSha256:on.expectedSystemPromptSha256,suffixSha256:on.suffixSha256 };
  return cloneFreeze({...identity,sha256:sha256Text('nisi/repair-guidance-policy/v1\0'+stableStringify(identity)),
    authorizing:false,measurementVerified:false,promotionEligible:false});
}
