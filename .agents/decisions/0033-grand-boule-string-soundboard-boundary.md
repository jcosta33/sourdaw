---
type: adr
id: 0033
title: Make Grand Boule string and soundboard stages explicit
status: superseded by 0035
date: 2026-08-21
owner: The Sourdaw team
sources:
    - .agents/decisions/0032-withhold-grand-boule-from-release.md
    - crates/daw-dsp/src/grand_boule/string.rs
    - crates/daw-dsp/src/grand_boule/coupled_strings.rs
    - crates/daw-dsp/src/grand_boule/engine.rs
    - crates/daw-dsp/src/grand_boule/soundboard.rs
---

# 0033 - Make Grand Boule string and soundboard stages explicit

**Accepted 2026-08-21.** Keep the existing two-stage DSP architecture explicit at its narrowest
Rust boundary: per-string modal coefficients derive without soundboard controls or state, and the
completed bridge signal then drives an independent soundboard resonator stage.

## Context

Grand Boule preserves an in-progress physical model. ADR 0032 requires withholding it from every
released discovery and runtime path. Direct construction remains exposed in distributed WASM; the
release inventory records its removal as a release blocker. Its existing render order is string
voices, bridge aggregation, then a global soundboard. Scalar call boundaries did not make that
separation mechanically apparent or pin the distinction against future parameter plumbing.

## Decision

`StringModalParameters` carries the complete per-string physical inputs to initial modal-coefficient
derivation: string frequency, key, hammer position, sample rate, and intrinsic damping. Stage-specific
damping remains derived within the string assembly from bridge and pedal interaction, never from
soundboard controls or soundboard resonator state.
`RenderedBridgeSignal` is the typed handoff from the completed bridge bus to `Soundboard`, whose
resonator state is independent of the string voice state.
The public scalar `ModalString::configure`, `ModalString::configure_aftersound`,
`ModalString::reset_decay`, and `Soundboard::tick` compatibility wrappers remain. The typed
boundary governs the current engine's initial string configuration path only. Its current mid-note
decay reset still takes string, bridge, and pedal inputs through the compatibility path, never
soundboard state; other Rust callers are not mechanically constrained by this decision.

Focused Rust proofs require that changing soundboard controls does not change the current engine's
initial or pedal-driven mid-note-reset string-modal coefficients, that the global soundboard runs
exactly once per output frame after multiple voices render, and that a rendered bridge impulse
excites a separately retained soundboard resonator tail. The decision changes no synthesis,
parameter semantics, public behavior, allocation, locking, or real-time cost.

## Limits

Grand Boule source, code, and project data remain retained; this decision does not re-admit Grand
Boule. ADR 0032 requires withholding it from released discovery and runtime paths, and the release
inventory records direct construction in distributed WASM as an explicit release blocker. The
unresolved parameter-source and reuse-provenance obligation remains unchanged. This is architecture
and regression evidence only: it is neither legal certainty nor release admission, and it does not
establish a design-around or authorize publication. If OS-10 applies Apache-2.0 to project-authored
code, that license grants no rights under third-party patents.
