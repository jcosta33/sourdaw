---
type: spec
id: SPEC-slicer
title: Loop slicer instrument
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Loop slicer instrument

## Intent

Slice an audio loop at detected onsets, map slices onto a 16-pad performance grid with
choke groups and per-slice routing, and let a sensitivity control re-detect slices
non-destructively while honouring user-locked markers.

## Non-goals

- Time-stretching / warping of slices to a host tempo (playback is at the source rate).
- Spectral / pitch editing of slice content.
- Multi-loop layering within one slicer instance.

## Requirements

### AC-001 — Drop-to-play

Dropping a loop must auto-detect slices and map them onto the pad grid so a pad triggers a
slice without further configuration.

Verify with: `pnpm test:run -- Slicer`

### AC-002 — Monotonic sensitivity

Increasing the sensitivity value must never decrease the number of auto-detected slices.

Verify with: `pnpm test:run -- Slicer`

### AC-003 — Locked markers survive re-detection

Changing sensitivity must preserve every user-locked marker and recompute only
auto-detected markers.

Verify with: `pnpm test:run -- Slicer`

### AC-004 — Pad-to-slice mapping

Triggering pad N must play slice N (with empty pads silent) for a loop with ≤ 16 slices.

Verify with: `pnpm test:run -- Slicer`

### AC-005 — Deterministic detection

Detection on the same loop at the same sensitivity must yield identical slice boundaries
across runs.

Verify with: `pnpm test:run -- Slicer`

### AC-006 — Zero-crossing boundaries

Every slice boundary must snap to the nearest zero crossing so playback is click-free.

Verify with: `pnpm cargo:test -- -p daw-dsp slice_zero_crossing`

### AC-007 — Choke group cutoff

Triggering a pad in a choke group must cut any currently-sounding pad in the same group.

Verify with: `pnpm test:run -- Slicer`

### AC-008 — Independent per-pad parameters

Editing one pad's gain/pitch/routing must not change any other pad's parameters.

Verify with: `pnpm test:run -- Slicer`

### AC-009 — Slicer module isolation

The slicer must not import internals of other modules.

Verify with: `pnpm deps:validate`

### AC-010 — Send to Toaster

A "Send to Toaster" action must hand off all current slices as a multi-sample pad kit to the
drum-machine/Toaster sampler — each slice becoming one pad with its tune/envelope/routing
copied — as a copy that must not destroy the Slicer's own state.

Verify with: `pnpm test:run -- Slicer`

### AC-011 — "Suggest" button proposes complementary markers

A "Suggest" button must run a detection pass complementary to the active onset detector and
propose markers in a distinct "proposed" visual state with per-marker accept/reject, such that
on a soft-onset loop it proposes at least one marker the sensitivity sweep did not produce.

Verify with: `pnpm test:run -- Slicer`

### AC-012 — Per-slice output routing

Each pad must expose an output routing selector of Master, Bus 1–8, or Direct Out 1–16, with the
plugin declaring up to 16 direct-out channels to the DAW, such that routing a pad to a direct out
produces audio on that DAW channel and silence on Master.

Verify with: `pnpm test:run -- Slicer`

### AC-013 — Velocity zones and per-pad playback mode

Each pad must support up to 4 non-overlapping velocity zones with `[v_lo, v_hi]` ranges mapping
to a different slice or alternate layer (v=63 → slice A, v=64 → slice B).

Verify with: `pnpm test:run -- Slicer`

### AC-014 — Built-in step sequencer

The Slicer must own a 16/32-step sequencer with per-step velocity, pitch offset, retrigger
count, probability, and up to 4 parameter locks, a Roger-Linn swing knob, and two distinct
generative actions — Randomize (full regeneration) and Chaos (bounded jitter).

Verify with: `pnpm test:run -- Slicer`

### AC-015 — 12-hue waveform palette

The waveform must use a 12-entry palette declared as CSS custom properties
(`--color-slicer-hue-0` through `--color-slicer-hue-11`); pad N must be assigned hue `N % 12`,
the waveform region under pad N must be tinted that hue at ~25% alpha, and every hue must meet
WCAG AA contrast in both light and dark themes.

Verify with: `pnpm test:run -- Slicer`

### AC-016 — Multi-block progressive-disclosure UI

The plugin view must present 5 vertically stacked, independently collapsible blocks (Play &
Macros, Generators & Layers, Sequencing & Build, Routing & FX, Advanced / Lab) with only Play &
Macros expanded by default, mounting within 150 ms and keeping all block interactions
keyboard-accessible.

Verify with: `pnpm test:run -- Slicer`

### AC-017 — Drop-to-play performance budget

