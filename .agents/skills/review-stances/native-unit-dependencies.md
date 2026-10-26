# Lesson library: optional native imports in unit specs

Lesson library for unit specs whose production subject imports an optional native runtime. A
stance about native dependency availability carries this file.

## Standing probes

- Trace the subject's import graph through every native package import. Mock the native boundary
  before importing the subject, while keeping real project modules and their asserted values in
  the graph.
- Require the named spec to collect and execute assertions without evaluating the native package
  entry point. A cached host binary can conceal a CI install that intentionally skips native
  downloads.

## Lessons from escapes

### 2026-10-25 — close coordinator collection required Electron's optional binary (PR #3141)

PR #3141 (`9db43f786c4ed508ab8968f9e51e4100bb042b9a`) introduced
`electron/__tests__/windowCloseCoordinator.spec.ts` without an Electron module mock. Its subject
imports `APP_TITLE` from `protocol.ts`, which imports `electron`; hosted unit2 run
40195635280 attempt 1 at head `fd9e41a4b3db2b96259bfa1b462091a3ba333151` therefore failed collection
with `Electron failed to install correctly` when CI had no Electron binary. The original review
prompt and tier are not established by available evidence; no native-absent import probe was
recorded.

Mock only `electron` at the spec boundary, leaving `protocol.ts`, `APP_TITLE`, the coordinator,
and the state assertions real. Check the exact spec in an install-script-free environment where
the Electron package entry cannot run; preserve assertions for each coordinator state transition.
