---
type: spec
id: SPEC-performance-budgets-profiling
title: Performance budgets and profiling discipline
status: draft
owner: The Sourdaw team
sources:
  - intake/implementation-gaps.md
---

# Performance budgets and profiling discipline

## Intent

Make performance a contract: document per-platform CPU/latency/frame budgets as a
single source of truth, enforce them where possible (no-alloc assertions, lint denials,
guarded local benchmark gates), and document a profiling methodology with checked-in reference
traces so regressions are detectable.

## Non-goals

- Optimizing any specific subsystem (those are separate performance tasks).
- Loudness metering (see `loudness-metering-ebur128`).
- Waveform peak caching (see `waveform-peak-cache`).

## Requirements

### AC-001 — Budgets document is the single source of truth

A budgets document must define the hard/soft RT-audio, web-worklet, UI long-task, and
interaction-latency budgets; any spec stating a different number is a documented bug.

Verify with: `manual` — review the budgets doc and confirm each budget below has a single stated number

### AC-002 — RT audio thread no-alloc enforced

The native audio callback must allocate zero bytes per block, enforced by
`assert_no_alloc` aborting affected debug test targets on allocation.

Verify with: `pnpm cargo:test -- -p daw-engine assert_no_alloc_audio_callback`

### AC-003 — RT audio thread no-lock enforced

A Clippy lint must deny mutex/rwlock usage inside the engine `process*` modules.

Verify with: `pnpm cargo:clippy -- -p daw-engine -- -D warnings`

### AC-004 — UI long-task budget has a guarded local gate

A scripted Playwright scenario must fail its guarded local check if any `longtask` > 50 ms fires during
normal editing gestures.

Verify with: `pnpm test:e2e -- tests/e2e/performance-budget.spec.ts`

### AC-005 — Profiling methodology and reference traces

A profiling doc must describe RT and UI capture per platform.

Verify with: `manual` — confirm the profiling doc exists and the reference traces dir contains one trace per platform

### AC-006 — Reference trace per platform checked in

At least one reference trace per platform must be checked in with capture conditions.

Verify with: `manual` — confirm the reference traces dir contains one trace per platform with its capture conditions recorded

## Open questions

- [ ] (non-blocking) Reference hardware definition for the budget numbers (Apple M2 8-core
  proposed) — confirm and record in the budgets doc.

- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md §8.2 "Real-Time Audio
  Thread Priority") Today the CPAL-spawned audio thread runs at whatever priority the OS
  assigns by default; the `audio_thread_priority` crate is not a dependency. Scope to decide:
  add `audio_thread_priority` to `daw-engine` and call `promote_current_thread_to_real_time()`
  (or its crate-native equivalent) in the audio-callback startup path on macOS, Linux, and
  Windows. On failure to elevate (no RT permission / no threading entitlement), fall back to
  default priority, log exactly one warning, and surface a single-shot non-blocking toast to
  the UI via the existing notification channel — the engine must never crash on elevation
  failure. Document platform prerequisites (macOS entitlement, Linux `rtkit`/`rtprio`, Windows
  MMCSS) in `docs/architecture/profiling.md`. Target acceptance behaviors carried from the
  intake: on macOS, `thread_policy_get(THREAD_TIME_CONSTRAINT_POLICY)` returns an enabled
  policy within ≤ 100 ms of engine startup (macOS-gated integration test); on Linux with
  `rtkit` available, `sched_getscheduler()` reports `SCHED_RR` or `SCHED_FIFO` for the audio
  thread; on Windows, the audio thread is registered with MMCSS under the `Pro Audio` task
  (verified via a diagnostic log line). Deferred here rather than an AC because it spans a new
  dependency, three platform-specific elevation paths, and fallback/notification behavior —
  carve it into its own spec or task before implementing.

## Affected areas

- `docs/architecture/performance-budgets.md`, `docs/architecture/profiling.md`
- `crates/daw-engine/` (asserts, lints), local perf harness
- `docs/architecture/traces/reference/`

## Dropped from sources

- A docs-consistency check in `deps:validate` that fails on mismatched budget numbers —
  deferred to a follow-up; v1 establishes the doc and the enforcement asserts.
