const refused = () => ({ status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false });
const statuses = new Set(['PASS', 'FAIL', 'NOT_RUN', 'ERROR', 'INCONCLUSIVE', 'CANCELLED', 'TIMED_OUT']);
const keysExactly = (value, keys) => {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every(key => Object.hasOwn(value, key));
};
const bounded = value => typeof value === 'string' && value.length >= 1 && value.length <= 128;
const safeNatural = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);
const duration = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && !Object.is(value, -0));

export function buildTimeline(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || !keysExactly(input, ['runId', 'events'])) return refused();
  const { runId, events } = input;
  if (!bounded(runId) || !Array.isArray(events) || events.length > 200) return refused();
  const seen = new Set();
  const checked = [];
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    if (event === null || typeof event !== 'object' || Array.isArray(event) ||
        !keysExactly(event, ['id', 'attempt', 'stage', 'status', 'createdAt', 'durationMs', 'receiptId'])) return refused();
    const { id, attempt, stage, status, createdAt, durationMs, receiptId } = event;
    if (!bounded(id) || seen.has(id) || !safeNatural(attempt) || !bounded(stage) || !statuses.has(status) ||
        !safeNatural(createdAt) || !duration(durationMs) ||
        !(receiptId === null || bounded(receiptId))) return refused();
    seen.add(id);
    checked.push({ id, attempt, stage, status, createdAt, durationMs, receiptId, index });
  }
  checked.sort((a, b) => b.attempt - a.attempt || a.createdAt - b.createdAt || a.index - b.index);
  const outputEvents = checked.map((event, index) => ({
    id: event.id, attempt: event.attempt, stage: event.stage, status: event.status,
    createdAt: event.createdAt, durationMs: event.durationMs, receiptId: event.receiptId, sequence: index + 1
  }));
  const groups = new Map();
  for (const event of checked) {
    if (!groups.has(event.attempt)) groups.set(event.attempt, { eventIds: [], unknownDurations: 0 });
    const group = groups.get(event.attempt);
    group.eventIds.push(event.id);
    if (event.durationMs === null) group.unknownDurations++;
  }
  const attempts = [...groups].map(([attempt, group]) => ({ attempt, ...group }));
  return { schemaVersion: 1, status: 'READY', runId, events: outputEvents, attempts, authorizing: false };
}
