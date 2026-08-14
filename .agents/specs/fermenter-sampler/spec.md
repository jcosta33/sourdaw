---
type: spec
id: SPEC-fermenter-sampler
title: Fermenter sampler engine
status: done
owner: The Sourdaw team
sources:
  - ../fermenter/research.md
  - ../intake/full-spec.md
---

# Fermenter sampler engine

## Intent

Fermenter's sampler plays multisampled instruments: key/velocity zones map notes
to sample data, an O(1) lookup picks the zone, and playback supports forward and
ping-pong looping with interpolated pitch shifting. The zone playback path ships
today.

## Non-goals

- The standalone SFZ sample player (`../sample-player-sfz/spec.md`) and
  SoundFont playback (`../soundfont-playback/spec.md`).
- The shared parameter and block contract (`../fermenter/spec.md`).

## Requirements

### AC-001 — A note selects the zone covering its key and velocity

When a note-on arrives, the sampler must select the zone whose key and velocity
ranges contain that note via the O(1) lookup table.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::sampler_zone_lookup`

### AC-002 — Playback pitch-shifts relative to the zone root note

When a note differs from the zone root note, playback must advance the read
position at the corresponding pitch ratio.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::sampler_pitch`

### AC-003 — Sample reads use cubic interpolation

When the read position is fractional, the sampler must read with 4-point cubic
interpolation.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::sampler_interp`

### AC-004 — Forward looping wraps within the loop region

When loop mode is forward, the read position must wrap from the loop end back to
the loop start.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::sampler_loop_forward`

### AC-005 — Ping-pong looping reverses at the loop bounds

When loop mode is ping-pong, the read direction must reverse at the loop end and
loop start.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::sampler_loop_pingpong`

### AC-006 — A non-looping voice deactivates at the sample end

When loop mode is none, the voice must deactivate once the read position passes
the end of the sample data.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::sampler_one_shot`

### AC-007 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

## Open questions

- [ ] (non-blocking) What minimal SFZ opcode subset must the loader accept for
  the first wave of multisample imports?

## Affected areas

- `crates/daw-dsp/src/fermenter/sampler.rs`
- `src/modules/Fermenter/` (sampler parameter bridge, zone loading)

## Dropped from sources

- Polyphonic time-stretching (Signalsmith Stretch) and monophonic TD-PSOLA —
  deferred; playback is pitch-shift only for now.
- Round-robin and release-trigger sample groups — a later multisample feature.
