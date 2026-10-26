// The no-effect commands must not even load the side-effect-capable demo graph.
let allowed = new Set();
export function initialize(data) { allowed = new Set(data?.allowed ?? []); }
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (/\/(examples|hosts|adapters|history|receipts)\//u.test(result.url) && !allowed.has(result.url)) throw Error('CLI_TEST_HEAVY_IMPORT');
  return result;
}
