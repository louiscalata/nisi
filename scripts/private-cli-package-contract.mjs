// Private executable distribution, separate from the library archive.
// This is an exact reviewed closure, not a recursive directory allowlist.
import assert from 'node:assert/strict';
export const PRIVATE_CLI_MODULES = Object.freeze([
  'bin/nisi.mjs', 'cli/arguments.mjs', 'cli/doctor.mjs', 'cli/main.mjs', 'cli/text.mjs',
  'cli/inspect.mjs', 'cli/stored-summary-v1.mjs', 'cli/paired-trial-inspect.mjs',
  'cli/paired-trial-diagnostic-inspect.mjs',
  'cli/paired-arm-inspect.mjs',
  'evaluation/intake-v1.mjs', 'evaluation/metrics-v1.mjs', 'evaluation/paired-trial-v1.mjs',
  'evaluation/prevention-experiment-plan-v1.mjs', 'evaluation/prevention-execution-profile-v1.mjs',
  'adapters/local-chat.mjs', 'adapters/native-chat-protocol-v1.mjs', 'adapters/native-chat-v1.mjs',
  'adapters/repair-guidance-v1.mjs',
  'canonical/canonical-json-v1.mjs', 'examples/repository-live-model.mjs',
  'examples/repository-task/reviewed-live-fixture-v1.mjs',
  'history/journal-owner-v2.mjs', 'history/repository-host-history-v1.mjs',
  'history/repository-incident-candidates-v1.mjs', 'history/repository-incident-capture-v1.mjs',
  'history/run-journal-store-v1.mjs', 'history/run-journal-v1.mjs',
  'history/paired-trial-event-codec-v1.mjs', 'history/paired-trial-event-store-v1.mjs', 'history/paired-trial-reconciliation-v1.mjs',
  'history/repository-trial-diagnostic-v1.mjs', 'history/repository-trial-diagnostic-store-v1.mjs',
  'history/paired-arm-reconciliation-v1.mjs', 'history/paired-arm-sidecar-codec-v1.mjs',
  'history/paired-arm-sidecar-store-v1.mjs',
  'hosts/history/review-repository-history-v1.mjs', 'hosts/history/review-repository-incidents-v1.mjs',
  'hosts/history/terminal-history-prompt-v1.mjs', 'hosts/repository/demo-state-v1.mjs',
  'hosts/repository/execution-coordinator-v1.mjs', 'hosts/repository/host-evidence-v1.mjs',
  'hosts/repository/execution-admission-v1.mjs',
  'hosts/repository/live-demo-execution-v1.mjs', 'hosts/repository/live-model-selection-v3.mjs',
  'hosts/repository/live-owner-status-v1.mjs', 'hosts/repository/native-incident-source-v1.mjs',
  'hosts/repository/node-adapter-v1.mjs', 'hosts/repository/node-executor-v1.mjs',
  'hosts/repository/node-suite-v1.mjs', 'hosts/repository/proposed-changes-v1.mjs',
  'hosts/repository/reviewed-live-model-v1.mjs', 'hosts/repository/reviewed-live-model-v3.mjs',
  'hosts/repository/reviewed-workflow-v1.mjs', 'hosts/repository/snapshot-contract.mjs',
  'hosts/repository/task-materialization-owner-v1.mjs', 'hosts/repository/task-workspace-v1.mjs',
  'hosts/swift-verifier/build.mjs', 'hosts/swift-verifier/check-plan-v1.mjs',
  'hosts/swift-verifier/executor.mjs', 'hosts/swift-verifier/group-adapter-v1.mjs',
  'hosts/swift-verifier/group-contract-utils.mjs', 'hosts/swift-verifier/owned-child.mjs',
  'hosts/swift-verifier/protocol.mjs', 'hosts/swift-verifier/reservation.mjs',
  'integrity/record-utils.mjs', 'receipts/host-run-bundle-v2.mjs', 'receipts/live-usage-v1.mjs',
  'receipts/repository-execution-v1.mjs', 'receipts/repository-live-model-run-v1.mjs',
  'receipts/repository-live-model-run-v3.mjs', 'receipts/repository-run-v1.mjs',
  'receipts/swift-static-group-v1.mjs', 'receipts/swift-static-run-v1.mjs',
  'workflow/contracts.mjs', 'workflow/engine.mjs',
].sort());
export const PRIVATE_CLI_ASSETS = Object.freeze([
  'examples/repository-task/fixtures/live-baseline/retry-settings.mjs',
  'examples/repository-task/fixtures/live-repair/retry-settings.mjs',
  'examples/repository-task/fixtures/baseline/config.json',
  'examples/repository-task/fixtures/baseline/README.md',
  'examples/repository-task/fixtures/harness/check-retry-settings.mjs',
  'hosts/swift-verifier/main.swift', 'integrations/veritas/import-manifest.json',
  ...['ArtifactSnapshot.swift', 'StrictJSONDocumentValidator.swift', 'DeterministicChecks.swift'].map(name =>
    'integrations/veritas/native/macos/CodenameVeritasFramework/Sources/VeritasCore/' + name),
].sort());
export const PRIVATE_CLI_PACKAGE_FILES = Object.freeze([...PRIVATE_CLI_MODULES, ...PRIVATE_CLI_ASSETS, 'package.json'].sort());
export function createPrivateCliPackageMetadata(source) {
  assert.equal(source?.name, 'nisi');
  assert.equal(source.version, '0.2.0-private.0');
  assert.equal(source.private, true); assert.equal(source.license, 'UNLICENSED');
  assert.equal(source.engines?.node, '>=22');
  // Do not inherit scripts, dependencies, repository URLs, wildcard exports or
  // public README material from the source library metadata.
  return { name: 'nisi-private-cli', version: source.version, private: true, license: 'UNLICENSED',
    type: 'module', engines: { node: '>=22' }, bin: { nisi: 'bin/nisi.mjs' },
    files: PRIVATE_CLI_PACKAGE_FILES.filter(file => file !== 'package.json') };
}
