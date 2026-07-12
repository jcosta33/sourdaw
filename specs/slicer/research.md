---
type: research
id: RESEARCH-slicer
title: Loop slicing and pad performance
status: open
owner: The Sourdaw team
sources:
  - "Question: how do production slicers detect onsets, map slices to pads, and handle choke groups and REX import?"
---

# Research: Loop slicing and pad performance

## Question

How do production loop slicers detect onsets, expose a sensitivity control, map slices to
a pad grid with choke groups, and interoperate with the REX2 format?

## Findings

### R-001 — Spectral-flux onset detection with a sensitivity threshold

- **Claim:** Spectral-flux (or HFC) onset detection with an adjustable peak-picking threshold is the standard slicer detector; the sensitivity slider maps monotonically to that threshold so higher sensitivity yields more or equal slices.
- **Evidence:** aubio/librosa onset methods; Recycle/Serato Sample/Ableton Simpler slicing behaviour.
- **Confidence:** high
- **Bears on:** AC-002 (sensitivity monotonicity), AC-005 (deterministic suggestions).

### R-002 — Zero-crossing snap removes click artifacts

- **Claim:** Snapping each slice boundary to the nearest zero crossing eliminates the click that an arbitrary mid-waveform cut produces.
- **Evidence:** standard sample-editing practice; click = discontinuity at the splice.
- **Confidence:** high
- **Bears on:** AC-006 (zero-crossing snap).

### R-003 — Pad grid with choke groups

- **Claim:** A 16-pad grid with choke groups (a pad in a group cuts others in the same group) is the established performance model; per-slice routing and parameters live on each pad.
- **Evidence:** MPC choke groups; Battery/Maschine pad architecture.
- **Confidence:** high
- **Bears on:** AC-004 (pad mapping), AC-007 (choke), AC-008 (per-pad params).

### R-004 — Locked markers survive re-detection

- **Claim:** User-locked slice markers must be preserved when sensitivity is changed and detection re-runs — only auto-detected markers are recomputed.
- **Evidence:** Recycle's manual-marker behaviour; source design notes.
- **Confidence:** medium
- **Bears on:** AC-003 (locked markers).

### R-005 — REX2 import maps slices to the grid

- **Claim:** REX2 files carry pre-computed slice points; import should map those slices directly onto pads, bypassing re-detection.
- **Evidence:** REX2 format documentation; common slicer import paths.
- **Confidence:** medium
- **Bears on:** the REX2 import open question.

## Open questions

- [ ] Q-001 — Is REX2 import in v1 scope or a follow-up (format-licensing and parser cost)?
- [ ] Q-002 — Default sensitivity and the slice-count cap for very dense loops.
- [ ] Q-003 — Step-sequencer integration: does the slicer own a sequencer or feed an external one?

## Recommendation

Use spectral-flux onset detection with a monotonic sensitivity threshold (R-001), snap
boundaries to zero crossings (R-002), expose a 16-pad grid with choke groups and per-pad
routing (R-003), and preserve locked markers across re-detection (R-004). Treat REX2
import (R-005) as gated on Q-001.

## Restored from research/factory/samples-slicer.md (Section 2)

The following Slicer UX detail was dropped during migration. It is restored here verbatim
from the original `research/factory/samples-slicer.md`, Section 2 "Slicer Plugin UX &
Architecture", so that the spec's reliance on co-located research holds.

### R-006 — 12-hue waveform palette matching pad colors

- **Claim (verbatim from source):** "Waveform Display: 12-hue palette matching pad colors,
  draggable slice boundary handles with zero-crossing snap." The waveform-display color
  mapping uses a 12-hue palette in which the waveform region under a pad is tinted the same
  hue as that pad, making the visual-to-tactile mapping obvious.
- **Source:** `research/factory/samples-slicer.md`, Section 2, "Generators & Layers" and
  "Waveform Display" bullets.
- **Bears on:** the waveform-palette requirement (spec AC-015), AC-008 (per-pad params).

### R-007 — "Suggest" AI onset detection (distinct from the classical sensitivity threshold)

- **Claim (verbatim framing from source):** "Generators & Layers: Sensitivity slider
  (continuous threshold mapping) with 'Suggest' AI detection, dual-color markers (auto vs.
  manual/locked), and per-pad tuning/envelopes." The "Suggest" control is an AI-assisted
  slice-suggestion action distinct from the continuous sensitivity-threshold sweep: the
  sensitivity slider sweeps a precomputed onset-detection-function threshold, whereas
  "Suggest" runs a separate AI/complementary detection pass that proposes slice points the
  threshold sweep missed.
- **Source:** `research/factory/samples-slicer.md`, Section 2, "Generators & Layers" bullet.
- **Bears on:** the "Suggest" UX requirement (spec AC-011), R-001 (sensitivity threshold).

### R-008 — Per-slice "Routing & FX": output routing, choke groups, and velocity-zone mapping

- **Claim (verbatim from source):** "**Routing & FX:** Per-slice output routing (separate
  DAW mixer channels), choke groups, and velocity zone mapping." Each slice/pad carries its
  own output routing to a separate DAW mixer channel, participates in choke groups, and
  supports velocity-zone mapping so a pad can map velocity ranges to different slices or
  layers.
- **Source:** `research/factory/samples-slicer.md`, Section 2, "Routing & FX" bullet.
- **Bears on:** per-slice output routing (spec AC-012), choke groups (AC-007), velocity
  zones (AC-013).
