import test from 'node:test';
import assert from 'node:assert/strict';
import {openJournalOwner, inspectJournalOwner, recordJournalObservation, maintainJournalOwner} from '../history/journal-owner-v2.mjs';
import {createRunJournal} from '../history/run-journal-v1.mjs';
import {memfs} from './journal-owner-v2.memfs.mjs';
import {CONFIG, PATH, entry, simpleRefusal, assertDeepFrozen} from './journal-owner-v2.helper.mjs';

// Every handler records a trap before throwing or forwarding it. A correct
// refusal never asks a Proxy about its keys, prototype, values, or descriptors.
function proxyCase(target, mode) {
  const calls = [];
  const handler = Object.fromEntries(['get', 'set', 'getPrototypeOf', 'setPrototypeOf',
    'ownKeys', 'getOwnPropertyDescriptor', 'defineProperty', 'deleteProperty',
    'has', 'isExtensible', 'preventExtensions', 'apply', 'construct'].map(name => [name,
      (...args) => { calls.push(name); if (mode === 'throwing') throw Error('trap'); return Reflect[name](...args); }]));
  const pair = Proxy.revocable(target, handler);
  if (mode === 'revoked') pair.revoke();
  return {value: pair.proxy, calls};
}
const open = m => openJournalOwner({path: PATH, fs: m.fs, config: CONFIG, now: 100});
const record = (owner, row, now = 100) => recordJournalObservation({owner, entry: row, now});
const inspection = owner => inspectJournalOwner({owner}).snapshot;
const nullObject = value => Object.assign(Object.create(null), value);

