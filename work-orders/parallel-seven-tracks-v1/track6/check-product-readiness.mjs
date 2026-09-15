import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const STATES = new Set(['PASS', 'PASS_SCOPED', 'READY', 'VERIFIED', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE', 'FAIL', 'REQUIRES_AUTHORITY']);
const REQUIRED_LANES = ['portable', 'native', 'windows', 'install', 'evaluation'];
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bad = (reason, details = {}) => Object.freeze({schemaVersion: 1, status: 'ERROR', reason, authorizing: false, ...details});
function safeRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const parts = value.split(/[\\/]/);
  return parts.every(part => part && part !== '.' && part !== '..');
}
function resolveDeclared(root, relative) {
  if (!safeRelative(relative)) throw new Error('UNSAFE_RELATIVE_PATH');
  const absolute = path.resolve(root, relative);
  const rootResolved = fs.realpathSync(root);
  if (absolute !== rootResolved && !absolute.startsWith(rootResolved + path.sep)) throw new Error('PATH_ESCAPE');
  let cursor = rootResolved;
  for (const part of relative.split(/[\\/]/)) {
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('SYMLINK_NOT_ALLOWED');
  }
  const realTarget = fs.realpathSync(absolute);
  if (realTarget !== rootResolved && !realTarget.startsWith(rootResolved + path.sep)) throw new Error('PATH_ESCAPE');
  const stat = fs.lstatSync(realTarget);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('NOT_REGULAR_FILE');
  return realTarget;
}
function readReceipt(root, declaration) {
  if (!plain(declaration) || !safeRelative(declaration.path) || !/^[a-f0-9]{64}$/.test(declaration.sha256 ?? ''))
    return {status: 'ERROR', reason: 'INVALID_RECEIPT_DECLARATION'};
  try {
    const file = resolveDeclared(root, declaration.path);
    const stat = fs.statSync(file);
    if (stat.size > MAX_RECEIPT_BYTES) return {status: 'ERROR', reason: 'RECEIPT_TOO_LARGE'};
    const bytes = fs.readFileSync(file);
    if (sha256(bytes) !== declaration.sha256) return {status: 'INCONCLUSIVE', reason: 'RECEIPT_DIGEST_MISMATCH'};
    let receipt;
    try { receipt = JSON.parse(bytes.toString('utf8')); } catch { return {status: 'ERROR', reason: 'MALFORMED_RECEIPT'}; }
    if (!plain(receipt) || typeof receipt.status !== 'string' || !STATES.has(receipt.status)) return {status: 'ERROR', reason: 'INVALID_RECEIPT'};
    return {status: receipt.status, reason: receipt.reason ?? null, receipt};
  } catch (error) { return {status: 'NOT_RUN', reason: error.code === 'ENOENT' ? 'MISSING_RECEIPT' : error.message}; }
}
function checkPin(root, pin) {
  if (!plain(pin) || !safeRelative(pin.path) || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? '')) return {status: 'ERROR', reason: 'INVALID_SOURCE_PIN'};
  try {
    const file = resolveDeclared(root, pin.path);
    return sha256(fs.readFileSync(file)) === pin.sha256 ? {status: 'PASS'} : {status: 'INCONCLUSIVE', reason: 'SOURCE_DRIFT'};
  } catch (error) { return {status: error.code === 'ENOENT' ? 'NOT_RUN' : 'ERROR', reason: error.message}; }
}
export function checkProductReadiness(input, {root = process.cwd()} = {}) {
  if (!plain(input) || input.schemaVersion !== 'nisi-product-readiness-input/v1' || !Array.isArray(input.receipts) || !Array.isArray(input.sourcePins) || !Array.isArray(input.gates))
    return bad('INVALID_INPUT');
  if (input.receipts.length > 64 || input.sourcePins.length > 256 || input.gates.length > 32) return bad('INPUT_LIMIT');
  let rootResolved;
  try { rootResolved = fs.realpathSync(root); if (!fs.statSync(rootResolved).isDirectory()) throw new Error('ROOT_NOT_DIRECTORY'); } catch { return bad('INVALID_ROOT'); }
  const receiptMap = new Map();
  for (const declaration of input.receipts) {
    if (!plain(declaration) || typeof declaration.id !== 'string' || receiptMap.has(declaration.id)) return bad('INVALID_RECEIPT_ID');
    receiptMap.set(declaration.id, readReceipt(rootResolved, declaration));
  }
  const pins = input.sourcePins.map(pin => checkPin(rootResolved, pin));
  const inventory = plain(input.featureInventory) && Array.isArray(input.featureInventory.required) && Array.isArray(input.featureInventory.observed)
    ? {required: [...input.featureInventory.required], observed: [...input.featureInventory.observed], complete: input.featureInventory.required.length > 0 && input.featureInventory.required.every(x => input.featureInventory.observed.includes(x))}
    : {required: [], observed: [], complete: false};
  const source = {declared: input.sourcePins.length, checked: pins.length, pass: pins.length > 0 && pins.every(x => x.status === 'PASS'), states: pins.map(x => x.status)};
  const gates = {};
  for (const lane of REQUIRED_LANES) {
    const declaration = input.gates.find(g => plain(g) && g.lane === lane);
    if (!declaration || typeof declaration.id !== 'string' || typeof declaration.receiptId !== 'string') { gates[lane] = {status: 'NOT_RUN', reason: 'MISSING_GATE'}; continue; }
    const receipt = receiptMap.get(declaration.receiptId);
    if (!receipt) { gates[lane] = {status: 'ERROR', reason: 'UNKNOWN_RECEIPT'}; continue; }
    const acceptable = receipt.receipt && plain(receipt.receipt.sourceManifest) && Object.keys(receipt.receipt.sourceManifest).length > 0 && (receipt.status === 'PASS' || receipt.status === 'PASS_SCOPED' || receipt.status === 'READY' || receipt.status === 'VERIFIED');
    gates[lane] = {status: acceptable ? 'PASS' : receipt.status, reason: receipt.reason ?? null, receiptId: declaration.receiptId, historicalStatus: receipt.status};
    if (!acceptable && (receipt.status === 'PASS' || receipt.status === 'PASS_SCOPED' || receipt.status === 'READY' || receipt.status === 'VERIFIED') && (!plain(receipt.receipt?.sourceManifest) || Object.keys(receipt.receipt?.sourceManifest ?? {}).length === 0))
      gates[lane] = {...gates[lane], status: 'INCONCLUSIVE', reason: 'MISSING_SOURCE_MANIFEST'};
    if (acceptable && receipt.receipt && plain(receipt.receipt.sourceManifest)) {
      const drift = Object.entries(receipt.receipt.sourceManifest).some(([p, h]) => !safeRelative(p) || !/^[a-f0-9]{64}$/.test(h) || checkPin(rootResolved, {path: p, sha256: h}).status !== 'PASS');
      if (drift) gates[lane] = {...gates[lane], status: 'INCONCLUSIVE', reason: 'CURRENT_SOURCE_DRIFT'};
    }
  }
  gates.features = inventory.complete ? {status: 'PASS', reason: null} : {status: 'INCONCLUSIVE', reason: 'FEATURE_INVENTORY_INCOMPLETE'};
  const required = [...REQUIRED_LANES, 'features'];
  const ready = source.pass && required.every(lane => gates[lane]?.status === 'PASS');
  return Object.freeze({schemaVersion: 1, status: ready ? 'PASS_SCOPED' : 'INCONCLUSIVE', ready, authorizing: false, lanes: gates, source, featureInventory: inventory});
}
