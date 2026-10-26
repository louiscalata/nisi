// Private Nisi repository fixture: behavior-test harness for retry-settings.
// Uses only node:fs, node:path, node:url. Prints exactly one JSON result line.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ASSERTIONS_TOTAL = 10;
const SCHEMA_VERSION = 'nisi-retry-fixture-v1';

function reportSetupError() {
  process.exitCode = 2;
  console.log(
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      status: 'ERROR',
      assertionsExecuted: 0,
      assertionsPassed: 0,
      failures: [],
      reason: 'FIXTURE_SETUP_FAILED',
    })
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !path.isAbsolute(args[0])) {
    reportSetupError();
    return;
  }
  const root = args[0];

  let config;
  try {
    config = JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8'));
  } catch {
    reportSetupError();
    return;
  }

  let retryLimit;
  try {
    const mod = await import(pathToFileURL(path.join(root, 'retry-settings.mjs')).href);
    retryLimit = mod.retryLimit;
    if (typeof retryLimit !== 'function') throw new Error('Missing fixture function');
  } catch {
    reportSetupError();
    return;
  }

  const checks = [
    { name: 'omitted input defaults to 3', value: undefined, expected: 3 },
    { name: 'empty object defaults to 3', value: {}, expected: 3 },
    { name: 'null retryLimit defaults to 3', value: { retryLimit: null }, expected: 3 },
    { name: 'explicit zero retries stays 0', value: { retryLimit: 0 }, expected: 0 },
    { name: 'retryLimit 2 stays 2', value: { retryLimit: 2 }, expected: 2 },
    { name: 'retryLimit 10 stays 10', value: { retryLimit: 10 }, expected: 10 },
    { name: 'negative retryLimit throws RangeError', value: { retryLimit: -1 }, throws: RangeError },
    { name: 'retryLimit above 10 throws RangeError', value: { retryLimit: 11 }, throws: RangeError },
    { name: 'non-integer retryLimit throws RangeError', value: { retryLimit: '2' }, throws: RangeError },
    { name: 'loaded config object returns 0', value: config, expected: 0 },
  ];

  const failures = [];
  for (const check of checks) {
    try {
      const result = retryLimit(check.value);
      if (check.throws) {
        failures.push({
          name: check.name,
          message: 'expected ' + check.throws.name + ' but no throw occurred',
        });
      } else if (result !== check.expected) {
        failures.push({
          name: check.name,
          message: 'expected ' + check.expected + ' but got ' + result,
        });
      }
    } catch (err) {
      if (!check.throws || !(err instanceof check.throws)) {
        failures.push({
          name: check.name,
          message: 'unexpected ' + (err instanceof Error ? err.name : 'error') + ' thrown',
        });
      }
    }
  }

  console.log(
    JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      status: failures.length === 0 ? 'PASS' : 'FAIL',
      assertionsExecuted: ASSERTIONS_TOTAL,
      assertionsPassed: ASSERTIONS_TOTAL - failures.length,
      failures,
    })
  );
}

await main().catch(reportSetupError);
