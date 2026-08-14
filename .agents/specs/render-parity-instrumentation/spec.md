---
type: spec
id: SPEC-render-parity-instrumentation
subject: the instruments every later design decision is argued from
status: landed
repo: sourdaw
date: 2026-08-01
landed: 2026-08-04
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

### AC-4 — The persistence gates that are hours, not days

From ADR 0014, run and report:

- **M2 — is the Tauri origin stable across restarts?** Write a marker to IndexedDB, restart, read it
  back, on each webview. Unstable anywhere means that target cannot use webview storage at all.
  Cheap, and it could invalidate large parts of ADR 0014. Run it first.
- **M9 — do the two `.sdaw` codecs agree today?** Golden fixture each way, roughly thirty lines. Any
  divergence is a shipped web/desktop incompatibility that exists right now.

**Evidence:** both reported with their outcome. These are also AC-7 of `SPEC-project-durability`;
whichever phase runs them first records the result and the other cites it.

### AC-5 — Every instrument states its own budget in its own header

Each harness file carries the budget it enforces and why that number, so the next reader cannot
re-litigate it from scratch or quietly widen it. `benches/quantum.rs` is the model.

**Evidence:** present in each file.

## Out of scope

Fixing anything these instruments find. This phase builds measurement equipment and reports numbers.
The temptation to fix a defect the moment the harness reveals it is the thing to resist — a harness
validated by the fix it motivated proves nothing.

## Verification

- Every guard mutation-checked; name the assertion that reds.
- Run each affected test once through guarded package scripts; quote its exit code.

## Outcome — landed 2026-08-04

| AC                          | Where it lives                                                                                          | Outcome                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 signal-level null test | `AudioEngine/useCases/offlineRender/__tests__/liveOfflineNullTest.spec.ts` + `nullTestRenderHarness.ts` | **Landed.** 27 cases. Both directions ship: six under "the instrument can fail", including a broken fixture that drops `applyParams` from the offline registry, plus a sensitivity block that catches a fader divergence of 1 part in 500 and a filter cutoff divergence of 1 Hz in 2400. Budget held at −90 dBFS; not widened.                                                                                                                               |
| AC-2 per-quantum cost table | `crates/daw-dsp/benches/quantum.rs`, `benches/wasm/`, `benches/quantum-cost-table.{md,json}`            | **Landed, and corrected — see "What the instruments found" below.** Both legs regenerated; machine, browser and SHA stated in the artifact.                                                                                                                                                                                                                                                                                                                   |
| AC-3 dropout observation    | `scripts/measureRenderDeadline.ts`, `renderDeadlineBrowser.ts`                                          | **Landed.** `renderCapacity` is absent on the shipping target across eight probed configurations; the file says so explicitly and pins the absence so it reds if it ever appears. A real deadline miss _was_ captured via `AudioContext.playbackStats` under a deliberately over-budget worklet, with an in-budget control leg recording none.                                                                                                                |
| AC-4 gates M2 and M9        | ADR 0014 §"Gates reported", `SPEC-project-durability` AC-7                                              | **Cited, not re-run**, per this spec's own "whichever phase runs them first records the result and the other cites it". **M9** ran in Phase 0 (#963): the two `.sdaw` codecs agree, one real UTF-8 divergence was found and fixed, nine fixtures checked in both directions. **M2** is formally deferred — it is entirely a Tauri-webview question and ADR 0016 defers desktop; ADR 0014 records it unmeasured rather than deleted. It has no web leg to run. |
| AC-5 budget in each header  | all of the above                                                                                        | **Landed** for `quantum.rs` and `measureRenderDeadline.ts`. **Gap:** `scripts/renderDeadlineBrowser.ts` has no header at all and gives no reason for its `channel: 'chrome'` requirement, which the main harness's own probe matrix appears to contradict. Left as a finding rather than guessed at.                                                                                                                                                          |

### What the instruments found

Out of scope for this phase is _fixing_ what the instruments find — but a defect **in an instrument**
is this phase's own work, and three were found in the cost table.

1. **The bench did not compile, and had not for some time.** `cargo clippy -p daw-dsp --all-targets`
   exited **101** on clean `main`: two `E0308`s where `LevainInstance::add_sample`'s `Option<u32>`
   was handed to `add_zone` unwrapped. At landing, `.github/workflows/health-gates.yml` had no Rust
   step, so `--all-targets` was unavailable as a gate. **That gap was reported, not closed**; adding
   a Rust job was outside this phase.
2. **Three hand-written device lists had all gone stale against the crate.** The native bench header,
   `DEVICE_IDS`, and the worklet's import list each claimed to enumerate every `#[wasm_bindgen]`
   render export while asserting Crust "[has] no Rust engine at all" — and `src/crust/` had shipped
   one, exported by the committed wasm. Crust now has a row in both legs, and
   `crates/daw-dsp/tests/quantum_bench_census.rs` derives the population from the crate source and
   compares it against the bench, per ADR 0015 rules 2 and 3.
3. **Two rows were timing a device with the expensive part switched off**, and both passed every
   gate the bench had while doing it. Occupancy proved they were _running_; nothing proved _what_.
    - **Levain** loaded through the direct pool rather than production's staged-bank protocol, so
      `commit_sample_bank` never ran, realism stayed at `Instrument::Other`, and all five realism
      stages early-returned on a zero amount. Corrected: +10% native.
    - **Bacteria** had a single row at the constructor defaults, where every creative stage is
      disabled. Engaging the shipped Smudge mode moves it from 15 µs (0.58% of budget) to an
      **amortised 300 µs (11%)**, with a **1100 µs tick quantum at 42% of the entire budget** every
      fourth quantum. Roughly **19x amortised and 73x on the tick**, from one user-reachable control.

    Correcting these exposed a fourth defect: the reference-project total summed **medians**, which is
    only the sustained cost if every row is flat. It charged a block device the price of the quantum
    in which it did nothing. Totals now sum the **mean**, and rows whose mean exceeds 1.5x their
    median are flagged `BURSTY`.

### Survey stop condition 6 — not triggered

AC-2 requires reporting rather than silently reordering if the reference project already sits near
deadline. **It does not.** The wasm leg's audio-thread total is well inside budget and the artifact
states "the upper bound already fits"; Grand Boule's 91–100% figure is charged to its own Worker
thread, not to the 2.667 ms worklet deadline. The CPU findings stay where the programme put them.

The Smudge figure is the one to watch: it is a single device reaching 42% of the whole budget in its
tick quantum. That is a finding for a later phase, not a reordering of this one — nothing in the
reference project enables it today.
