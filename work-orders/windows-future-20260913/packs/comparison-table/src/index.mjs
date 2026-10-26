export function buildComparisonTable(input) {
  // Validate top-level structure
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== 'rows') return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
  const rows = input.rows;
  if (!Array.isArray(rows) || rows.length > 200) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
  const validUnits = ['TOKENS', 'MILLISECONDS', 'CHECKS'];
  const seenIds = new Set();
  for (const row of rows) {
    if (row === null || Array.isArray(row) || typeof row !== 'object') return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
    const rowKeys = Object.keys(row);
    if (rowKeys.length !== 5 || !rowKeys.every(k => ['id', 'label', 'off', 'on', 'unit'].includes(k))) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
    const { id, label, off, on, unit } = row;
    if (typeof id !== 'string' || id.length < 1 || id.length > 128 || seenIds.has(id)) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
    seenIds.add(id);
    if (typeof label !== 'string' || label.length < 1 || label.length > 128 || !validUnits.includes(unit)) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
    for (const value of [off, on]) {
      if (value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || Object.is(value, -0) || value > Number.MAX_SAFE_INTEGER) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
      if ((unit === 'TOKENS' || unit === 'CHECKS') && !Number.isInteger(value)) return { status: 'REFUSED', reason: 'INVALID_INPUT', authorizing: false };
    }
  }
  const processedRows = [];
  let knownPairs = 0;
  for (const row of rows) {
    const { off, on } = row;
    const known = off !== null && on !== null;
    const delta = known ? on - off : null;
    let relativeChangePercent = null;
    if (known && off > 0) {
      const value = (delta / off) * 100;
      if (Number.isFinite(value)) relativeChangePercent = value;
    }
    processedRows.push({ id: row.id, label: row.label, off, on, unit: row.unit, delta, relativeChangePercent });
    if (known) knownPairs++;
  }
  return {
    schemaVersion: 1,
    status: 'READY',
    rows: processedRows,
    summary: { total: rows.length, knownPairs, unknownPairs: rows.length - knownPairs },
    authorizing: false
  };
}
