const refused = () => ({ status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false });
const exactKeys = (value, expected) => {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every(key => Object.hasOwn(value, key));
};
const bounded = value => typeof value === 'string' && value.length >= 1 && value.length <= 128;
const availabilities = new Set(['AVAILABLE', 'UNAVAILABLE', 'UNKNOWN']);
const locations = new Set(['LOCAL', 'REMOTE', 'UNKNOWN']);

export function buildModelCatalog(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || !exactKeys(input, ['models'])) return refused();
  const { models } = input;
  if (!Array.isArray(models) || models.length > 200) return refused();
  const seen = new Set();
  const rows = [];
  let available = 0, unavailable = 0, unknown = 0, local = 0, remote = 0, unknownLocation = 0;
  for (const model of models) {
    if (model === null || typeof model !== 'object' || Array.isArray(model) ||
        !exactKeys(model, ['id', 'provider', 'label', 'availability', 'location'])) return refused();
    const { id, provider, label, availability, location } = model;
    if (!bounded(id) || seen.has(id) || !bounded(provider) || !bounded(label) ||
        !availabilities.has(availability) || !locations.has(location)) return refused();
    seen.add(id);
    rows.push({ id, provider, label, availability, location });
    if (availability === 'AVAILABLE') available++;
    else if (availability === 'UNAVAILABLE') unavailable++;
    else unknown++;
    if (location === 'LOCAL') local++;
    else if (location === 'REMOTE') remote++;
    else unknownLocation++;
  }
  return {
    schemaVersion: 1,
    status: 'READY',
    rows,
    counts: { total: rows.length, available, unavailable, unknown, local, remote, unknownLocation },
    authorizing: false
  };
}
