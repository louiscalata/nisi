import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressChecklist } from '../src/index.mjs';

const BASIS = 'equal-weight milestone count; not effort, accuracy or release readiness';
const milestone = (patch = {}) => ({ id: 'm1', label: 'First milestone', state: 'OPEN', ...patch });
const refused = { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
const clone = value => JSON.parse(JSON.stringify(value));

test('empty checklist has exact shape, zero counts, and null percent', () => {
  assert.deepEqual(buildProgressChecklist({ title: 'Roadmap', milestones: [] }), {
    schemaVersion: 1,
    status: 'READY',
    title: 'Roadmap',
    rows: [],
    summary: { total: 0, closed: 0, open: 0, inProgress: 0, blocked: 0, percent: null },
    basis: BASIS,
    authorizing: false
  });
});

test('three closed of ten is exactly 30 percent and preserves order', () => {
  const milestones = Array.from({ length: 10 }, (_, index) => milestone({
    id: `m${index + 1}`,
    label: `Milestone ${index + 1}`,
    state: index < 3 ? 'CLOSED' : 'OPEN'
  }));
  const result = buildProgressChecklist({ title: 'Ten steps', milestones });
  assert.deepEqual(result.rows, milestones);
  assert.deepEqual(result.summary, { total: 10, closed: 3, open: 7, inProgress: 0, blocked: 0, percent: 30 });
});

test('one closed of three floors to 33 rather than rounding up', () => {
  const milestones = [milestone({ state: 'CLOSED' }), milestone({ id: 'm2' }), milestone({ id: 'm3' })];
  assert.equal(buildProgressChecklist({ title: 'Thirds', milestones }).summary.percent, 33);
});

test('all closed is 100 and all open is 0', () => {
  const closed = [milestone({ state: 'CLOSED' }), milestone({ id: 'm2', state: 'CLOSED' })];
  assert.equal(buildProgressChecklist({ title: 'Done', milestones: closed }).summary.percent, 100);
  assert.equal(buildProgressChecklist({ title: 'Open', milestones: [milestone()] }).summary.percent, 0);
});

test('in-progress and blocked milestones are counted but never complete', () => {
  const milestones = [
    milestone({ state: 'CLOSED' }),
    milestone({ id: 'm2', state: 'IN_PROGRESS' }),
    milestone({ id: 'm3', state: 'BLOCKED' }),
    milestone({ id: 'm4', state: 'OPEN' })
  ];
  assert.deepEqual(buildProgressChecklist({ title: 'Mixed', milestones }).summary,
    { total: 4, closed: 1, open: 1, inProgress: 1, blocked: 1, percent: 25 });
});

test('output copies title and rows and is isolated from later input mutation', () => {
  const input = { title: 'Original', milestones: [milestone()] };
  const result = buildProgressChecklist(input);
  input.title = 'Changed';
  input.milestones[0].label = 'Changed';
  input.milestones.push(milestone({ id: 'm2' }));
  assert.equal(result.title, 'Original');
  assert.deepEqual(result.rows, [milestone()]);
  assert.notEqual(result.rows, input.milestones);
});

test('equivalent ordinary JSON input is deterministic and supports non-ASCII labels', () => {
  const input = { title: '進捗 Café', milestones: [milestone({ label: 'Étape 一' })] };
  const first = buildProgressChecklist(clone(input));
  assert.deepEqual(first, buildProgressChecklist(clone(input)));
  assert.equal(first.title, '進捗 Café');
  assert.equal(first.rows[0].label, 'Étape 一');
});

test('refuses missing, extra, and wrongly typed top-level fields exactly', () => {
  for (const input of [
    {}, { title: 'x' }, { milestones: [] }, { title: 'x', milestones: [], extra: true },
    { title: '', milestones: [] }, { title: 1, milestones: [] }, { title: 'x'.repeat(129), milestones: [] },
    { title: 'x', milestones: null }, { title: 'x', milestones: {} }
  ]) assert.deepEqual(buildProgressChecklist(input), refused);
});

test('refuses malformed milestone shapes and unknown states', () => {
  for (const bad of [
    {}, null, ['x'], { ...milestone(), extra: true },
    { id: 'm1', label: 'x' }, milestone({ state: 'PARTIAL' }), milestone({ state: 'closed' }), milestone({ state: null })
  ]) assert.deepEqual(buildProgressChecklist({ title: 'x', milestones: [bad] }), refused);
});

test('refuses invalid milestone text, duplicate ids, and more than 200 rows', () => {
  for (const patch of [{ id: '' }, { id: 3 }, { id: 'x'.repeat(129) }, { label: '' }, { label: null }, { label: 'x'.repeat(129) }]) {
    assert.deepEqual(buildProgressChecklist({ title: 'x', milestones: [milestone(patch)] }), refused);
  }
  assert.deepEqual(buildProgressChecklist({ title: 'x', milestones: [milestone(), milestone({ label: 'Different' })] }), refused);
  const milestones = Array.from({ length: 201 }, (_, index) => milestone({ id: `m${index}` }));
  assert.deepEqual(buildProgressChecklist({ title: 'x', milestones }), refused);
});

test('dangerous ordinary-JSON keys are refused without prototype effects', () => {
  const before = Object.prototype.polluted;
  const top = JSON.parse('{"title":"x","milestones":[],"__proto__":{"polluted":true}}');
  const nested = JSON.parse('{"id":"m1","label":"x","state":"OPEN","prototype":"bad"}');
  assert.deepEqual(buildProgressChecklist(top), refused);
  assert.deepEqual(buildProgressChecklist({ title: 'x', milestones: [nested] }), refused);
  assert.equal(Object.prototype.polluted, before);
});
