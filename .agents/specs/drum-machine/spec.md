---
type: spec
id: SPEC-drum-machine
title: Flagship drum machine
status: in-progress
owner: The Sourdaw team
sources:
  - ../drum-machine-realism/research.md
---

# Flagship drum machine

## Intent

Ship a single flagship pad-based drum instrument where every pad is a full instrument channel
hosting sampled and/or synthesized voices with its own layers, filter, insert FX, transient
shaper, modulation, and routing — driven by an integrated step sequencer with parameter locks,
conditional triggers, and micro-timing at MPC/Digitakt quality. It matches or exceeds Logic DMD,
Ableton Drum Rack, and Battery 4, runs RT-safe on native and WASM, and shares DSP with Fermenter.

## Non-goals

- AI groove/pattern generation — split into `../drum-machine-groove-classifier/spec.md`,
  `../drum-machine-text-to-pattern/spec.md`, `../drum-machine-groove-templates/spec.md`.
- Articulation maps and cross-device rack chaining — separate specs.
- Neural/AI audio synthesis of drum sounds.

## Requirements

### AC-001 — Each pad is a full instrument channel

Every pad must host one or more layers (sample player, multi-sample, or drum synth engines) with
its own layer mixer, filter, insert FX, transient shaper, and output routing.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_pad_channel`

### AC-002 — Inference-free audio thread is RT-safe

`process()` must perform no allocation, no mutex locks, and no blocking on the audio thread, on
both native and WASM, with all voices/buffers/delay-lines pre-allocated at init.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_rt_safety`

### AC-003 — Purpose-built drum synth engines render their voices

Dedicated engines (808 physically-informed kick, 909 kick, analog kick, snare, hi-hat/cymbal,
clap, tom, modal percussion) must each synthesize their voice, not a generic osc+filter.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_synth_engines`

### AC-004 — Sample player supports zones, round-robin, and interpolation

The sample/multi-sample player must map velocity/note zones with round-robin and velocity
crossfade, using cubic-Hermite interpolation and O(1) zone lookup.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_sample_player`

### AC-005 — The step sequencer drives per-step expression

The integrated sequencer must support per-step probability, velocity, micro-timing, parameter
locks, conditional triggers, and sound locks committed through the sequencer model.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_step_sequencer`

### AC-006 — Choke groups silence group members on trigger

Triggering a pad must fast-fade (5–10 ms) other pads in the same choke group (e.g. closed hat
chokes open hat).

Verify with: `pnpm cargo:test -- -p daw-dsp drum_choke_groups`

### AC-007 — Voice management steals and chokes correctly

Voice allocation must steal same-pad-oldest then global-oldest within a shared 64–128 voice pool,
with choke kills applied as immediate fast fades.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_voice_manager`

### AC-008 — Per-pad chain routes to buses and sends

Each pad must route through filter → insert FX → transient shaper to master/bus/direct-out with
two global sends, per-pad send levels, and a per-pad mixer channel.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_routing`

### AC-009 — Lo-fi vintage mode applies character processing

A vintage character mode must apply bit reduction (with TPDF dither), sample-rate reduction, and
analog-style filtering modeled on SP-1200-class behavior.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_lofi`

### AC-010 — Auto-slice maps a dropped loop to pads

Dropping a drum loop must detect onsets, refine to zero-crossings, map slices to pads, and create
a replay pattern preserving original timing.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_auto_slice`

### AC-011 — Progressive-disclosure UI exposes five levels

The UI must present five levels (Play, Shape, Build, Route, Lab) so a Level-1 user sees only the
pad grid, browser, macros, and transport.

Verify with: `manual` — switch through all five UI levels and confirm controls appear/disappear per level

### AC-012 — Workspace boundaries and tests pass

The instrument must keep DDD boundaries and pass the workspace build.

Verify with: `pnpm deps:validate`

### AC-013 — Euclidean rhythm generator distributes hits evenly

The sequencer must provide a Euclidean generator `E(k, n, rotation)` that distributes `k` hits
across `n` steps as evenly as possible via the Bjorklund recursive algorithm, with a rotation
offset, committing the result as steps through the sequencer model.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_euclidean_generator`

### AC-014 — Ratcheting emits sub-triggers within a step

A step must be able to fire `ratchet_count` sub-triggers, each spaced at
`sub_interval = step_duration / ratchet_count`, with each sub-trigger receiving a tapered velocity.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_ratcheting`

### AC-015 — Pattern morph interpolates between two patterns

Pattern morph must interpolate between patterns A and B such that triggers crossfade by
probability, velocity interpolates linearly, micro-timing interpolates, and ratchets snap to the
nearest integer.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_pattern_morph`

### AC-016 — 16 Levels remaps the grid to one pad's levels

In 16 Levels mode (MPC-style) the entire pad grid must become 16 velocity/parameter levels of the
single selected pad.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_sixteen_levels`

### AC-017 — Note Repeat retriggers in sync with tempo

Note Repeat must produce tempo-synced retriggers selectable from 1/4 to 1/32 (including triplet
rates) while a pad is held, with velocity-ramp options.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_note_repeat`

### AC-018 — Fill mode activates Fill-conditioned steps while held

Holding Fill must activate steps whose conditional trigger is `Fill` (and suppress `NotFill`
steps) only for the duration the control is held.

Verify with: `pnpm cargo:test -- -p daw-dsp drum_fill_mode`

## Open questions

- [ ] (blocking) Resolve the "Grinder" codename collision with the existing amp-sim module before
  implementation.
- [ ] (non-blocking) Own crate (`src-tauri/grinder/`) vs `fermenter/src/drums/`? Proposed: reuse Fermenter DSP.
- [ ] (deferred-gap from intake/implementation-gaps.md) §1.1 The Master Drum Machine — architectural
  upgrade-vs-new-module decision. Current state: `Grinder` is currently implemented as an Amp Simulator
  (codename now collides with this drum device, see blocking question above), and `Toaster` is a basic
  pad-based sampler. The gap is that we lack the flagship, Ableton/Maschine-tier Drum Machine. Decide
  architecturally whether to upgrade `Toaster` into this flagship device or create a new dedicated
  crate/module rather than extending the existing sampler. This decision gates the crate-location
  question above (`src-tauri/grinder/` vs `fermenter/src/drums/` vs upgraded `Toaster`). Non-blocking:
  the AC behaviors (engines, sequencer, transient shaper, slicing) hold regardless of which module hosts
  them.

## Affected areas

- `crates/daw-dsp/` (new drum engines, sample player, sequencer, voice manager; reuses Fermenter filters/FX/envelopes)
- React 19 frontend (pad grid, inspector, sequencer, mixer, FX chains)
- preset format (versioned JSON)

## Dropped from sources

- AI groove/pattern generation (Part 3.5) — moved to three sibling specs.
- Articulation maps, device-rack chaining — separate specs.
- The exhaustive circuit math/reference-implementation appendix — kept in the research note, not the spec.
