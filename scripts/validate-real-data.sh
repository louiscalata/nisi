#!/bin/sh
# Read-only check of Nisi run journals and workflow reports.
# Does not upload anything. The summary is counts, hashes and reason codes.
#
# Working data (on the machine that has it):
#   scripts/validate-real-data.sh --data-dir /absolute/path/to/nisi-data
#   scripts/validate-real-data.sh --journal /absolute/path/to/journal.jsonl
#   NISI_DATA_DIR=/absolute/path/to/nisi-data scripts/validate-real-data.sh
#   NISI_JOURNAL=/absolute/path/to/journal.jsonl scripts/validate-real-data.sh
#
# Smoke test, synthetic fixture shipped in this repository, not working data:
#   scripts/validate-real-data.sh --smoke
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
NODE=${NODE:-node}
if [ "${1:-}" = "--smoke" ]; then
  if [ "$#" -ne 1 ]; then
    echo "usage: scripts/validate-real-data.sh --smoke" >&2
    exit 2
  fi
  exec "$NODE" "$ROOT/bin/nisi.mjs" validate --data-dir "$ROOT/fixtures/sample-data"
fi
exec "$NODE" "$ROOT/bin/nisi.mjs" validate "$@"
