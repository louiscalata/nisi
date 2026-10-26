// Fixed process boundary for the restart demo. Owns stdin parsing and the
// one-line response envelope; the module under test is synchronous and pure.
import { runBundleDemoRequest } from '../../history/bundle-restart-demo.mjs';
let text = '';
for await (const chunk of process.stdin) {
  text += chunk;
  if (Buffer.byteLength(text) > 65536) process.exit(2);
}
try {
  const request = JSON.parse(text);
  const result = runBundleDemoRequest(request);
  if (result?.then) throw new Error('asynchronous worker forbidden');
  process.stdout.write(JSON.stringify({ schema: 'nisi-bundle-demo-child/v1', pid: process.pid, result }) + '\n');
} catch (error) {
  process.stderr.write('BUNDLE_DEMO_ERROR\n');
  process.exitCode = 2;
}
