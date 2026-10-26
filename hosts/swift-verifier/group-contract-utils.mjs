// PRIVATE object-reader support. Hostile proxies are outside this boundary.
export function closedList(value, maximum, code) {
  const fail = () => { throw Object.assign(new Error(code), { code }); };
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const d = Object.getOwnPropertyDescriptors(value), length = d.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Reflect.ownKeys(d).length !== length + 1) fail();
  return Array.from({ length }, (_, i) => {
    if (!d[i]?.enumerable || !Object.hasOwn(d[i], 'value')) fail();
    return d[i].value;
  });
}
