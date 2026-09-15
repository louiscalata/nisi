#!/usr/bin/env node

import { createHash } from "node:crypto";

const PROFILE = "veritas-fi03-same-uid-cross-process-canonical-vector-v1";
const WORKER_VERSION = "fi03-independent-canonicalizer-v1";
const VECTOR_ID = "CANON-S5-009-FI0-INERT-INCIDENT-CONTRACT";
const FROZEN_VECTOR_SHA256 =
  "a07ba231b9a725252b9467d196fa88c23d82f9f1e8fa2f3711af0fb0553d7898";
const MAX_INPUT_BYTES = 128 * 1024;

class WorkerRefusal extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkerRefusal";
    this.code = code;
  }
}

function refuse(code) {
  throw new WorkerRefusal(code);
}

function canonicalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) refuse("REFUSE_UNREPRESENTABLE_VALUE");
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0)) {
      if (value[key] === undefined) refuse("REFUSE_UNREPRESENTABLE_VALUE");
      result[key] = canonicalize(value[key]);
    }
    return result;
  }
  refuse("REFUSE_UNREPRESENTABLE_VALUE");
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    refuse("REFUSE_ENVELOPE_SHAPE");
  }
  const observed = Object.keys(value).sort();
  const frozen = [...expected].sort();
  if (canonicalJson(observed) !== canonicalJson(frozen)) refuse("REFUSE_ENVELOPE_SHAPE");
}

function withResultDigest(value) {
  return { ...value, resultDigest: sha256(canonicalJson(value)) };
}

async function readBoundedStdin() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > MAX_INPUT_BYTES) refuse("REFUSE_INPUT_TOO_LARGE");
    chunks.push(bytes);
  }
  if (length === 0) refuse("REFUSE_EMPTY_INPUT");
  return Buffer.concat(chunks);
}

function parseExactEnvelope(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    refuse("REFUSE_BOM");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    refuse("REFUSE_INVALID_UTF8");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    refuse("REFUSE_INVALID_JSON");
  }
  if (text !== `${canonicalJson(parsed)}\n`) refuse("REFUSE_NONCANONICAL_ENVELOPE");
  exactKeys(parsed, ["schemaVersion", "profile", "vectorId", "value", "canonical", "sha256"]);
  if (parsed.schemaVersion !== 1) refuse("REFUSE_SCHEMA_VERSION");
  if (parsed.profile !== PROFILE) refuse("REFUSE_PROFILE_MISMATCH");
  if (parsed.vectorId !== VECTOR_ID) refuse("REFUSE_VECTOR_ID_MISMATCH");
  if (typeof parsed.canonical !== "string" || typeof parsed.sha256 !== "string") {
    refuse("REFUSE_ENVELOPE_SHAPE");
  }
  return parsed;
}

function verifyEnvelope(envelope) {
  const observedCanonical = canonicalJson(envelope.value);
  if (observedCanonical !== envelope.canonical) refuse("REFUSE_CANONICAL_MISMATCH");
  const observedSha256 = sha256(observedCanonical);
  if (observedSha256 !== envelope.sha256) refuse("REFUSE_DIGEST_MISMATCH");
  if (observedSha256 !== FROZEN_VECTOR_SHA256) refuse("REFUSE_FROZEN_DIGEST_MISMATCH");
  return withResultDigest({
    schemaVersion: 1,
    recordType: "FI03_CANONICAL_VECTOR_PROCESS_RESULT",
    profile: PROFILE,
    workerVersion: WORKER_VERSION,
    status: "PASS_PRIVATE_CROSS_PROCESS_CANONICAL_VECTOR_FIXTURE_ONLY",
    vectorId: VECTOR_ID,
    canonicalSha256: observedSha256,
    rawEnvelopeCanonical: true,
    canonicalMatches: true,
    digestMatches: true,
    frozenDigestMatches: true,
    processBoundaryObserved: true,
    independentToolchainVerified: false,
    authorizing: false,
    protectedAuthorityVerified: false,
    productIntegrationVerified: false,
  });
}

function refusalResult(code) {
  return withResultDigest({
    schemaVersion: 1,
    recordType: "FI03_CANONICAL_VECTOR_PROCESS_REFUSAL",
    profile: PROFILE,
    workerVersion: WORKER_VERSION,
    status: "REFUSED_EXPECTED",
    refusalCode: code,
    authorizing: false,
    protectedAuthorityVerified: false,
    productIntegrationVerified: false,
  });
}

let output;
let exitCode;
try {
  output = verifyEnvelope(parseExactEnvelope(await readBoundedStdin()));
  exitCode = 0;
} catch (error) {
  const code = error instanceof WorkerRefusal ? error.code : "REFUSE_WORKER_INTERNAL";
  output = refusalResult(code);
  exitCode = error instanceof WorkerRefusal ? 2 : 3;
}
process.stdout.write(`${canonicalJson(output)}\n`);
process.exitCode = exitCode;
