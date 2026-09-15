// PRIVATE shallow intake, based on a tool-disabled Fable 5.1 draft.
// Callers supply fixed trusted keys/bounds and validate every nested value.
// Hostile Proxy traps or modified JavaScript intrinsics are outside this boundary.
const fail = code => { throw Object.assign(new Error(code), { code }); };
const dataDesc = (target, key) => {
  const d = Reflect.getOwnPropertyDescriptor(target, key);
  return d && d.enumerable && Object.hasOwn(d, 'value') ? d : null;
};
export function record(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('TRIAL_RECORD');
  const proto = Reflect.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail('TRIAL_RECORD');
  if (new Set(keys).size !== keys.length || Reflect.ownKeys(value).length !== keys.length) fail('TRIAL_RECORD');
  const out = {};
  for (const key of keys) {
    if (typeof key !== 'string') fail('TRIAL_RECORD');
    const d = dataDesc(value, key); if (!d) fail('TRIAL_RECORD');
    Object.defineProperty(out, key, { value: d.value, writable: true, enumerable: true, configurable: true });
  }
  return out;
}
export function list(value, min, max) {
  if (!Array.isArray(value) || Reflect.getPrototypeOf(value) !== Array.prototype) fail('TRIAL_LIST');
  const n = Reflect.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(n) || n < min || n > max || Reflect.ownKeys(value).length !== n + 1) fail('TRIAL_LIST');
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = dataDesc(value, String(i)); if (!d) fail('TRIAL_LIST'); out[i] = d.value;
  }
  return out;
}
export function natural(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail('TRIAL_NUMBER');
  return value;
}
export function add(a, b) {
  const sum = natural(a) + natural(b); if (!Number.isSafeInteger(sum)) fail('TRIAL_OVERFLOW'); return sum;
}
