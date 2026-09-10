// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0

// Reproducible benchmark for the canonical JSON codec.
//
// Run with: npm run bench
//
// Reports the admit path (well-formed input canonicalized and digested) and the
// refuse path (malformed input rejected with a named code) separately, because a
// gate is only useful if refusing is cheap. Every figure is a median of measured
// iterations on this machine; none is a claim about any other.

import { canonicalizeJSONV1, CANONICAL_JSON_LIMITS_V1 } from '../canonical/canonical-json-v1.mjs';

const enc = new TextEncoder();

function payload(targetBytes) {
  // Deterministic, mixed-shape document: nested objects, arrays, unicode,
  // unsorted keys — so the sort and escape paths both do real work.
  const rows = [];
  let size = 0;
  let i = 0;
  while (size < targetBytes) {
    const row = `{"z${i}":${i},"a":"vä\\u00e9l-${i}","n":[${i},${i + 1},null,true],"o":{"k${i}":"${'x'.repeat(8)}"}}`;
    rows.push(row);
    size += row.length + 1;
    i += 1;
  }
  return enc.encode(`[${rows.join(',')}]`);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function measure(label, bytes, fn, iterations) {
  for (let i = 0; i < Math.min(50, iterations); i += 1) fn();   // warm up
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - t0));
  }
  const ns = median(samples);
  return {
    label,
    bytes,
    medianMicroseconds: Number((ns / 1000).toFixed(3)),
    mibPerSecond: bytes ? Number(((bytes / (ns / 1e9)) / 1_048_576).toFixed(1)) : null,
    iterations,
  };
}

const admit = [1_024, 16_384, 262_144, 900_000].map((target) => {
  const input = payload(target);
  return measure(`admit ${(input.byteLength / 1024).toFixed(0)} KiB`, input.byteLength,
    () => canonicalizeJSONV1(input), 200);
});

// Refusal cases: each must reject, and rejecting must not cost more than admitting.
const refusals = [
  ['non-uint8array input', () => canonicalizeJSONV1({ a: 1 }), 'INVALID_JSON_INPUT'],
  ['over the byte cap', (() => {
    const big = enc.encode(`["${'x'.repeat(CANONICAL_JSON_LIMITS_V1.bytes + 16)}"]`);
    return () => canonicalizeJSONV1(big);
  })(), 'INVALID_JSON_SIZE'],
  ['depth over 128', (() => {
    const deep = enc.encode('['.repeat(200) + ']'.repeat(200));
    return () => canonicalizeJSONV1(deep);
  })(), 'INVALID_JSON_DEPTH'],
  ['malformed bytes', (() => {
    const bad = enc.encode('{"a":');
    return () => canonicalizeJSONV1(bad);
  })(), null],
].map(([label, fn]) => {
  let code = null;
  const guarded = () => {
    try { fn(); } catch (error) { code = error.code ?? error.name; }
  };
  const result = measure(`refuse ${label}`, 0, guarded, 200);
  return { ...result, code };
});

const report = {
  schemaVersion: 1,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  limits: CANONICAL_JSON_LIMITS_V1,
  admit,
  refuse: refusals,
};

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
console.log(`\nnisi canonical JSON v1 — ${report.node} on ${report.platform}\n`);
console.log(`  ${pad('case', 30)}${rpad('bytes', 10)}${rpad('median µs', 12)}   ${'result'}`);
console.log(`  ${'-'.repeat(74)}`);
for (const r of admit) {
  console.log(`  ${pad(r.label, 30)}${rpad(r.bytes.toLocaleString(), 10)}${rpad(r.medianMicroseconds, 12)}   ${r.mibPerSecond} MiB/s`);
}
for (const r of refusals) {
  console.log(`  ${pad(r.label, 30)}${rpad('—', 10)}${rpad(r.medianMicroseconds, 12)}   ${r.code ?? '—'}`);
}
console.log('');
if (process.env.NISI_BENCH_JSON) console.log(JSON.stringify(report, null, 2));
