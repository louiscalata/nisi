// Private Nisi successor primitives. No legacy digest/profile fallback.
import {createHash} from 'node:crypto';
import {canonicalizeJSONV1} from '../canonical/canonical-json-v1.mjs';
import {cloneFreeze} from '../workflow/contracts.mjs';

export const refuse = code => { throw Object.assign(new Error(code), {code}); };
export const isId = value => typeof value === 'string' && /^[a-z][a-z0-9_.-]{0,95}$/.test(value);
export const isDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null,Object.prototype].includes(Object.getPrototypeOf(value))) refuse(code);
  const own=Reflect.ownKeys(value);
  if(own.length!==keys.length||own.some(key=>typeof key!=='string'||!keys.includes(key)||
      !Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value') ||
      !Object.getOwnPropertyDescriptor(value,key).enumerable))refuse(code);
}
// Public intake is raw bytes: the codec rejects duplicates, fractions, malformed
// Unicode and unsupported byte views before JSON.parse creates any live object.
export const read = bytes => cloneFreeze(JSON.parse(canonicalizeJSONV1(bytes).canonical));
export const canonical = capturedValue => canonicalizeJSONV1(Buffer.from(JSON.stringify(cloneFreeze(capturedValue)))).canonical;
export const digest = (domain, capturedValue) => createHash('sha256').update(domain+'\0'+canonical(capturedValue)).digest('hex');
