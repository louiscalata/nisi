const refused = () => ({ status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false });
const exact = (value, names) => {
  const keys = Object.keys(value);
  return keys.length === names.length && names.every(name => Object.hasOwn(value, name));
};
const bounded = value => typeof value === 'string' && value.length >= 1 && value.length <= 128;
const escaped = new Set('<>&"\'|\\`#[]()*_!');
const control = code => code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 ||
  (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
function escape(value) {
  let output = '';
  for (const character of value) {
    const code = character.codePointAt(0);
    output += escaped.has(character) || control(code) ? `&#x${code.toString(16).toUpperCase()};` : character;
  }
  return output;
}

export function renderStatusCard(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || !exact(input, ['title', 'fields'])) return refused();
  const { title, fields } = input;
  if (!bounded(title) || !Array.isArray(fields) || fields.length > 50) return refused();
  for (const field of fields) {
    if (field === null || typeof field !== 'object' || Array.isArray(field) || !exact(field, ['label', 'value'])) return refused();
    const { label, value } = field;
    if (!bounded(label)) return refused();
    if (value !== null && typeof value !== 'string' && typeof value !== 'number') return refused();
    if (typeof value === 'string' && value.length > 2048) return refused();
    if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || Object.is(value, -0))) return refused();
  }
  let markdown = `# ${escape(title)}\n\n| Field | Value |\n| --- | --- |\n`;
  if (fields.length === 0) markdown += '| Status | No fields supplied |\n';
  else for (const { label, value } of fields) markdown += `| ${escape(label)} | ${escape(value === null ? 'UNKNOWN' : String(value))} |\n`;
  return { schemaVersion: 1, status: 'READY', markdown, authorizing: false };
}
