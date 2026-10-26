// Pure bounded argument snapshot; no execution or approval is performed here.
import { isAbsolute } from 'node:path';
const invalid = () => { throw Object.assign(Error('NISI_CLI_ARGUMENTS'), { code: 'NISI_CLI_ARGUMENTS' }); };
export function parseNisiArguments(args) {
  if (!Array.isArray(args) || Object.getPrototypeOf(args) !== Array.prototype || args.length > 128) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(args);
  if (Reflect.ownKeys(descriptors).length !== args.length + 1) invalid();
  const copy = []; let length = 0;
  for (let i = 0; i < args.length; i++) {
    const d = descriptors[i];
    if (!d || !Object.hasOwn(d, 'value') || !d.enumerable || typeof d.value !== 'string' || d.value.length > 8192) invalid();
    length += d.value.length; if (length > 65536) invalid(); copy.push(d.value);
  }
  const first = copy[0];
  const command = first === undefined || ['help', '--help', '-h'].includes(first) ? 'help'
    : ['version', '--version', '-v'].includes(first) ? 'version'
    : first === 'doctor' ? 'doctor' : first === 'demo' ? 'demo' : first === 'inspect' ? 'inspect'
    : first === 'inspect-trial' ? 'inspect-trial' : first === 'inspect-arm-trial' ? 'inspect-arm-trial'
    : first === 'inspect-trial-diagnostic' ? 'inspect-trial-diagnostic' : null;
  const withArgs = ['demo', 'inspect', 'inspect-trial', 'inspect-arm-trial', 'inspect-trial-diagnostic'];
  if (!command || (!withArgs.includes(command) && copy.length > 1)) invalid();
  if (['inspect', 'inspect-trial', 'inspect-arm-trial', 'inspect-trial-diagnostic'].includes(command)
    && (copy.length !== 2 || !copy[1] || copy[1].length > 4096 || copy[1].includes('\0'))) invalid();
  if (['inspect-trial', 'inspect-arm-trial', 'inspect-trial-diagnostic'].includes(command) && !isAbsolute(copy[1])) invalid();
  return Object.freeze({ command, args: Object.freeze(withArgs.includes(command) ? copy.slice(1) : []) });
}
