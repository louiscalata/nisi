// Read-only request accounting. No dispatch, worker calls or counter mutation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const queue = JSON.parse(fs.readFileSync(new URL('./queue.json', import.meta.url)));
const jobs = [...queue.tasks.flatMap(task => task.jobs),
  ...queue.followups.flatMap(task => task.jobs), ...queue.diagnostics];
const ids = new Set();
for (const job of jobs) {
  assert.match(job.id, /^mac-\d{8}-\d{6}-[a-f0-9]+$/);
  assert.equal(ids.has(job.id), false, 'duplicate submitted-job accounting');
  ids.add(job.id);
}
assert.equal(queue.requestsSubmitted, ids.size, 'top-level request counter disagrees with actual job records');
assert.equal(queue.summary.requestCount, ids.size, 'summary counter disagrees with actual job records');
assert.ok(ids.size <= queue.maximumRequests, 'request cap exceeded');
console.log(JSON.stringify({status: 'PASS_ACCOUNTING_ONLY', requests: ids.size,
  cap: queue.maximumRequests, remainingBudget: queue.maximumRequests - ids.size,
  workerHealthVerified: false, authorizing: false}));
