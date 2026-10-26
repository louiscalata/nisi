import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedXpcJournalObservation} from '../src/index.mjs';
import {createRunJournal} from '../frozen/run-journal-v1.mjs';
test('pure projection entrypoint imports',()=>assert.equal(typeof fixedXpcJournalObservation,'function'));
test('frozen journal imports without I/O',()=>assert.equal(typeof createRunJournal,'function'));
