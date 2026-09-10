# Contributing

Thank you for looking. Right now this repository is published as a reference
rather than as a project seeking contributors.

**Issues are welcome.** If something here is wrong — a refusal code that fires on
the wrong input, a boundary that can be walked around, a claim in the README the
code does not support — please open an issue. A concrete counter-example is worth
more than a description, and a failing test is worth more than either.

**Pull requests are not being accepted at the moment.** This is not about the
quality of the contribution. Under Apache-2.0 §5 a contribution arrives under the
licence terms, and I would rather resolve provenance questions properly before
taking code from anyone else than do it casually and leave the answer ambiguous
for whoever reads this repository later. If that changes, this file changes with
it.

If you want to build on the code, the licence already permits it. Fork it.

## If you do open an issue

State the exact input bytes and the exact refusal code you expected. Several of
the tests here exist because an earlier version of a test asserted only that
"some exception was thrown," which turned out to constrain nothing at all.
