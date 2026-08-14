---
type: spec
id: SPEC-fermenter-voice-management
title: Fermenter voice management
status: done
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter voice management

## Intent

Fermenter's voice manager allocates from a fixed voice pool, steals voices
gracefully when polyphony is exhausted, glides pitch between notes, and supports
per-voice effects so a polyphonic chord can carry independent FX tails. The voice
pool, stealing, and glide ship today.

## Non-goals

- Per-generator unison detune/pan (`../fermenter-wavetable/spec.md` and other
  engine specs own their unison).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — Voices allocate from a fixed pool without allocating

When a note-on arrives, the manager must take a voice from the pre-allocated pool
(128 native / 32 WASM) without heap allocation.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::voice_allocation`

### AC-002 — Voice stealing prefers releasing then oldest voices

When no free voice exists, the manager must steal the oldest releasing voice
first, then the oldest held note.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::voice_stealing_order`

### AC-003 — A stolen voice crossfades to avoid clicks

When a voice is stolen, the manager must fade the old voice out while the new
voice fades in so no click is produced.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::voice_steal_fade`

### AC-004 — Glide ramps pitch in log-frequency space

When glide is active, the pitch must approach the target exponentially in
log-frequency space so the time per octave is equal.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::glide_log_ramp`

### AC-005 — Legato glide engages only on overlapping notes

When glide mode is legato, the pitch must glide only when a new note overlaps a
held note, not on the first note.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::glide_legato`

### AC-006 — Per-voice FX render independent tails

When per-voice FX are enabled, each voice must process its own effect instance so
each note carries a separate tail.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::per_voice_fx`

### AC-007 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) What stealing fade length (the source suggests ~10 ms)
  best hides clicks without audibly shortening fast passages?

## Affected areas

- `crates/daw-dsp/src/fermenter/` (voice manager, glide, per-voice FX hosting)
- `src/modules/Fermenter/` (polyphony / glide parameter bridge)

## Dropped from sources

- A bass mono-protection cutoff applied at the voice level — unison bass safety
  lives with each engine's unison, not the voice manager.
