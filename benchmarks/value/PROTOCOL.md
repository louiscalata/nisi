# Controlled benchmark protocol, revision 2

This is a development-time, openly authored benchmark of the released v0.2.0
workflow implementation. It is not a held-out task evaluation, a provider
certification, or a preregistered clinical-style experiment. Source hashes and
the exact scenario list are written before every run. Results use new directories
so failed and superseded runs remain available.

## Questions and arms

1. Does the workflow accept valid evidence, recover within a declared repair
   budget, and stop on invalid evidence or unmet host authority?
2. Does it match a competent handwritten scheduler under the same callbacks?
3. What scheduling overhead does Nisi add on this host, without model latency?
4. Which inference interfaces can feed the same workflow through an adapter?

The three control arms are a checked one-shot (zero repairs), a handwritten
checked loop (two repairs), and the unchanged released Nisi workflow (two
repairs). Both references share Nisi task/candidate value-object contracts and
hashing; the loop independently implements scheduling. They are not independent
Nisi-free products. All arms use the same authored transcript callbacks. The
one-shot arm isolates the opportunity from allowing repair, not a Nisi-specific
quality advantage. The handwritten baseline receives review and fixes before
measurement; deliberately omitting its safeguards would create a weak comparator.

## Control specimens and scoring

`fixtures.mjs` declares 25 specimens before comparative execution: acceptance;
test, static and reviewer repair; exhausted budget; unchanged/cyclic candidates;
stale run/task/candidate/attempt/reviewer binding; malformed evidence; unavailable
and throwing callbacks; denied authorization; candidate scope/protected content;
deadline after a callback; pre-cancellation; bound/stale storage acknowledgements;
and a deliberately dishonest but structurally consistent PASS.

`score.mjs` records the original outcome, external JSON-answer correctness,
correct and incorrect acceptance, first-pass false refusal, callback start/settle
counts, budget use, fresh completion evidence, and expected stops. There is no
aggregate accuracy score. Passing the dishonest-PASS specimen means reproducing
and reporting a trust boundary: it must be counted as incorrect acceptance.
The JSON oracle evaluates the candidate, never a model's assessment of itself.
Both callbacks and external scorer know the answer; this is explicitly synthetic.

Revision 2 adds independent expected invocation sequences for every specimen and
arm, including attempt transitions and matching report/actual repair counts.
This addresses reviewer-found scorer blind spots for empty traces, invented
repairs and extra work after a stop. Revision 1 runs are retained as development
runs and superseded by revision 2; this is not hidden post-hoc task selection.
Both timing arms now report their own p95 as well as median.

Zero-work/refuse-everything and accept-everything negative controls must fail the
scorer. Semantic scoring and recovery scoring have separate tests. Related fault
variants are reported by family and are not treated as independent statistical
samples. Callback settlement here concerns inert local callbacks; it establishes
no remote cancellation guarantee. A storage PASS is an acknowledgement test,
not disk durability. Paths are logical candidate names, not OS capabilities.

## Timing

Only trace-matched valid-first and one-repair runs enter timing. Use 1 small file,
1 file plus 8 KiB padding, and 8 files each plus 8 KiB padding. Each condition has
30 warmup pairs and 200 measured pairs, with alternating arm order. Fixture
construction, source capture, scoring and output are outside the measured region.
The same monotonic clock is supplied to both arms. Callback counting and the
same inert callback work are included in both. Validation, copying, hashing,
Promise/timer setup, workflow decisions and report construction are timed.

Report hardware/runtime, actual candidate bytes, raw paired milliseconds, median,
p95 and paired deltas. This is one process on one host with technical replicates,
not independent tasks or machines. No inference, durable journal, report-store
I/O, network, sandbox, CLI startup or external process is measured. Do not
translate a millisecond difference into token savings, model speedup or cost.

## Interpretation and future evidence

If the competent reference ties Nisi, say so. The demonstrated value is a reusable
implementation of the measured controls; code size and passing fixtures do not
measure development time saved. A live model study must use separate task-based
paired sampling, externally checked outputs, equal budgets, model/parameter
controls, and a frozen analysis plan. See `LIVE-STUDY.md` for that proposed study.

Inference interoperability is measured separately from model quality. A mocked
transport proves request/response adaptation only. A real provider claim needs
retained request, response and usage/error receipts from that specific provider,
with credentials and private inputs excluded from public artifacts.
