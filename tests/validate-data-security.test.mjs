// Copyright 2026 Louis Calata
// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../history/validate-data.mjs';
import { invalidReports, validReports, validateReport } from './validate-data-security-cases.mjs';

for (const [name, report] of invalidReports) {
  test(`workflow report refuses ${name}`, () => {
    const summary = validateReport(validateData, report);
    assert.equal(summary.status, 'FAIL');
    assert.equal(summary.failed, 1);
    assert.equal(summary.files[0].reason, 'REPORT_SHAPE');
    assert.doesNotMatch(JSON.stringify(summary), /STORE_FAILURE|invented/);
  });
}
for (const [name, report] of validReports) {
  test(`workflow report preserves ${name}`, () => {
    assert.equal(validateReport(validateData, report).status, 'PASS');
  });
}
