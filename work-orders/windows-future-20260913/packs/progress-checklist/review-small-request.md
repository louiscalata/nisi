Independent static review of ONE complete small pure module. No tools or execution claims. Input domain is ordinary JSON, not exotic JS objects. Return <=1000 characters, JSON {"status":"NO_FINDINGS_SCOPED"|"FINDINGS","sourceSha256":"36b1439f433d5c7a2f8663e8aef412c3be9f6404e7c6578f8f2213d7d1d01984","findings":[{"line":1,"issue":"concrete violation","example":"counterexample"}],"limitation":"static review only"}. Do not rewrite code.

Complete contract: dependency-free synchronous ESM, only named export buildProgressChecklist. No imports/IO/network/process/eval/clocks; no input mutation or aliases to mutable input rows. Reject malformed input with exactly {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false}, never throw on ordinary JSON. Exact root {title,milestones}; title string length1..128; milestones array max200; each exact {id,label,state}, id/label strings length1..128, IDs unique, state OPEN|IN_PROGRESS|CLOSED|BLOCKED. Reject null/arrays/unknown keys where object required. READY exact {schemaVersion:1,status:'READY',title,rows:[copied milestones in order],summary:{total,closed,open,inProgress,blocked,percent},basis:'equal-weight milestone count; not effort, accuracy or release readiness',authorizing:false}. percent=floor(closed*100/total), null for empty. Only CLOSED counts. No effort/accuracy/release claims. Check every line against this contract; flag only concrete violations.

Source SHA256 36b1439f433d5c7a2f8663e8aef412c3be9f6404e7c6578f8f2213d7d1d01984
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
