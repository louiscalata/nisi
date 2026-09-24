# Package archive footprint

[The chart](../charts/package-footprint.svg) plots the **compressed bytes in one
published package archive** for Nisi v0.2.0 and two version-pinned comparison
packages. Its horizontal axis is logarithmic (base 10); every row also prints
the exact byte count. The [manifest](packages.json) is the source of the chart.
The SVG renderer uses only Python's standard library and makes no network calls.

| Archive | Compressed bytes | Unpacked bytes | Entries | Recorded source |
|---|---:|---:|---:|---|
| `nisi@0.2.0` | 42,439 | 145,018 | 18 | [GitHub release `.tgz`](https://github.com/louiscalata/nisi/releases/download/v0.2.0/nisi-0.2.0.tgz) |
| `@langchain/langgraph@1.4.17` | 1,001,919 | 4,388,647 | 632 | [npm version](https://www.npmjs.com/package/@langchain/langgraph/v/1.4.17) |
| `@mastra/core@1.69.0` | 14,587,291 | 67,851,547 | 3,285 | [npm version](https://www.npmjs.com/package/@mastra/core/v/1.69.0) |

The Nisi figure is the v0.2.0 GitHub npm-format release asset, recorded with
SHA-256 in the manifest. The other figures were captured on 2026-09-24 from
`npm pack --dry-run --json` for the versions shown; the returned integrity
values are retained in the manifest. To repeat the measurements:

```bash
curl -fL --output nisi-0.2.0.tgz \
  https://github.com/louiscalata/nisi/releases/download/v0.2.0/nisi-0.2.0.tgz
shasum -a 256 nisi-0.2.0.tgz
wc -c < nisi-0.2.0.tgz
npm pack --dry-run --json '@langchain/langgraph@1.4.17'
npm pack --dry-run --json '@mastra/core@1.69.0'
```

To count regular files and their unpacked bytes in the Nisi archive:

```bash
python3 - <<'PY'
import tarfile
with tarfile.open('nisi-0.2.0.tgz', 'r:gz') as archive:
    files = [item for item in archive if item.isfile()]
print(len(files), sum(item.size for item in files))
PY
```

In the npm JSON, compare `size` (compressed bytes), `unpackedSize`, `files.length`,
and `integrity` with the manifest. The Nisi byte count comes from `wc -c` on
its pinned archive. Archive entry and unpacked counts are retained for context,
but **only compressed bytes appear in the chart**.

Regenerate or verify the committed chart from the repository root:

```bash
python3 benchmarks/value/footprint/render.py
python3 benchmarks/value/footprint/render.py --check
```

These archives contain different functions and file sets. The counts exclude
transitive dependencies and installed size. They are package footprints, not
repository source-tree sizes, and **cannot establish model token savings**.
Token claims need a matched workload with measured model requests and responses.
