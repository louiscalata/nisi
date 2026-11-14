// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
// Read the one packed-package entry from `npm pack --json` stdout.
// npm 10 and 11 print an array of entries; npm 12 prints an object keyed by
// package name. A single bare entry object is also accepted.

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function selectEntry(parsed, packageName) {
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      throw new Error(`npm pack --json: expected exactly one packed package, got ${parsed.length}.`);
    }
    return parsed[0];
  }
  if (!isPlainObject(parsed)) throw new Error('npm pack --json: unexpected npm pack --json shape.');
  if (Object.hasOwn(parsed, 'filename')) return parsed;
  if (Object.hasOwn(parsed, packageName)) return parsed[packageName];
  const values = Object.values(parsed);
  if (values.length === 1) return values[0];
  throw new Error(`npm pack --json: no entry for package ${packageName}.`);
}

export function readPackInfo(stdout, packageName) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`npm pack --json output is not JSON: ${error.message}`);
  }
  const entry = selectEntry(parsed, packageName);
  if (!isPlainObject(entry)) throw new Error('npm pack --json: unexpected npm pack --json shape.');
  if (entry.name !== undefined && entry.name !== packageName) {
    throw new Error(`npm pack --json: entry is for package ${entry.name}, expected ${packageName}.`);
  }
  const { filename, files } = entry;
  if (typeof filename !== 'string' || filename === '' || /[\\/]/.test(filename) || filename === '..') {
    throw new Error('npm pack --json: entry has no usable archive filename.');
  }
  if (!Array.isArray(files)
    || !files.every(file => isPlainObject(file) && typeof file.path === 'string' && file.path !== '')) {
    throw new Error('npm pack --json: entry has no usable files list.');
  }
  return entry;
}
