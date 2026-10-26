# Private synthetic repository fixture

This is a PRIVATE synthetic Nisi repository fixture. It intentionally contains
a JavaScript truthiness bug in `retry-settings.mjs`: the baseline uses `||`
instead of nullish coalescing, so a configuration of `{"retryLimit":0}` is
wrongly replaced with three retries. This deliberate defect is a negative
control for review workflows and makes no product-performance claims.

The sibling `repair/retry-settings.mjs` supplies the corrected module variant;
it uses `??` so an explicit zero retry limit is retained.

# Testing

The sibling `harness/check-retry-settings.mjs` is the protected behavior harness.
Its argument is the absolute path to a reviewed task-owned repository containing
`config.json` and `retry-settings.mjs`. The baseline executes ten assertions:
eight pass, while the explicit-zero and loaded-config checks fail. The corrected
variant passes all ten. Quality FAIL is a JSON result, not a nonzero process exit;
setup errors return ERROR and exit 2. Do not use this harness to run unreviewed code.

# Rollback

To roll back, restore the original snapshot of this fixture before any changes
are applied. The workspace materializer itself does not implement apply-back.
