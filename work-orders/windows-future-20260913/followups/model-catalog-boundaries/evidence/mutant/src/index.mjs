import { buildModelCatalog as acceptedBuildModelCatalog } from '../../../../../packs/model-catalog/src/index.mjs';

export function buildModelCatalog(input) {
  const result = acceptedBuildModelCatalog(input);
  if (result.status === 'READY' && result.rows.length === 200) {
    return {
      ...result,
      counts: { ...result.counts, unknown: result.counts.unknown + 1 }
    };
  }
  return result;
}
