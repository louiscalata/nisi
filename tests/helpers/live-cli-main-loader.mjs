// Test-only import boundary. The CLI source/control flow is not rewritten.
// Only direct collaborators are inert; no production injection API is added.
let cliURL;
const modules = new Map();
export function initialize({ target }) {
  cliURL = target;
  for (const [specifier, exports] of [
    ['node:fs/promises', ['default:fs']],
    ['./repository-task/reviewed-live-fixture-v1.mjs', ['createReviewedLiveFixtureV1:fixture']],
    ['../hosts/repository/reviewed-live-model-v1.mjs', ['createReviewedLiveModelLaneV1:lane', 'createReviewedLiveModelLaneV2:lane']],
    ['../hosts/repository/reviewed-live-model-v3.mjs', ['createReviewedLiveModelLaneV3:lane']],
    ['../hosts/repository/reviewed-workflow-v1.mjs', ['createReviewedRepositoryHostV1:host']],
    ['../hosts/swift-verifier/build.mjs', ['buildNativeArtifactKernel:build']],
    ['../receipts/repository-live-model-run-v1.mjs', ['createRepositoryLiveModelRunV1:receipt', 'readRepositoryLiveModelRunV1:readReceipt',
      'createRepositoryLiveModelRunV2:receipt', 'readRepositoryLiveModelRunV2:readReceipt']],
    ['../receipts/repository-live-model-run-v3.mjs', ['createRepositoryLiveModelRunV3:receipt', 'readRepositoryLiveModelRunV3:readReceipt']],
  ]) modules.set(specifier, exports);
}
export function resolve(specifier, context, nextResolve) {
  if (context.parentURL === cliURL && modules.has(specifier))
    return { url: `nisi-live-cli-test:${encodeURIComponent(specifier)}`, shortCircuit: true };
  return nextResolve(specifier, context);
}
export function load(url, context, nextLoad) {
  if (!url.startsWith('nisi-live-cli-test:')) return nextLoad(url, context);
  const exports = modules.get(decodeURIComponent(url.slice('nisi-live-cli-test:'.length)));
  if (!exports) throw new Error('Unknown CLI test import');
  const prefix = "const state=()=>globalThis[Symbol.for('nisi.live-cli.main-test')];\n";
  const source = prefix + exports.map(entry => {
    const [name, method] = entry.split(':');
    if (name === 'default') return `export default Object.freeze(Object.fromEntries(['mkdir','mkdtemp','writeFile'].map(k=>[k,(...a)=>state().fs[k](...a)])));`;
    return `export const ${name}=(...args)=>state().${method}(...args);`;
  }).join('\n');
  return { format: 'module', source, shortCircuit: true };
}
