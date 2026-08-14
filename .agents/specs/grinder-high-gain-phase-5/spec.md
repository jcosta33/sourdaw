---
type: spec
id: SPEC-grinder-high-gain-phase-5
title: Grinder high-gain — phase 5 (usable distortion and fuzz, fuzz silence)
status: done
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
  - research.md
---

# Grinder high-gain — phase 5 (usable distortion and fuzz, fuzz silence)

## Intent

Turn `DistortionPedal` and `FuzzPedal` from brittle artifact generators into usable
high-gain pedals: they stay in a sane loudness range, fuzz stops manufacturing signal
from silence, and a bounded alias-mitigation step replaces plain sample-rate clipping —
without removing their character.

## Non-goals

- Full ADAA rollout across every Grinder nonlinear stage.
- Triode/preamp/power-amp retuning.
- Neural model loading.
- Routing-mode completion.
- Cabinet model or IR management changes.

## Requirements

### AC-001 — Fuzz does not generate output from silence

When fuzz is enabled and the input is silent, the pedal output must settle near silence
instead of emitting a steady residual signal.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-002 — Distortion loudness stays usable

When distortion is set to moderate values, the output must remain within a sane loudness
range relative to bypass rather than behaving like a broken gain jump.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-003 — Fuzz loudness stays usable

When fuzz is set to moderate values, the output must remain within a sane loudness range
relative to bypass.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-004 — High-gain pedals remain audibly active

When distortion or fuzz is enabled, the pedal must still audibly change the signal; the
fix must not collapse it into near-bypass behavior.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-005 — Bounded alias mitigation is real

Distortion and fuzz must not rely only on plain sample-rate clipping; the implementation
must add a real, RT-safe mitigation step around the main nonlinearity.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-006 — RT safety is preserved

The pedal processing must remain allocation-free and lock-free in `process_sample()`,
with state held inside the pedal structs and initialized in `new()` / `reset()`.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-007 — Existing pedal types are reused, with no parallel high-gain subsystem

The retuned distortion and fuzz behavior must be implemented entirely by reusing the
existing `DistortionPedal` and `FuzzPedal` types; the change must not introduce a
separate parallel high-gain subsystem alongside them.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::` and inspect `crates/daw-dsp/src/grinder/pedals.rs` to confirm no new parallel high-gain pedal subsystem was added.

### AC-008 — Module-level regression gates run green

The change must not regress the Grinder UI: the Grinder UI tests must pass, in addition to
the DSP suite.

Verify with: `pnpm test:run src/modules/Grinder`

### AC-009 — Regression coverage proves the loudness and silence invariants

The suite must include DSP regression tests that explicitly prove the distortion/fuzz
loudness invariants and the fuzz-on-silence invariant, so the resolved behavior cannot
silently regress.

Verify with: `pnpm cargo:test -- -p daw-dsp grinder::`

### AC-010 — TypeScript types check after the change

The change must not regress the Grinder module's TypeScript types: the type check must
pass.

Verify with: `pnpm typecheck`

## Open questions

- [ ] (non-blocking) Should the phase after this target triode/preamp voicing or
  neural/routing completion first?

## Affected areas

- `crates/daw-dsp/src/grinder/pedals.rs`

## Dropped from sources

- Full cross-engine ADAA rewrite — deferred; a bounded low-order oversampled core with
  pre/post conditioning resolves the audible complaint now.
- Triode/power-amp antialias rewrite — deferred to phase 6; a larger spec.
- The public parameter contract (`drive`, `tone`, `level`, `fuzz`, `enabled`) is
  preserved unchanged.
- Source provenance for the alias-mitigation findings (the migrated phase-5 spec kept
  only two inline DOIs — `10.1109/LSP.2017.2675541` and `10.3390/app10010020` — and the
  remaining direct URLs survive nowhere else):
  - Bilbao, Esqueda, Parker, Välimäki, "Antiderivative Antialiasing for Memoryless
    Nonlinearities" (IEEE SPL 24(7), 2017), DOI `10.1109/LSP.2017.2675541` —
    `https://research.aalto.fi/en/publications/antiderivative-antialiasing-for-memoryless-nonlinearities/`
  - Holters, "Antiderivative Antialiasing for Stateful Systems" (Applied Sciences 10(1),
    2020, from DAFx-19), DOI `10.3390/app10010020` — `https://www.mdpi.com/2076-3417/10/1/20`
  - Yeh, Abel, Smith, "Simplified, Physically-Informed Models of Distortion and Overdrive
    Guitar Effects Pedals" (DAFx-07, p189) — `https://dafx.de/paper-archive/2007/Papers/p189.pdf`
  - Yeh, Smith, "Simulating guitar distortion circuits using wave digital and nonlinear
    state-space formulations" (DAFx-08) —
    `https://dafx.de/paper-archive/details/gZvqz8Bk39w9LqNNr1SDlg`
  - Parker, Zavalishin, Le Bivic, "Reducing the Aliasing of Nonlinear Waveshaping Using
    Continuous-Time Convolution" (DAFx-16) —
    `https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf`
