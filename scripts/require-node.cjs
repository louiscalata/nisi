// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
const requirement = require('../package.json').engines.node;
const requirementMatch = /^>=(\d+)$/.exec(requirement);
const minimumMajor = requirementMatch ? Number(requirementMatch[1]) : NaN;

function validateNodeVersion(version = process.version) {
  if (!Number.isSafeInteger(minimumMajor)) throw new Error('Unsupported Node requirement in package.json.');
  const match = typeof version === 'string' && /^v(\d+)\.\d+\.\d+$/.exec(version);
  if (!match) return { ok: false, code: 'NODE_VERSION_INVALID', message: 'Cannot identify a stable Node.js version. Install or switch to a supported Node release.' };
  if (Number(match[1]) < minimumMajor) {
    return { ok: false, code: 'NODE_VERSION_TOO_OLD', message: `Nisi requires Node.js ${minimumMajor} or newer; found ${version}. Install or switch Node, then rerun this command.` };
  }
  return { ok: true };
}

module.exports = { validateNodeVersion };
if (require.main === module) {
  const result = validateNodeVersion();
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
  }
}
