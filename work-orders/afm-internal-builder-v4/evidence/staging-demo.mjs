// Grounded rung-4 demo chain: real rung-1 pack -> real rung-2 plan -> real
// rung-3 write plan -> real rung-4 compile plan, using oracle-verified inputs
// that match how the SharedChami worker actually dispatches (explicit argv, no
// shell, bounded budget) and lanes that exist in this tree (staging/ under the
// work order). Writes the chain artifacts into evidence/. Read-only itself: it
// only plans, never invokes swiftc and never stages files.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readAfmBuilderPackV1, proposeAfmBuilderStepV1 } from '../../afm-internal-builder-v1/src/afm-internal-builder-v1.mjs';
import { planDeterministicTestRunV1 } from '../../afm-internal-builder-v2/src/afm-internal-builder-v2.mjs';
import { planStagingWritesV1 } from '../../afm-internal-builder-v3/src/afm-internal-builder-v3.mjs';
import { readCompilePolicyV1, planStagedCompileV1, stagedCompilePlanSourceV1 } from '../src/afm-internal-builder-v4.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LANE = 'work-orders/afm-internal-builder-v4/evidence/staging/';
const SHA1 = '1'.repeat(64);
const SHA2 = '2'.repeat(64);

// 1. Real rung-1 pack, grounded in the bridge's own verified surfaces.
const packInput = {
  schemaVersion: 1,
  project: 'nisi',
  roadmapDigest: '0'.repeat(64),
  workOrder: {
    id: 'AFM-DEMO-4',
    goal: 'Prove rung-4 sandboxed staged compile planning end to end.',
    acceptance: 'compile plan is lane-scoped, exact swiftc argv, pinned, no network; nothing executes',
  },
  lastReceipts: [],
  allowedSteps: ['implement', 'test', 'document'],
  allowedChecks: ['afm-v1-oracle', 'bridge-contract', 'v2-module-check', 'v3-module-check'],
};
const read = readAfmBuilderPackV1(packInput);
if (!read.ok) throw new Error(`pack: ${read.code} ${read.path}`);
writeFileSync(join(here, 'demo-pack-grounded.json'), JSON.stringify(read.pack, null, 2));

// 2. Real rung-1 proposal for the implement step.
const prop = proposeAfmBuilderStepV1(read, {
  step: 'implement',
  checks: ['afm-v1-oracle', 'bridge-contract'],
  explanation: 'End-to-end rung-1 to rung-4 integration proof.',
});
if (!prop.ok) throw new Error(`proposal: ${prop.code} ${prop.path}`);
writeFileSync(join(here, 'demo-proposal.json'), JSON.stringify(prop.proposal, null, 2));

// 3. Real rung-2 plan via a caller-consented grant (bridge checks, fixed pin).
const grantPolicy = {
  checks: {
    'bridge-contract': ['node', '--test', 'windows-worker-contract.test.mjs'],
    'afm-v1-oracle': ['node', '--test', 'afm-internal-builder-v1.test.mjs'],
  },
  manifestHash: 'f'.repeat(63) + '0',
  budget: { timeoutSeconds: 120, outputBytes: 262144 },
};
const plan = planDeterministicTestRunV1(prop, grantPolicy);
if (!plan.ok) throw new Error(`plan: ${plan.code} ${plan.path}`);
writeFileSync(join(here, 'demo-plan.json'), JSON.stringify(plan.plan, null, 2));

// 4. Real rung-3 write plan: stage the two swift sources under the lane.
const stagingPolicy = {
  lane: LANE,
  files: { 'a.swift': 2048, 'b.swift': 2048 },
  manifestHash: grantPolicy.manifestHash,
};
const writePlan = planStagingWritesV1(plan, stagingPolicy);
if (!writePlan.ok) throw new Error(`write plan: ${writePlan.code} ${writePlan.path}`);
writeFileSync(join(here, 'demo-write-plan.json'), JSON.stringify(writePlan.writePlan, null, 2));

// 5. Real rung-4 compile plan: exact swiftc argv on the staged sources.
const compilePolicy = {
  invoke: ['swiftc', '-c', 'a.swift', 'b.swift', '-o', 'staged.o'],
  sources: { 'a.swift': SHA1, 'b.swift': SHA2 },
  output: 'staged.o',
  manifestHash: grantPolicy.manifestHash,
  budget: { timeoutSeconds: 120, outputBytes: 262144 },
};
const policyRead = readCompilePolicyV1(compilePolicy);
if (!policyRead.ok) throw new Error(`policy: ${policyRead.code} ${policyRead.path}`);
const compilePlan = planStagedCompileV1(writePlan, compilePolicy);
if (!compilePlan.ok) throw new Error(`compile plan: ${compilePlan.code} ${compilePlan.path}`);
writeFileSync(join(here, 'demo-compile-plan.json'), JSON.stringify(compilePlan.compilePlan, null, 2));

// 6. Generated self-contained compile-plan module, always a valid ESM file.
const source = stagedCompilePlanSourceV1(compilePlan);
writeFileSync(join(here, 'compile-plan-demo.mjs'), source);

const summary = [
  'Rung-4 grounded demo chain (real v1 -> v2 -> v3 -> v4 modules)',
  '',
  `planHash:            ${plan.plan.planHash}`,
  `stagingHash:         ${writePlan.writePlan.stagingHash}`,
  `compilePlanHash:     ${compilePlan.compilePlan.planHash}`,
  `manifest pin:        ${compilePlan.compilePlan.manifestHash}`,
  `packHash:            ${compilePlan.compilePlan.packHash}`,
  `lane:                ${compilePlan.compilePlan.lane}`,
  `invoke:              ${compilePlan.compilePlan.invoke.join(' ')}`,
  `noNetwork:           ${compilePlan.compilePlan.noNetwork}`,
  `sources:             ${compilePlan.compilePlan.sources.map((s) => `${s.name} (${s.sha256.slice(0, 8)}…)`).join(' | ')}`,
  `output:              ${compilePlan.compilePlan.output.name} @ ${compilePlan.compilePlan.output.path}`,
  `budget:              ${JSON.stringify(compilePlan.compilePlan.budget)}`,
  '',
  'Generated module:    evidence/compile-plan-demo.mjs (node --check PASS expected)',
];
writeFileSync(join(here, 'demo-chain-summary.txt'), summary.join('\n') + '\n');
console.log(summary.join('\n'));