The full drop-to-play pipeline (decode, onset detection, zero-crossing refinement, marker
placement, pad mapping, render) must complete within 1000 ms on a 2 MB / ~10 s stereo 44.1 kHz
loop on a 2020-era laptop, enforced by a checked-in performance test.

Verify with: `pnpm test:run -- Slicer.perf`

### AC-018 — REX2 import

Importing a `.rx2` file must decode its slice metadata, use the REX2 slice markers as manual
(non-sensitivity-controlled) markers, and preserve the original slice-to-pad order, such that a
32-slice REX2 file produces exactly 32 markers with the first 16 pad-mapped and slice 1 playing
the REX2's slice 1.

Verify with: `pnpm test:run -- Slicer`

### AC-019 — Rejected suggestions are not re-proposed

A rejected suggestion must never be re-proposed within the session.

Verify with: `pnpm test:run -- Slicer`

### AC-020 — Per-pad playback mode

Each pad must expose a per-pad playback mode of OneShot, Gated, Loop, or Reverse.

Verify with: `pnpm test:run -- Slicer`

### AC-021 — Per-pad control surface (Tune / Envelope / Gain / Pan)

Each of the 16 pads must expose: Tune as coarse semitones (−24 to +24) plus fine cents
(−100 to +100); a full A/H/D/S/R envelope (attack, hold, decay, sustain, release) with
one-shot-friendly defaults of 0 / 0 / 200 ms / 0 / 20 ms; Gain in dB over the range −inf to
+12; and Pan over −1.0 to +1.0. All of these parameters must be automatable by DAW automation
lanes and must be persisted in the plugin's preset format.

Verify with: `pnpm test:run -- Slicer`

### AC-022 — Lab transient-detection algorithm selector

The Advanced / Lab block must expose a radio selector choosing the onset-detection algorithm
between HFC (percussive), Spectral Flux (general), and Complex Domain (melodic), defaulting to
Spectral Flux. Changing the algorithm must re-run detection on the current file and update the
Auto markers while leaving Manual/locked markers untouched.

Verify with: `pnpm test:run -- Slicer`

### AC-023 — Per-slice time-stretch algorithm selector

Each slice must expose, in the Advanced / Lab block, a `stretch_algo` selector of None |
Resample | WSOLA | PhaseVocoder, where None is natural playback, Resample ties pitch to speed
(classic sampler), WSOLA is transient-preserving and pitch-independent, and PhaseVocoder is
frequency-domain and tonal-friendly.

Verify with: `pnpm test:run -- Slicer`

## Open questions

- [ ] Q-001 — REX2 license compatibility (`.rx2` is a proprietary Propellerhead / Reason format; is shipping a REX2 reader legally safe, or must we restrict to the documented slice-marker + PCM subset or require WAV+slice-JSON export)? Bears on AC-018.
- [ ] Q-002 — Default sensitivity and the slice-count cap for very dense loops.
- [ ] Q-003 — **[CRITICAL]** Choke-group interaction with per-pad polyphony and voice stealing: when a pad in a choke group with polyphony > 1 is choked by another pad in the same group, does triggering the choking pad kill ALL voices of the choked pad or only the oldest? The choice affects both UX and voice-pool sizing and must be resolved before AC-012 implementation.

## Affected areas

- `src/modules/Slicer/` (new instrument device, pad-grid view, multi-block UI, step sequencer)
- the onset-detection DSP (`daw-dsp`: spectral flux, zero-crossing snap)
- the audio engine voice/choke-group handling
- the DAW mixer-channel / direct-out routing contract (per-slice output routing)
- the project model for instrument persistence

## Dropped from sources

- Time-stretch to host tempo — out of scope; playback at source rate.

### Restored to scope (migration had wrongly narrowed these)

The original source (`specs/missing/slicer.md`) put the following in scope as requirements; the
migrated spec had wrongly recorded them as non-goals or as merely gated. They are corrected back
to the original intent:

- **Built-in step sequencer** — original R7 made the 16/32-step sequencer in-scope for the
  Slicer (per-step velocity/pitch-offset/retrigger/probability, up to 4 parameter locks,
  Roger-Linn swing, distinct Randomize vs Chaos actions). Restored as AC-014; removed from
  non-goals; Q-003 corrected. The prior migrated spec's claim that a built-in sequencer is a
  non-goal (pads/MIDI only) is reversed.
- **REX2 import** — original R9 made `.rx2` import in-scope (decode slice metadata, map as manual
  markers, preserve slice-to-pad order; AC3: 32 slices → 32 markers, first 16 pad-mapped, slice 1
  plays REX2 slice 1). Restored as AC-018. It remains subject to the Q-001 legal-clearance open
  question; if clearance fails the feature is dropped, but the requirement itself is no longer
  framed as out of v1 scope.
