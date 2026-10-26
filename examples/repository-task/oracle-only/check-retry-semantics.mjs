// PRIVATE oracle-only behavior checks. Executed only by the existing owned Node
// executor against exact reviewed fixture trees, never arbitrary model programs.
// Keep this entry outside the workflow baseline, suite and model payloads.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const schemaVersion = 'nisi-retry-oracle-v1';
function setupError() {
  process.exitCode = 2;
  console.log(JSON.stringify({ schemaVersion, status: 'ERROR', assertionsExecuted: 0,
    assertionsPassed: 0, failures: [], reason: 'ORACLE_SETUP_FAILED' }));
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !path.isAbsolute(args[0])) { setupError(); return; }
  let retryLimit;
  try {
    const module = await import(pathToFileURL(path.join(args[0], 'retry-settings.mjs')).href);
    retryLimit = module.retryLimit;
    if (typeof retryLimit !== 'function') throw Error('ORACLE_FUNCTION_MISSING');
  } catch { setupError(); return; }
  // Observe behavior, not source syntax, comments, a known answer or model claims.
  const checks = [
    ['explicit undefined uses the default', { retryLimit: undefined }, 3],
    ['interior integer one is preserved', { retryLimit: 1 }, 1],
    ['interior integer nine is preserved', { retryLimit: 9 }, 9],
    ['fractional number is rejected', { retryLimit: 2.5 }, RangeError],
    ['NaN is rejected', { retryLimit: Number.NaN }, RangeError],
    ['positive infinity is rejected', { retryLimit: Number.POSITIVE_INFINITY }, RangeError],
    ['negative infinity is rejected', { retryLimit: Number.NEGATIVE_INFINITY }, RangeError],
    ['boolean true is rejected', { retryLimit: true }, RangeError],
    ['bigint is rejected', { retryLimit: 2n }, RangeError],
    ['omitted input uses the default', undefined, 3],
    ['empty input uses the default', {}, 3],
    ['null retry limit uses the default', { retryLimit: null }, 3],
    ['zero is preserved', { retryLimit: 0 }, 0],
    ['upper boundary ten is preserved', { retryLimit: 10 }, 10],
    ['negative integer is rejected', { retryLimit: -1 }, RangeError],
    ['integer above ten is rejected', { retryLimit: 11 }, RangeError],
    ['numeric string is rejected', { retryLimit: '2' }, RangeError],
  ];
  const failures = [];
  for (const [name, input, expected] of checks) {
    let pass = false;
    try { const value = retryLimit(input); pass = expected !== RangeError && value === expected; }
    catch (error) { pass = expected === RangeError && error instanceof RangeError; }
    if (!pass) failures.push({ name, message: 'Behavior did not satisfy the declared retry contract' });
  }
  console.log(JSON.stringify({ schemaVersion, status: failures.length ? 'FAIL' : 'PASS',
    assertionsExecuted: checks.length, assertionsPassed: checks.length - failures.length, failures }));
}
await main().catch(setupError);
