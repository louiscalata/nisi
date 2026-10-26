import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cases, CASE_COUNT } from './fixtures/scheduler-quota-oracle.mjs';
import { decideSlotAdmission } from '../neural/shared-work-slot-scheduler.mjs';

test('independent quota table preserves exact cardinality, order and values', () => {
  assert.equal(CASE_COUNT, 4828);
  assert.equal(cases.length, 4828);
  assert.equal(createHash('sha256').update(JSON.stringify(cases)).digest('hex'),
    '9fd7dddd52354dfdd3ae29fe9def118003a5440c5569cd9ff6c220e0729d0163');
  assert(Object.isFrozen(cases));
  assert(cases.every(Object.isFrozen));
});

test('pure admission decisions match all 4828 independent small-state rows', () => {
  for (const row of cases) {
    const { S, T, C, queued, kind, expected } = row;
    const decision = decideSlotAdmission({ windowSlots:S, totalAdmitted:T,
      courierAdmitted:C, courierQueued:queued, kind });
    // The reference models queue emptiness; the pure helper only permits a try.
    const observed = decision === 'ALLOW'
      ? kind === 'PRIMARY' ? 'PRIMARY_ADMITTED' : queued ? 'COURIER_ADMITTED' : 'EMPTY'
      : decision;
    assert.equal(observed, expected, JSON.stringify(row));
  }
});

test('quota table has unique states and covers every configured small capacity', () => {
  assert.equal(new Set(cases.map(({S,T,C,queued,kind}) => `${S}/${T}/${C}/${queued}/${kind}`)).size, 4828);
  assert.deepEqual([...new Set(cases.map(row => row.S))], Array.from({length:30}, (_,i) => i+1));
  assert(cases.some(row => row.expected === 'COURIER_RESERVED'));
  assert(cases.some(row => row.expected === 'EMPTY'));
});

test('GPT-OSS proposed counterexample correctly reserves all five remaining courier slots', () => {
  assert.equal(decideSlotAdmission({windowSlots:100, totalAdmitted:95,
    courierAdmitted:5, courierQueued:1, kind:'PRIMARY'}), 'COURIER_RESERVED');
  assert.equal(decideSlotAdmission({windowSlots:100, totalAdmitted:95,
    courierAdmitted:5, courierQueued:0, kind:'PRIMARY'}), 'ALLOW');
});