for (const mode of ['throwing', 'transparent', 'revoked']) {
  for (const operation of ['open', 'inspect', 'record', 'maintain']) {
    test(`${mode} Proxy request: ${operation} refuses without traps or IO`, () => {
      const m = memfs(), opened = open(m), before = m.events.length;
      const requests = {
        open: [{path: PATH, fs: m.fs, config: CONFIG, now: 100}, openJournalOwner],
        inspect: [{owner: opened.owner}, inspectJournalOwner],
        record: [{owner: opened.owner, entry: entry(), now: 100}, recordJournalObservation],
        maintain: [{owner: opened.owner, now: 100}, maintainJournalOwner],
      };
      const [request, fn] = requests[operation], proxy = proxyCase(request, mode);
      const result = fn(proxy.value);
      if (operation === 'maintain') assert.deepEqual(result, {
        schemaVersion: 'nisi-journal-maintenance/v1', status: 'REFUSED', reason: 'INVALID_INPUT',
        store: null, snapshot: null, meaning: 'HISTORY_OBSERVATIONS_ONLY', authorizing: false,
      });
      else assert.deepEqual(result, simpleRefusal('INVALID_INPUT'));
      assertDeepFrozen(result); assert.deepEqual(proxy.calls, []);
      assert.equal(m.events.length, before); assert.equal(inspection(opened.owner), opened.snapshot);
    });
  }
  for (const location of ['config', 'redactPaths']) {
    test(`${mode} Proxy ${location}: owner and direct journal reject before traps`, () => {
      const m = memfs(), proxy = proxyCase(location === 'config' ? {...CONFIG} : [...CONFIG.redactPaths], mode);
      const config = location === 'config' ? proxy.value : {...CONFIG, redactPaths: proxy.value};
      assert.deepEqual(openJournalOwner({path: PATH, fs: m.fs, config, now: 100}), simpleRefusal('INVALID_INPUT'));
      assert.throws(() => createRunJournal(config), {code: 'CONFIG'});
      assert.deepEqual(proxy.calls, []); assert.equal(m.events.length, 0);
    });
  }
  for (const location of ['entry', 'payload', 'nestedObject', 'nestedArray']) {
    test(`${mode} Proxy ${location}: owner and direct journal reject before traps`, () => {
      const m = memfs(), opened = open(m), before = m.events.length;
      const source = entry();
      const targets = {entry: source, payload: source.payload, nestedObject: {note: 'x'}, nestedArray: ['x']};
      const proxy = proxyCase(targets[location], mode);
      const row = location === 'entry' ? proxy.value : location === 'payload' ? {...source, payload: proxy.value}
        : {...source, payload: {...source.payload, extra: proxy.value}};
      const result = record(opened.owner, row);
      assert.deepEqual(result, {schemaVersion: 'nisi-journal-owner/v2', status: 'REFUSED', reason: 'ENTRY',
        entryId: null, append: null, store: null, snapshot: opened.snapshot, authorizing: false});
      assertDeepFrozen(result); assert.equal(inspection(opened.owner), opened.snapshot);
      assert.equal(m.events.length, before);
      const journal = createRunJournal(CONFIG), serialized = journal.serialize();
      assert.throws(() => journal.append(row, 100), {code: 'ENTRY'});
      assert.equal(journal.serialize(), serialized); assert.deepEqual(proxy.calls, []);
      // A refusal must not leave the owner busy or prevent a later valid write.
      assert.equal(record(opened.owner, entry('valid-after-refusal')).status, 'RECORDED');
    });
  }
  for (const targetKind of ['object', 'function']) {
    test(`${mode} Proxy filesystem ${targetKind}: reject capability wrapper without traps`, () => {
      const m = memfs(), target = targetKind === 'object' ? m.fs : Object.assign(function trustedFs() {}, m.fs);
      const proxy = proxyCase(target, mode);
      assert.deepEqual(openJournalOwner({path: PATH, fs: proxy.value, config: CONFIG, now: 100}), simpleRefusal('INVALID_INPUT'));
      assert.deepEqual(proxy.calls, []); assert.equal(m.events.length, 0);
    });
  }
  test(`${mode} Proxy forged owner handle: remains invalid without traps`, () => {
    const m = memfs(), opened = open(m), proxy = proxyCase(opened.owner, mode), before = m.events.length;
    assert.deepEqual(inspectJournalOwner({owner: proxy.value}), simpleRefusal('INVALID_INPUT'));
    assert.deepEqual(record(proxy.value, entry()), simpleRefusal('INVALID_INPUT'));
    assert.equal(maintainJournalOwner({owner: proxy.value, now: 100}).reason, 'INVALID_INPUT');
    assert.deepEqual(proxy.calls, []); assert.equal(m.events.length, before);
  });
}

test('valid null-prototype config and nested entry data preserve serialization and redaction', () => {
  const m = memfs(), config = nullObject({...CONFIG, redactPaths: [...CONFIG.redactPaths]});
  const opened = openJournalOwner({path: PATH, fs: m.fs, config, now: 100});
  assert.equal(opened.status, 'OPENED');
  const source = entry(), row = nullObject({...source, payload: nullObject(source.payload)});
  const direct = createRunJournal(config); direct.append(row, 100);
  const result = record(opened.owner, row);
  assert.equal(result.status, 'RECORDED'); assert.equal(m.bytes(PATH).toString(), direct.serialize());
  assert.equal(row.payload.secret, '/synthetic/private');
  assert.equal(result.snapshot.entries[0].entry.payload.secret, '[REDACTED]');
  assertDeepFrozen(result);
});

test('clock refusal precedes invalid entry as before and touches no Proxy traps', () => {
  const m = memfs(), opened = open(m);
  assert.equal(record(opened.owner, entry(), 100).status, 'RECORDED');
  const snapshot = inspection(opened.owner), disk = Buffer.from(m.bytes(PATH)), before = m.events.length;
  const proxy = proxyCase(entry('later'), 'throwing');
  const result = record(opened.owner, proxy.value, 99);
  assert.equal(result.status, 'REFUSED'); assert.equal(result.reason, 'TIME');
  assert.equal(result.snapshot, snapshot); assert.equal(m.events.length, before);
  assert.equal(m.bytes(PATH).equals(disk), true); assert.deepEqual(proxy.calls, []);
});
