import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedXpcJournalObservation} from '../history/fixed-xpc-journal-observation-v1.mjs';
import {createRunJournal} from '../history/run-journal-v1.mjs';
test('pure projection entrypoint imports',()=>assert.equal(typeof fixedXpcJournalObservation,'function'));
test('frozen journal imports without I/O',()=>assert.equal(typeof createRunJournal,'function'));
