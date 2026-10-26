// Grounded rung-3 demo chain: real rung-1 pack -> real rung-2 plan -> real
// rung-3 write plan, using only oracle-verified inputs that match how the
// SharedChami worker actually dispatches (explicit argv, no shell, bounded
// budget) and lanes that exist in this tree (evidence/). Writes the chain
// artifacts into evidence/. Read-only itself: it only plans, never writes the
// staged files.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readAfmBuilderPackV1, proposeAfmBuilderStepV1 } from '../../afm-internal-builder-v1/src/afm-internal-builder-v1.mjs';
import { planDeterministicTestRunV1 } from '../../afm-internal-builder-v2/src/afm-internal-builder-v2.mjs';
import { readStagingPolicyV1, planStagingWritesV1, stagingWritePlanSourceV1 } from '../src/afm-internal-builder-v3.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// 1. Real rung-1 pack, grounded in the bridge's own verified surfaces.
const packInput = {
  schemaVersion: 1,
  project: 'nisi',
  roadmapDigest: '0'.repeat(64),
  workOrder: {
    id: 'AFM-DEMO-3',
    goal: 'Prove rung-3 scoped staging-write planning end to end.',
    acceptance: 'write plan is lane-scoped, pinned and bounded; nothing executes',
  },
  lastReceipts: [],
  allowedSteps: ['implement', 'test', 'document'],
  allowedChecks: ['afm-v1-oracle', 'bridge-contract', 'v2-module-check', 'v3-module-check'],
};
const read = readAfmBuilderPackV1(packInput);
if (!read.ok) throw new Error(`pack: ${read.code} ${read.path}`);
writeFileSync(join(here, 'demo-pack-grounded.json'), JSON.stringify(read.pack, null, 2));

// 2. Real rung-1 proposal for the doc/test step.
const prop = proposeAfmBuilderStepV1(read, {
  step: 'document',
  checks: ['afm-v1-oracle', 'bridge-contract'],
  explanation: 'End-to-end rung-1 to rung-3 integration proof.',
});
if (!prop.ok) throw new Error(`proposal: ${prop.code} ${prop.path}`);
writeFileSync(join(here, 'demo-proposal.json'), JSON.stringify(prop.proposal, null, 2));

// 3. Real rung-2 plan via a caller-consented grant with the bridge checks and
// a caller-fixed manifest pin (same discipline as the two-machine bridge).
const grantPolicy = {
  checks: {
    'bridge-contract': ['node', '--test', 'windows-worker-contract.test.mjs'],
    'afm-v1-oracle': ['node', '--test', 'afm-internal-builder-v1.test.mjs'],
    'v3-module-check': ['node', '--test', 'afm-internal-builder-v3.test.mjs'],
  },
  manifestHash: 'f'.repeat(63) + '0',
  budget: { timeoutSeconds: 120, outputBytes: 262144 },
};
const plan = planDeterministicTestRunV1(prop, grantPolicy);
if (!plan.ok) throw new Error(`plan: ${plan.code} ${plan.path}`);
writeFileSync(join(here, 'demo-plan.json'), JSON.stringify(plan.plan, null, 2));

// 4. Real rung-3 write plan: staged artifacts under this work order's
// evidence lane, planned bytes within the per-file and total budgets, bound to
// the same manifest pin the rung-2 plan carries.
const stagingPolicy = {
  lane: 'work-orders/afm-internal-builder-v3/evidence/',
  files: { 'write-plan.json': 2048, 'summary-plan.md': 1024 },
  manifestHash: grantPolicy.manifestHash,
};
const policyRead = readStagingPolicyV1(stagingPolicy);
if (!policyRead.ok) throw new Error(`policy: ${policyRead.code} ${policyRead.path}`);
const writePlan = planStagingWritesV1(plan, stagingPolicy);
if (!writePlan.ok) throw new Error(`write plan: ${writePlan.code} ${writePlan.path}`);
writeFileSync(join(here, 'demo-write-plan.json'), JSON.stringify(writePlan.writePlan, null, 2));

// 5. Generated self-contained write-plan module, always a valid ESM file.
const source = stagingWritePlanSourceV1(writePlan);
writeFileSync(join(here, 'write-plan-demo.mjs'), source);

const summary = [
  'Rung-3 grounded demo chain (real v1 -> v2 -> v3 modules)',
  '',
  `planHash:            ${plan.plan.planHash}`,
  `stagingHash:         ${writePlan.writePlan.stagingHash}`,
  `manifest pin:        ${writePlan.writePlan.manifestHash}`,
  `sourcePlanHash:      ${writePlan.writePlan.sourcePlanHash}`,
  `packHash:            ${writePlan.writePlan.packHash}`,
  `lane:                ${writePlan.writePlan.lane}`,
  `totalBytes:          ${writePlan.writePlan.totalBytes}`,
  `writes:              ${writePlan.writePlan.writes.map((w) => `${w.name} (${w.bytes} B) @ ${w.path}`).join(' | ')}`,
  '',
  'Generated module:    evidence/write-plan-demo.mjs (node --check PASS expected)',
];
writeFileSync(join(here, 'demo-chain-summary.txt'), summary.join('\n') + '\n');
console.log(summary.join('\n'));