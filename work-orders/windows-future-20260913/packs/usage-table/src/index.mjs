export function buildUsageTable(input) {
  if (input == null || Array.isArray(input) || typeof input !== 'object') return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
  const rootKeys = Object.keys(input);
  if (rootKeys.length !== 2 || !Object.hasOwn(input, 'runId') || !Object.hasOwn(input, 'rows')) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
  
  const {runId, rows} = input;
  
  if (typeof runId !== 'string' || runId.length < 1 || runId.length > 128) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
  
  if (!Array.isArray(rows) || rows.length > 200) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
  
  const requiredRowKeys = ['id','stage','provider','model','inputTokens','outputTokens','reasoningTokens','durationMs'];
  const allowedProviderModel = (v) => v === null || (typeof v === 'string' && v.length >= 1 && v.length <= 128);
  const isSafeNonNegativeInteger = (v) => typeof v === 'number' && v >= 0 && v <= Number.MAX_SAFE_INTEGER && Number.isInteger(v) && !Object.is(v, -0);
  const isFiniteNonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && !Object.is(v, -0);
  
  const seenIds = new Set();
  const validatedRows = [];
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row == null || typeof row !== 'object' || Array.isArray(row)) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    
    const keys = Object.keys(row);
    if (keys.length !== requiredRowKeys.length) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    
    for (const k of requiredRowKeys) {
      if (!keys.includes(k)) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    }
    
    const {id, stage, provider, model, inputTokens, outputTokens, reasoningTokens, durationMs} = row;
    
    if (typeof id !== 'string' || id.length < 1 || id.length > 128 || seenIds.has(id)) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    seenIds.add(id);
    
    if (typeof stage !== 'string' || stage.length < 1 || stage.length > 128) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    
    if (!allowedProviderModel(provider) || !allowedProviderModel(model)) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    
    const inputNull = inputTokens === null;
    const outputNull = outputTokens === null;
    const reasoningNull = reasoningTokens === null;
    
    if (!inputNull && !isSafeNonNegativeInteger(inputTokens)) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    if (!outputNull && !isSafeNonNegativeInteger(outputTokens)) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    if (!reasoningNull && !isSafeNonNegativeInteger(reasoningTokens)) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    
    if (!reasoningNull && !outputNull && reasoningTokens > outputTokens) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    
    const durationNull = durationMs === null;
    if (!durationNull && !isFiniteNonNegative(durationMs)) return {status:'REFUSED',reason:'INVALID_INPUT',authorizing:false};
    
    validatedRows.push({
      id,
      stage,
      provider,
      model,
      inputTokens,
      outputTokens,
      reasoningTokens,
      durationMs,
      totalTokens: (!inputNull && !outputNull && inputTokens + outputTokens <= Number.MAX_SAFE_INTEGER) ? inputTokens + outputTokens : null
    });
  }
  
  let inputTotal = 0, outputTotal = 0, reasoningTotal = 0, totalTokensTotal = 0, durationTotal = 0;
  let inputUnknown = false, outputUnknown = false, reasoningUnknown = false, totalTokensUnknown = false, durationUnknown = false;
  let unknownRows = 0;
  
  for (const row of validatedRows) {
    if (row.inputTokens === null || row.outputTokens === null || row.reasoningTokens === null || row.durationMs === null) {
      unknownRows++;
    }
    
    if (row.inputTokens === null) inputUnknown = true;
    else inputTotal += row.inputTokens;
    
    if (row.outputTokens === null) outputUnknown = true;
    else outputTotal += row.outputTokens;
    
    if (row.reasoningTokens === null) reasoningUnknown = true;
    else reasoningTotal += row.reasoningTokens;
    
    if (row.totalTokens === null) totalTokensUnknown = true;
    else totalTokensTotal += row.totalTokens;
    
    if (row.durationMs === null) durationUnknown = true;
    else durationTotal += row.durationMs;
  }
  
  if (inputUnknown) inputTotal = null;
  else if (!isFinite(inputTotal) || inputTotal > Number.MAX_SAFE_INTEGER) inputTotal = null;
  
  if (outputUnknown) outputTotal = null;
  else if (!isFinite(outputTotal) || outputTotal > Number.MAX_SAFE_INTEGER) outputTotal = null;
  
  if (reasoningUnknown) reasoningTotal = null;
  else if (!isFinite(reasoningTotal) || reasoningTotal > Number.MAX_SAFE_INTEGER) reasoningTotal = null;
  
  if (totalTokensUnknown) totalTokensTotal = null;
  else if (!isFinite(totalTokensTotal) || totalTokensTotal > Number.MAX_SAFE_INTEGER) totalTokensTotal = null;
  
  if (durationUnknown) durationTotal = null;
  else if (!isFinite(durationTotal) || durationTotal > Number.MAX_SAFE_INTEGER) durationTotal = null;
  
  const outputRows = validatedRows.map(r => ({
    id: r.id,
    stage: r.stage,
    provider: r.provider,
    model: r.model,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    reasoningTokens: r.reasoningTokens,
    durationMs: r.durationMs,
    totalTokens: r.totalTokens
  }));
  
  return {
    schemaVersion: 1,
    status: 'READY',
    runId: runId,
    rows: outputRows,
    totals: {
      inputTokens: inputTotal,
      outputTokens: outputTotal,
      reasoningTokens: reasoningTotal,
      totalTokens: totalTokensTotal,
      durationMs: durationTotal
    },
    unknownRows: unknownRows,
    authorizing: false
  };
}
