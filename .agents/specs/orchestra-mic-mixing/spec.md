---
type: spec
id: SPEC-orchestra-mic-mixing
title: Orchestra microphone positions and spatial mixing
status: in-progress
owner: The Sourdaw team
sources:
  - self
---

# Orchestra microphone positions and spatial mixing

## Intent

Let Orchestra blend the multiple recorded microphone positions (close, Decca
tree, room, outrigger, and the rest) per instrument with independent
volume/pan/delay, align close mics to avoid comb filtering while preserving room
depth, and place instruments on a virtual stage when true mic positions are not
available.

## Non-goals

- Convolution reverb / room IR processing — owned by
  `SPEC-orchestra-convolution-reverb`.
- The recorded multi-mic sample assets (asset work).
- The mic-mixer UI surface — owned by `SPEC-orchestra-progressive-disclosure-ux`.

## Requirements

### AC-001 — Mic positions mix by per-mic volume and pan

When more than one mic position is enabled, the engine must sum them using each
mic's volume and pan settings.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::mics::mix_volume_pan`

### AC-002 — A disabled mic position is unloaded

When a mic position is disabled, the engine must stop mixing and free its sample
data so memory drops accordingly.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::mics::disable_unloads`

### AC-003 — Per-mic delay simulates distance

When a mic's distance delay is set, the engine must delay that mic's signal by
the configured amount relative to the close mic.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::mics::distance_delay`

### AC-004 — Close-mic alignment is computed offline, applied as a static delay

When close-mic alignment is requested, the delay must be estimated off the audio
thread (GCC-PHAT) and applied on the hot path as a fixed per-zone delay that
does not change during playback.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::mics::gcc_phat_static_delay`

### AC-005 — Room mic arrival is preserved by default

When mixing room and close mics without explicit alignment, the engine must keep
the room mic's natural arrival delay rather than aligning it to the close mic.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::mics::preserve_room_delay`

### AC-006 — Virtual stage positioning when true mics are unavailable

When an instrument exposes only one mic position, selecting a stage seat must
apply that seat's pan and distance simulation (pan + HF air-absorption +
wet/dry) to place it.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::mics::virtual_stage`

## Open questions

- [ ] (non-blocking) Phase-invert and stereo-width per mic — expose now, or defer
  until the mic-mixer UI lands?
- [ ] (non-blocking) Surround (5.1/7.1) mic routing — in this spec or a later
  multi-out spec?

## Affected areas

- `crates/daw-dsp/src/levain/mics/` (mixer, per-mic delay, GCC-PHAT estimation,
  virtual stage)
- `crates/daw-core/` (`MicId`, `MicPositionId` newtypes)

## Dropped from sources

- The full mic-position catalogue and "typical blend" recipes — preset/asset
  guidance, not engine requirements.
- GCC-PHAT internals (FFT, cross-power spectrum, PHAT weighting) — implementation
  detail behind AC-004's observable (a correct static per-zone delay).
