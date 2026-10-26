# Track 4 — execution lifecycle coordinator v1

This bridge coordinates OFF and drain observation across already-created owners. It does not schedule, admit, execute, load, generate, authorize, or cancel anything that was not explicitly registered.

`createExecutionCoordinatorV1({owners,settleTimeoutMs})` accepts 1–16 exact registrations `{id,status,settled,cancel}`. The callbacks are captured as data properties. `status()` must report an existing owner vocabulary value: `IDLE`, `BUSY`, `QUARANTINED`, or `OFF`. `settled()` is the owner's existing join/settlement operation. `cancel()` is the only cancellation callback the coordinator may invoke.

The returned frozen facade exposes `inspect()`, `requestOff()`, and `recheck()`. Only one async operation may run at once. OFF is reported only after every registered `settled()` fulfills and the subsequent `status()` is `IDLE` or `OFF`. Rejection, timeout, malformed status, `BUSY`, or `QUARANTINED` remains `UNCONFIRMED`; capacity is not released. `recheck()` uses the same registered handles and never invokes cancellation again or restarts work.

Results and snapshots are immutable, non-authorizing lifecycle evidence. Native app wiring, scheduler admission, provider consent, execution, and global capacity remain future work.
