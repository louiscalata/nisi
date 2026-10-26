// Read-only, fixed package-relative inventory; not readiness or compatibility.
import fs from 'node:fs/promises';
import { CLI_VERSION } from './text.mjs';

export const DOCTOR_ASSETS = Object.freeze([
  'examples/repository-live-model.mjs', 'hosts/swift-verifier/build.mjs',
  'hosts/swift-verifier/main.swift', 'integrations/veritas/import-manifest.json',
  ...['ArtifactSnapshot.swift', 'StrictJSONDocumentValidator.swift', 'DeterministicChecks.swift'].map(name =>
    'integrations/veritas/native/macos/CodenameVeritasFramework/Sources/VeritasCore/' + name),
  ...['live-baseline/retry-settings.mjs', 'live-repair/retry-settings.mjs', 'baseline/config.json',
    'baseline/README.md', 'harness/check-retry-settings.mjs'].map(name => 'examples/repository-task/fixtures/' + name),
]);
const root = new URL('../', import.meta.url);

// Internal trusted dependency seam for inventory tests, never caller CLI flags.
export async function collectNisiDoctor({ nodeVersion = process.version, platform = process.platform,
  arch = process.arch, lstat = fs.lstat, readFile = fs.readFile } = {}) {
  let metadata = 'VALID', requiredNode = null;
  try {
    const url = new URL('package.json', root), stat = await lstat(url);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw Error();
    const value = JSON.parse(await readFile(url, 'utf8'));
    if (!['nisi', 'nisi-private-cli'].includes(value.name) || value.version !== CLI_VERSION || value.private !== true ||
        value.license !== 'UNLICENSED' || value.engines?.node !== '>=22') throw Error();
    requiredNode = value.engines.node;
  } catch { metadata = 'INVALID_OR_UNAVAILABLE'; }
  const version = typeof nodeVersion === 'string' && /^v(\d+)\.\d+\.\d+$/u.exec(nodeVersion);
  const nodeSupported = !!version && Number(version[1]) >= 22 && metadata === 'VALID';
  const assets = [];
  for (const relativePath of DOCTOR_ASSETS) {
    let status;
    try { const stat = await lstat(new URL(relativePath, root));
      status = stat.isFile() && !stat.isSymbolicLink() ? 'PRESENT' : 'NOT_REGULAR_FILE';
    } catch { status = 'UNAVAILABLE'; }
    assets.push({ relativePath, status });
  }
  const exitCode = nodeSupported && assets.every(a => a.status === 'PRESENT') ? 0 : 1;
  return { schemaVersion: 'nisi-cli-doctor/v1', status: exitCode === 0 ? 'INVENTORY_COMPLETE' : 'INCOMPLETE',
    version: CLI_VERSION, metadata, node: { version: version ? nodeVersion : null, required: requiredNode, supported: nodeSupported },
    platform, arch, assets, nativeTarget: 'arm64-apple-macosx27.0',
    sourceTrust: 'NOT_ASSESSED', inventoryOnly: true, inventoryScope: 'METADATA_AND_SELECTED_DEMO_ASSETS',
    nativeCompatibility: 'NOT_ASSESSED',
    moduleResolution: 'NOT_RUN', compiler: 'NOT_RUN', nativeExecution: 'NOT_RUN', modelInference: 'NOT_RUN',
    network: 'NOT_RUN', writeAccess: 'NOT_TESTED', readyForExecution: false, authorizing: false, exitCode };
}
