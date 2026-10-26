import { runRecoveryRequest } from '../src/recovery-worker.mjs';
let text = '';
for await (const chunk of process.stdin) {
  text += chunk;
  if (Buffer.byteLength(text) > 65536) process.exit(2);
}
try {
  const request = JSON.parse(text);
  const result = runRecoveryRequest(request);
  if (result?.then) throw new Error('asynchronous worker forbidden');
  process.stdout.write(JSON.stringify({ schema: 'nisi-recovery-child/v1', pid: process.pid, result }) + '\n');
} catch (error) {
  process.stderr.write('RECOVERY_WORKER_ERROR\n');
  process.exitCode = 2;
}
