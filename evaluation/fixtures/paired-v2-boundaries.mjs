// SYNTHETIC boundary cases; not real provider measurements or benchmark evidence.
// Root-authored after the OpenCode free provider refused headless execution.
export const PAIRED_V2_BOUNDARIES = [
  {
    id: 'known',
    off: [{ input: 80, output: 20 }, { input: 80, output: 20 }],
    on: [{ input: 40, output: 10 }, { input: 40, output: 10 }],
    expected: { completeCaseCount: 2, offUnknownCount: 0, onUnknownCount: 0, offOverflowCount: 0,
      onOverflowCount: 0, offAggregateOverflow: false, onAggregateOverflow: false },
  },
  {
    id: 'unknown-left',
    off: [null, { input: 80, output: 20 }],
    on: [{ input: 40, output: 10 }, { input: 40, output: 10 }],
    expected: { completeCaseCount: 1, offUnknownCount: 1, onUnknownCount: 0, offOverflowCount: 0,
      onOverflowCount: 0, offAggregateOverflow: false, onAggregateOverflow: false },
  },
  {
    id: 'all-unknown', off: [null, null], on: [null, null],
    expected: { completeCaseCount: 0, offUnknownCount: 2, onUnknownCount: 2, offOverflowCount: 0,
      onOverflowCount: 0, offAggregateOverflow: false, onAggregateOverflow: false },
  },
  {
    id: 'row-overflow',
    off: [{ input: 9007199254740991, output: 1 }, { input: 0, output: 0 }],
    on: [{ input: 0, output: 0 }, { input: 0, output: 0 }],
    expected: { completeCaseCount: 1, offUnknownCount: 0, onUnknownCount: 0, offOverflowCount: 1,
      onOverflowCount: 0, offAggregateOverflow: false, onAggregateOverflow: false },
  },
  {
    id: 'aggregate-overflow',
    off: [{ input: 9007199254740990, output: 0 }, { input: 2, output: 0 }],
    on: [{ input: 0, output: 0 }, { input: 0, output: 0 }],
    expected: { completeCaseCount: 2, offUnknownCount: 0, onUnknownCount: 0, offOverflowCount: 0,
      onOverflowCount: 0, offAggregateOverflow: true, onAggregateOverflow: false },
  },
  {
    id: 'mixed-unknown-overflow',
    off: [null, { input: 9007199254740991, output: 1 }],
    on: [{ input: 9007199254740991, output: 1 }, null],
    expected: { completeCaseCount: 0, offUnknownCount: 1, onUnknownCount: 1, offOverflowCount: 1,
      onOverflowCount: 1, offAggregateOverflow: false, onAggregateOverflow: false },
  },
];
