---
type: adr
id: 0038
title: Scope the Grand Boule measurement census to the device's compile-time closure
status: accepted
date: 2026-08-28
owner: The Sourdaw team
sources:
    - 'https://github.com/jcosta33/sourdaw/issues/3005'
    - .agents/decisions/0036-readmit-grand-boule.md
    - scripts/checkReleaseInventory.ts
    - crates/daw-dsp/benches/wasm/run.mjs
    - crates/daw-dsp/benches/quantum-cost-table.json
---

# 0038 - Scope the Grand Boule measurement census to the device's compile-time closure

## Context

ADR 0036 readmitted Grand Boule with a measured runtime proof whose admission check,
`assertGrandBouleMeasurementAdmission`, pins the sha256 of four measurement inputs — three
bench-harness files and the whole-crate `daw_dsp_bg.wasm` — and requires each recorded digest to
match both the pinned source revision and the current tree, on every pull-request push. Because the
whole crate compiles to one wasm binary, every daw-dsp change anywhere — a crumbs voice-allocator
fix included — invalidates the piano's measurement record and forces a re-measurement on the
reference machine. In the three months before this decision, 121 commits changed the wasm bytes
(~9-10 per week) while only 25 touched grand_boule's actual compile-time closure; the recurring
cost buys provenance the instrument cannot resolve, since the harness publishes two significant
figures and documents a clock floor of roughly ±10%, while a codegen shift from outside
grand_boule's call graph is realistically below that floor against a ~20% budget headroom. The
coupling blocked two approved crumbs pull requests (#2943, #2957) whose changes lie outside
grand_boule's compile-time closure and cannot move the piano's measured row — and #2957's
voice-stealing path is one the bench's 32-of-128-voices crumbs recipe never triggers.

The one load-bearing objection to narrowing is that the check also asserts a whole-mix
`referenceProject` budget — the measured reference project is an eleven-device audio-thread mix
that includes crumbs — so the wasm digest is the only census entry binding those whole-mix numbers
to shipped bytes. That assertion was never grand-boule-specific; it is a general engine capability
gate filed under the grand-boule admission.

## Decision

Narrow the measurement census to the source inputs that determine grand_boule codegen: the three
bench-harness files, `crates/daw-dsp/src/grand_boule/**`, `crates/daw-dsp/src/primitives/**`,
`crates/daw-dsp/src/lib.rs`, `crates/daw-dsp/Cargo.toml`, and the toolchain pins
(`rust-toolchain.toml` and the `pinnedToolchain` block in `scripts/wasm-artifacts.ts`). The
whole-crate wasm digest leaves the census; artifact freshness remains pinned by `wasm:verify`.
Move the whole-mix `referenceProject` budget assertion out of the grand-boule admission into a
separately named whole-engine capability gate, so no surviving assertion claims provenance over
bytes the census no longer pins. One migration re-measurement on the reference machine re-baselines
the table under the new census; afterwards, re-measurement is owed only when the pinned closure
changes. This narrows enforcement, not the admission: ADR 0036's claim map, source-shape
rejections, and design-around checks are untouched.

Accepted residual holes, recorded so the trade is explicit: workspace-root release-profile and
wasm-bindgen lockfile bumps can shift codegen without tripping the census (rare, review-visible),
and the wasm-bindgen glue stays unpinned (below instrument resolution).

Reversal trigger: if a crumbs-only rebuild moves grand_boule's measured floor by more than ~10%,
byte-identity is load-bearing after all and the whole-wasm pin returns.

## Consequences

- The migration is tracked as issue #3005, including the census edits in both
  `checkReleaseInventory.ts` and `benches/wasm/run.mjs`, a spec pinning the two lists equal, and
  the single forced re-measurement.
- #2943 and #2957 merge main and pass with no table work once the migration lands.
- Named follow-up, its own lane: splitting grand_boule into its own crate and wasm package makes
  the whole-artifact digest pin identical to the narrow pin and restores byte-exact provenance
  without the coupling.
- This remains an engineering evidence record, not a legal opinion; whether byte-level binding adds
  evidentiary weight over source-level binding for the claim map has not been legally assessed.
