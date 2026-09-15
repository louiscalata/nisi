export function renderStatusCard(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
  if (Object.keys(input).length !== 2 || !('title' in input) || !('fields' in input)) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
  
  const { title, fields } = input;
  
  if (typeof title !== 'string' || title.length < 1 || title.length > 128) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
  
  if (!Array.isArray(fields) || fields.length > 50) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
  
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (typeof field !== 'object' || field === null || Array.isArray(field)) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
    if (Object.keys(field).length !== 2 || !('label' in field) || !('value' in field)) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
    
    const { label, value } = field;
    if (typeof label !== 'string' || label.length < 1 || label.length > 128) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
    
    if (value !== null) {
      if (typeof value === 'string') {
        if (value.length > 2048) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER || Object.is(value, -0)) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
      } else {
        return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
      }
    }
  }
  
  function escapeChar(c) {
    const code = c.charCodeAt(0);
    const hex = code.toString(16).toUpperCase();
    return '&#x' + hex + ';';
  }
  
  function escape(str) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      const code = c.charCodeAt(0);
      if (c === '<' || c === '>' || c === '&' || c === '"' || c === "'" || c === '|' || c === '\\' || c === '`' || c === '#' || c === '[' || c === ']' || c === '(' || c === ')' || c === '*' || c === '_' || c === '!') {
        result += escapeChar(c);
      } else if ((code >= 0x0000 && code <= 0x001F) || code === 0x007F || (code >= 0x0080 && code <= 0x009F) || code === 0x2028 || code === 0x2029 || (code >= 0x202A && code <= 0x202E) || (code >= 0x2066 && code <= 0x2069)) {
        result += escapeChar(c);
      } else {
        result += c;
      }
    }
    return result;
  }
  
  let markdown = '# ' + escape(title) + '\n\n| Field | Value |\n| --- | --- |\n';
  
  if (fields.length === 0) {
    markdown += '| Status | No fields supplied |\n';
  } else {
    for (let i = 0; i < fields.length; i++) {
      const { label, value } = fields[i];
      const displayValue = value === null ? 'UNKNOWN' : String(value);
      markdown += '| ' + escape(label) + ' | ' + escape(displayValue) + ' |\n';
    }
  }
  
  return { schemaVersion: 1, status: 'READY', markdown, authorizing: false };
}
