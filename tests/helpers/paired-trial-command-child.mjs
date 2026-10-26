// Test-only fixed host: no inference, network, subprocesses or generated code.
import fs from 'node:fs';
import { createPairedTrialCommandOwnerV1 } from '../../cli/paired-trial-command-owner.mjs';
import { pairedTrialCommandFixture, deferredTrialValue } from './paired-trial-command-fixture.mjs';
const [parentDirectory, nonce] = process.argv.slice(2);
if (!/^[a-f0-9]{32}$/.test(nonce ?? '')) throw Error('TEST_NONCE');
const f = pairedTrialCommandFixture(), result = deferredTrialValue(), settled = deferredTrialValue();
let owner, state = 'BUSY', cancels = 0;
const keepAlive = setInterval(() => {}, 1000);
const write = value => fs.writeSync(1, JSON.stringify({ nonce, pid: process.pid, ...value }) + '\n');
f.host.startExecutor = () => {
  write({ type: 'READY', directory: owner.inspect().storage.directory });
  return { result: result.promise, settled: settled.promise, status: () => state,
    cancel() { cancels++; state = 'OFF'; result.reject(Error('test cancellation')); settled.resolve(); } };
};
try {
  owner = createPairedTrialCommandOwnerV1({ plan: f.plan, profile: f.profile, host: f.host, parentDirectory });
  const report = await owner.run();
  write({ type: 'REPORT', recorded: report.recorded, setup: report.setup, firstSignal: report.firstSignal,
    lastStopRequest: report.lastStopRequest, cleanup: report.cleanup, stopReason: report.ledger?.stopReason,
    completed: report.ledger?.counts.completed, executorStarted: report.ledger?.counts.executorStarted,
    oracleStarted: report.ledger?.counts.oracleStarted, drainStatus: report.ledger?.drain?.status,
    cancels, listeners: [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')], authorizing: report.authorizing });
  process.exitCode = report.recorded ? 0 : 1;
} finally { clearInterval(keepAlive); }
