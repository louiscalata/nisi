import { canonicalizeJsonV1, createCandidate, createTaskSpecification } from 'nisi';
import { Buffer } from 'node:buffer';
const result = canonicalizeJsonV1(Buffer.from('{"a":1}'));
const candidate = createCandidate({ files: [{ path: 'a.mjs', content: 'export const a = 1;' }] }, { authorId: 'author.one' });
const task = createTaskSpecification({ taskId: 'task.one', mode: 'edit', language: 'javascript', allowedFiles: ['a.mjs'], protectedFiles: [], protectedSnapshots: {}, acceptanceCriteria: ['fixed oracle'], policy: { repairBudget: 1, totalDeadlineMs: 1000, requiredReviewers: 1, requireReportStore: false } });
const fingerprint: string = candidate.fingerprint;
void [result, task, fingerprint];
