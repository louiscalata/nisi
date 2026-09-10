// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Canonical JSON rejects non-finite numbers.");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort(compareCodePoints)) {
      if (value[key] === undefined) {
        throw new Error(`Canonical JSON rejects undefined at ${key}.`);
      }
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  throw new Error(`Canonical JSON rejects ${typeof value}.`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Canonical(value) {
  return sha256Bytes(canonicalJson(value));
}

export async function readJson(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

export async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

export function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const observed = Object.keys(value).sort(compareCodePoints);
  const wanted = [...expected].sort(compareCodePoints);
  if (canonicalJson(observed) !== canonicalJson(wanted)) {
    throw new Error(`${label} keys differ: ${canonicalJson({ observed, wanted })}`);
  }
  return value;
}

export function emitDeterministic(value) {
  process.stdout.write(`${canonicalJson(value)}\n`);
}
