// Private Nisi repository fixture: baseline retry-settings module.
// Intentional defect: uses || so explicit zero retries are replaced by 3.
export function retryLimit(input = {}) {
  const value = input.retryLimit || 3;
  if (!Number.isInteger(value) || value < 0 || value > 10)
    throw new RangeError('retryLimit must be an integer from 0 to 10');
  return value;
}
