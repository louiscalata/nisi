# Nisi v0.3.0 Windows hardware check

A person-operated check on one Windows PC on 2026-11-07, run by a Windows Claude
session from a written checklist and reported by what it observed. Hosted CI
already runs the test suite on Windows with Node 22 and 24; this record covers what
CI cannot: a real machine, the shims a user runs, and the real NTFS file system.
It is one machine on one day, not a certification.

## Environment

Windows build 26300.9818 (registry name "Windows 10 Home", display version 26H2),
Node 26.13.0 (the only Node installed), npm 11.20.0, git 2.56.0, Windows
PowerShell 5.1, PowerShell 7.6.9 and cmd.exe, system drive C: on NTFS, Developer
Mode on, shell not elevated. Source checked: tag `v0.3.0` (`fb2c300`) and `main`
at `5097e2a`.

## Results

| Check | Result |
| --- | --- |
| `nisi-0.3.0.tgz` SHA-256 matches `SHA256SUMS` | pass |
| `npm install` of the archive; `nisi.cmd` is in `node_modules\.bin` | pass |
| `nisi.cmd --version`, `demo` (`COMPLETED`, one repair, report stored, no model calls), no arguments (help, exit 0), `local-model` with no arguments (usage error, exit 2) | pass in PowerShell 5.1, PowerShell 7 and cmd.exe |
| The demo leaves no `nisi-workflow-*` folder behind | pass |
| `nisi/adapters/jev-advisor` resolves from the installed package | pass |
| Tag and `main`: `npm ci`, `npm run check`, `npm run check:cli-package` | pass: 273 tests, 273 pass, 0 skipped; 19-file archive |
| `benchmarks/harder/tasks-v1.json` hash and LF line endings with `core.autocrlf=true` | pass (the `.gitattributes` pin holds) |
| `benchmarks/harder/run.mjs` usage line and `tests/harder-benchmark.test.mjs` | pass |
| Journal, store and consent tests | pass: 56 of 56 |
| Journal store on NTFS with the real `fs` | `committed: true`, `durable: true`, no temp file left |
| Symlinked journal destination | refused with `SYMLINK`, target bytes unchanged (PowerShell 7) |
| Hard-linked file in a consent scope | refused with `CONTENT_HARDLINK_REFUSED`; an unlinked control file was admitted |
| `realpathSync('root\\link\\..\\ok.json')` for a junction and for a directory symlink | resolves to `root\ok.json` (Windows removes `link\..` first), as `docs/file-policy.md` says |

`durable: true` means the file and directory sync calls returned without error. No
power-loss or write-cache test was done.

## Not verified

- Node 22 and 24 on this PC: not installed. Everything ran on Node 26.
- `durable` on any other file system: the PC has only one lettered NTFS volume and
  no network drive.
- A live model task: the loopback model lane did not answer.
- Creating a symlink from Windows PowerShell 5.1: `New-Item -ItemType SymbolicLink`
  failed with "Administrator privilege required" even with Developer Mode on and
  the same command worked in PowerShell 7 (and `fs.symlinkSync` works in the
  tests), so the `SYMLINK` refusal was observed only from the PowerShell 7 session.
- Paths with spaces, very long or non-ASCII paths, redirected folders, antivirus
  effects, and a power-loss test.

## Finding fixed

`npm run check` left about 96 temporary folders (`consent-*`, `afm-content-*`,
`afm-stub-*`) per run on Windows, and the same on macOS. The tests now remove
every folder they create.
