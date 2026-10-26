let mode;
export function initialize(data) { mode = data.mode; }
const demo = new URL('../../examples/repository-live-model.mjs', import.meta.url).href;
const parser = new URL('../../cli/arguments.mjs', import.meta.url).href;
const main = new URL('../../cli/main.mjs', import.meta.url).href;
const text = new URL('../../cli/text.mjs', import.meta.url).href;
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if ((mode === 'startup-main' && resolved.url === main) || (mode === 'startup-text' && resolved.url === text))
    throw Error('/private/CLI_TEST_SECRET');
  if (resolved.url === demo) return { url: new URL('./nisi-cli-demo-double.mjs', import.meta.url).href, shortCircuit: true };
  if (mode === 'unknown-dispatch' && resolved.url === parser)
    return { url: new URL('./nisi-cli-parser-double.mjs', import.meta.url).href, shortCircuit: true };
  return resolved;
}
