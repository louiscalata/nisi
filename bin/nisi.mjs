#!/usr/bin/env node
// Private checkout entry, including symlink invocation. Importing is inert apart
// from read-only entry identity comparison; no handlers or execution on import.
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

let direct = false, entryURL;
try {
  const physicalEntry = fs.realpathSync(fileURLToPath(import.meta.url));
  entryURL = pathToFileURL(physicalEntry);
  direct = !!process.argv[1] && fs.realpathSync(process.argv[1]) === physicalEntry;
} catch {}
if (direct) {
  // Catch stream error events as well as write callbacks (not global uncaught
  // exceptions). Broken output must never leave a success exit code or a stack.
  let outputFailed = false;
  const onError = () => { outputFailed = true; process.exitCode = 2; };
  process.stdout.on('error', onError); process.stderr.on('error', onError);
  const write = (stream, text) => new Promise((resolve, reject) => {
    if (!text) return resolve();
    stream.write(text, error => error ? reject(error) : resolve());
  });
  let formatError = () => JSON.stringify({ status: 'INCOMPLETE', code: 'NISI_CLI_STARTUP', hint: 'Use nisi --help.' }) + '\n';
  try {
    // Resolve from the real entry even with --preserve-symlinks-main. Missing or
    // malformed application modules fail within this sanitized startup boundary.
    const { errorOutput } = await import(new URL('../cli/text.mjs', entryURL));
    formatError = error => errorOutput(error).stderr;
    const { runNisiCli } = await import(new URL('../cli/main.mjs', entryURL));
    const result = await runNisiCli(process.argv.slice(2));
    await write(process.stdout, result.stdout); await write(process.stderr, result.stderr);
    process.exitCode = outputFailed ? 2 : result.exitCode;
  } catch (error) {
    process.exitCode = 2;
    try { await write(process.stderr, formatError(error)); } catch {}
  }
}
