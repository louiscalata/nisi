const refused = () => ({ status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false });
const basis = 'equal-weight milestone count; not effort, accuracy or release readiness';
const states = new Set(['OPEN', 'IN_PROGRESS', 'CLOSED', 'BLOCKED']);
const exact = (value, names) => {
  const keys = Object.keys(value);
  return keys.length === names.length && names.every(name => Object.hasOwn(value, name));
};
const bounded = value => typeof value === 'string' && value.length >= 1 && value.length <= 128;

export function buildProgressChecklist(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || !exact(input, ['title', 'milestones'])) return refused();
  const { title, milestones } = input;
  if (!bounded(title) || !Array.isArray(milestones) || milestones.length > 200) return refused();
  const seen = new Set();
  const rows = [];
  for (const milestone of milestones) {
    if (milestone === null || typeof milestone !== 'object' || Array.isArray(milestone) ||
        !exact(milestone, ['id', 'label', 'state'])) return refused();
    const { id, label, state } = milestone;
    if (!bounded(id) || seen.has(id) || !bounded(label) || !states.has(state)) return refused();
    seen.add(id);
    rows.push({ id, label, state });
  }
  let closed = 0, open = 0, inProgress = 0, blocked = 0;
  for (const row of rows) {
    if (row.state === 'CLOSED') closed++;
    else if (row.state === 'OPEN') open++;
    else if (row.state === 'IN_PROGRESS') inProgress++;
    else blocked++;
  }
  const total = rows.length;
  return {
    schemaVersion: 1,
    status: 'READY',
    title,
    rows,
    summary: { total, closed, open, inProgress, blocked, percent: total ? Math.floor(closed * 100 / total) : null },
    basis,
    authorizing: false
  };
}
