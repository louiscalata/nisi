// Independent mathematical oracle for the frozen shared-work-slot contract.
// It intentionally imports no scheduler implementation or fixture code.

const KINDS = Object.freeze(['PRIMARY', 'COURIER']);
const QUEUED = Object.freeze([0, 1]);

/**
 * Decide only the fixed-window admission boundary. Inputs are the state before
 * one attempted admission: S slots, T total admissions, C courier admissions,
 * whether queued courier work exists, and the attempted kind.
 */
export function expectedDecision({ S, T, C, queued, kind }) {
  if (!Number.isInteger(S) || S < 1 || S > 30) throw new RangeError('S');
  if (!Number.isInteger(T) || T < 0 || T > S) throw new RangeError('T');
  const Q = Math.floor(S / 10);
  if (!Number.isInteger(C) || C < 0 || C > Math.min(T, Q)) throw new RangeError('C');
  if (queued !== 0 && queued !== 1) throw new RangeError('queued');
  if (!KINDS.includes(kind)) throw new RangeError('kind');

  if (kind === 'COURIER') {
    if (C >= Q) return 'COURIER_BUDGET_EXHAUSTED';
    if (T === S) return 'WINDOW_FULL';
    // The caller's queue-take result is modeled by this one-bit state. EMPTY
    // does not charge a slot.
    return queued === 0 ? 'EMPTY' : 'COURIER_ADMITTED';
  }

  if (T === S) return 'WINDOW_FULL';
  // Primary can use spare courier capacity only when no courier is queued.
  // If courier work is queued, preserve the remaining shared allowance.
  if (queued === 1 && S - T <= Q - C) return 'COURIER_RESERVED';
  return 'PRIMARY_ADMITTED';
}

export const cases = Object.freeze((() => {
  const rows = [];
  for (let S = 1; S <= 30; S += 1) {
    const Q = Math.floor(S / 10);
    for (let T = 0; T <= S; T += 1) {
      for (let C = 0; C <= Math.min(T, Q); C += 1) {
        for (const queued of QUEUED) {
          for (const kind of KINDS) {
            const input = Object.freeze({ S, T, C, queued, kind });
            rows.push(Object.freeze({ ...input, expected: expectedDecision(input) }));
          }
        }
      }
    }
  }
  return rows;
})());

// Cardinality: 4 * Σ(S=1..30) Σ(T=0..S) (min(T, floor(S/10)) + 1) = 4,828.
export const CASE_COUNT = 4_828;
if (cases.length !== CASE_COUNT) throw new Error('REFERENCE_CASE_COUNT');
