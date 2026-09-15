# Owner extraction record

The preserved worker response was malformed: its `output` contained two JSON
fragments rather than one valid outer artifact. Each fragment nevertheless
contained a strict JSON object for the single `path: "src/index.mjs"` and
`content` pair. The owner extracted both pairs with strict JSON decoding,
confirmed that both paths and content bytes were identical, and salvaged that
one source as an OWNER extraction. The outer response remains recorded as
noncompliant with the worker protocol; no protocol-compliant worker claim is
made.

Only that identical source pair was installed. The implementation is a pure
synchronous transform: exact input/row shapes, bounded values, duplicate-ID
refusal, unit-aware numeric validation, null propagation, signed delta and
finite relative percentage, original ordering, and no aggregation across
units. No imports, I/O, clocks, probing, model loading, or inference claims
were introduced.
