---
type: spec
id: SPEC-render-parity-instrumentation
subject: the four instruments every later design decision is argued from
status: ready
repo: sourdaw
date: 2026-08-01
blocked_by: SPEC-project-durability
blocks: survey programme phases 2-8, ADR 0014 phase 2
sources:
  - .agents/artifacts/sourdaw/SURVEY-ultracode-scope.md
  - .agents/artifacts/sourdaw/RESEARCH-project-persistence.md
---

# Render parity instrumentation — Phase 1

Thirty-one survey findings across themes A and H cannot be closed by reading source. This spec
builds the instruments that close them, and it exists as its own phase because **no design decision
in any later phase may be made before it lands.**

The precedent for why: a previous campaign argued from Rust source line count that a DSP was cheap
enough to relocate, and was wrong by roughly fifty times. `crates/daw-dsp/benches/quantum.rs` now
records both the number and the lesson.

## Acceptance criteria

### AC-1 — A signal-level live/offline null test

Render a fixture through the offline path and through an `OfflineAudioContext` constructed by the
**live** code, and null-test the two.

- **Budget: residual peak ≤ −90 dBFS** for a chain of deterministic DSP, which is f32 round-off.
- **Anything above −60 dBFS is a defect, not tolerance.** Do not widen this to accommodate a device.

This replaces the existing mock-level parity specs, which cannot see the defect class:
`Toaster/useCases/__tests__/toasterLiveOfflineParity.spec.ts` stubs `getTrackStrip`, so the live
worklet is never exercised.

**Evidence:** green on a clean chain, and **red on a deliberately broken fixture**. Both are required
to satisfy this AC. A harness that has only ever been green is untested measurement equipment.

**Fixture constraint:** keep Yeast out of the fixture set until the one-clock work lands. Yeast
generators phase-lock to the first block they see, so two runs of the same project differ for
reasons unrelated to whatever is being tested.

### AC-2 — A per-quantum cost table, in wasm as well as native

Extend `benches/quantum.rs` to every device, measured **in wasm in a real `AudioWorkletGlobalScope`**
as well as natively, against the 2.667 ms budget (128 frames at 48 kHz). Include the reference
project's total as a fraction of budget.

**Evidence:** the table, committed, with machine and browser stated. A number without its machine is
not a measurement.

**This table reorders the programme.** If the reference project already sits near deadline before any
optimisation work, the CPU findings stop being hygiene and move ahead of the parity work. Report
that rather than silently reordering — it is survey stop condition 6.

### AC-3 — A real dropout observation, or an explicit statement that one is unavailable

The existing bench could not obtain one: its Chromium does not expose `AudioContext.renderCapacity`,
and its wasm leg runs on an `OfflineAudioContext`, which has no deadline by specification.

Determine whether the shipping target exposes `renderCapacity` — there are currently **zero uses
anywhere in `src/`**. If it does, wire it into the harness and the status bar. If it does not, say so
explicitly and fall back to the dropout counters `getHealth()` already computes and nobody reads.

**Evidence:** either a captured `peakLoad > 1` event, or a written statement of why one cannot be
captured on this target and what the fallback measures instead. **"Its compute exceeds the budget"
and "it misses the deadline" are different claims** — do not write the second without the
observation.

### AC-4 — A main-thread stall budget

**10 ms**, one `SCHEDULE_AHEAD_SECONDS` grain. Measured with `performance.now()` around save, project
load, and analysis.

**Evidence:** the measurement for each, and a failing case if one exists. Several survey findings
allege main-thread blocking; this is what decides them.

### AC-5 — The persistence gates that are hours, not days

From ADR 0014, run and report:

- **M2 — is the Tauri origin stable across restarts?** Write a marker to IndexedDB, restart, read it
  back, on each webview. Unstable anywhere means that target cannot use webview storage at all.
  Cheap, and it could invalidate large parts of ADR 0014. Run it first.
- **M9 — do the two `.sdaw` codecs agree today?** Golden fixture each way, roughly thirty lines. Any
  divergence is a shipped web/desktop incompatibility that exists right now.

**Evidence:** both reported with their outcome. These are also AC-7 of `SPEC-project-durability`;
whichever phase runs them first records the result and the other cites it.

### AC-6 — Every instrument states its own budget in its own header

Each harness file carries the budget it enforces and why that number, so the next reader cannot
re-litigate it from scratch or quietly widen it. `benches/quantum.rs` is the model.

**Evidence:** present in each file.

## Out of scope

Fixing anything these instruments find. This phase builds measurement equipment and reports numbers.
The temptation to fix a defect the moment the harness reveals it is the thing to resist — a harness
validated by the fix it motivated proves nothing.

## Verification

- Every guard mutation-checked; name the assertion that reds.
- Full suite at least twice, both exit codes quoted, read from the command itself.
- `scripts/health-gates-web.sh` and `health-gates-server.sh` from a clean checkout off the lockfile.
