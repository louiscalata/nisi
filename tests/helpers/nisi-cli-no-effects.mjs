// Child-only guard; importing a CLI cannot launch processes, mutate files or use
// network and then hide the failed attempt in a sanitized response.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { syncBuiltinESMExports, register } from 'node:module';
let forbidden = 0;
let trialCaptures = 0;
let diagnosticCaptures = 0;
let sidecarCaptures = 0;
const deny = () => { forbidden++; throw Object.assign(Error('CLI_TEST_EFFECT'), { code: 'CLI_TEST_EFFECT' }); };
for (const name of ['mkdir', 'mkdtemp', 'writeFile', 'appendFile', 'rm', 'rmdir', 'unlink', 'rename', 'copyFile', 'cp',
  'chmod', 'fchmod', 'lchmod', 'chown', 'fchown', 'lchown', 'truncate', 'ftruncate', 'utimes', 'futimes', 'lutimes',
  'write', 'writev', 'symlink', 'link']) {
  fsp[name] = deny; fs[name] = deny; fs[name + 'Sync'] = deny;
}
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = deny;
for (const target of [http, https]) { target.request = deny; target.get = deny; target.createServer = deny; }
net.connect = deny; net.createConnection = deny; tls.connect = deny; globalThis.fetch = deny;
net.createServer = deny; tls.createServer = deny; dgram.createSocket = deny;
net.Socket.prototype.connect = deny; net.Server.prototype.listen = deny;
fs.createWriteStream = deny;
const eventPath = file => {
  const value = file instanceof URL ? fileURLToPath(file) : Buffer.isBuffer(file) ? file.toString('utf8') : file;
  return typeof value === 'string' && path.basename(value) === 'events.jsonl';
};
const diagnosticPath = file => {
  const value = file instanceof URL ? fileURLToPath(file) : Buffer.isBuffer(file) ? file.toString('utf8') : file;
  return typeof value === 'string' && /^repository-diagnostic-[a-f0-9]{64}\.json$/.test(path.basename(value));
};
const sidecarPath = file => {
  const value = file instanceof URL ? fileURLToPath(file) : Buffer.isBuffer(file) ? file.toString('utf8') : file;
  return typeof value === 'string' && path.basename(value) === 'arm-sidecar.jsonl';
};
// The reader's contract uses one opened descriptor. Alternate whole-file APIs
// cannot bypass the capture counter; these guards are tests, not an OS sandbox.
for (const [target, name] of [[fs, 'readFileSync'], [fs, 'readFile'], [fsp, 'readFile'], [fs, 'createReadStream']]) {
  const original = target[name]; target[name] = (file, ...rest) => {
    const descriptor = typeof file === 'number' || (file && typeof file === 'object' && !(file instanceof URL) && !Buffer.isBuffer(file));
    if (eventPath(file) || diagnosticPath(file) || sidecarPath(file) || descriptor || (name === 'createReadStream' && Number.isInteger(rest[0]?.fd))) return deny();
    return original.call(target, file, ...rest);
  };
}
for (const [target, name] of [[fsp, 'open'], [fs, 'open'], [fs, 'openSync']]) {
  const original = target[name]; target[name] = (file, flags, ...rest) => {
    if (eventPath(file)) trialCaptures++;
    if (diagnosticPath(file)) diagnosticCaptures++;
    if (sidecarPath(file)) sidecarCaptures++;
    const safeNumeric = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    if (!['r', 'rs', fs.constants.O_RDONLY, safeNumeric].includes(flags)) return deny();
    const opened = original.call(target, file, flags, ...rest);
    if (target !== fsp) return opened;
    return opened.then(handle => {
      for (const method of ['appendFile', 'write', 'writeFile', 'writev', 'chmod', 'chown', 'truncate', 'utimes',
        'createWriteStream', 'readFile', 'createReadStream', 'readLines']) handle[method] = deny;
      return handle;
    });
  };
}
syncBuiltinESMExports();
process.on('exit', () => {
  if (process.env.NISI_CLI_TEST_SINGLE_CAPTURE === '1' && trialCaptures !== 1) process.exitCode = 98;
  if (process.env.NISI_CLI_TEST_SINGLE_DIAGNOSTIC_CAPTURE === '1' && diagnosticCaptures !== 1) process.exitCode = 97;
  if (process.env.NISI_CLI_TEST_SINGLE_SIDECAR_CAPTURE === '1' && sidecarCaptures !== 1) process.exitCode = 96;
  if (forbidden) process.exitCode = 99;
});
if (process.env.NISI_CLI_TEST_ALLOW_DEMO !== '1') {
  const trialRoot = process.env.NISI_CLI_TEST_PACKAGE_ROOT;
  const allowTrial = process.env.NISI_CLI_TEST_ALLOW_TRIAL === '1' && typeof trialRoot === 'string' && path.isAbsolute(trialRoot);
  const allowed = allowTrial ? ['history/paired-trial-event-store-v1.mjs', 'history/paired-trial-event-codec-v1.mjs',
    'history/paired-trial-reconciliation-v1.mjs', 'hosts/repository/demo-state-v1.mjs',
    ...(process.env.NISI_CLI_TEST_ALLOW_ARM === '1' ? ['history/paired-arm-reconciliation-v1.mjs',
      'history/paired-arm-sidecar-store-v1.mjs', 'history/paired-arm-sidecar-codec-v1.mjs',
      'hosts/repository/execution-admission-v1.mjs'] : []),
    ...(process.env.NISI_CLI_TEST_ALLOW_DIAGNOSTIC === '1' ? ['history/repository-trial-diagnostic-v1.mjs', 'history/repository-trial-diagnostic-store-v1.mjs'] : [])]
    .map(file => pathToFileURL(path.join(fs.realpathSync(trialRoot), file)).href) : [];
  register(new URL('./nisi-cli-no-heavy-loader.mjs', import.meta.url), { data: { allowed } });
}
