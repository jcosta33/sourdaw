---
type: research
id: RESEARCH-atmos-special-effects
title: Special-effects sound design — MIDI FX (Yeast) and pitch correction (Knead)
status: open
owner: The Sourdaw team
sources:
  - Melodyne DNA, Auto-Tune, pYIN / YIN pitch-tracking literature
  - STFT phase-vocoder and partial-tracking references
---

# Research: Special-effects sound design — MIDI FX (Yeast) and pitch correction (Knead)

## Question

What signal-processing and workflow capabilities do a MIDI effects rack (Yeast)
and a pitch-correction module (Knead) need — and which of them inform immersive
sound-design (placing and shaping sources for the Atmos engine)?

## Findings

### R-001 — Yeast lacks the visual feedback that makes MIDI FX usable

- **Claim:** A MIDI effects rack needs a live piano-roll preview of transformed
  output and groove-template extraction from audio/MIDI; without preview, users
  cannot predict an arpeggiator or chord device's result.
- **Evidence:** Bitwig and Logic MIDI FX both expose a preview lane; their
  absence is the top usability complaint for blind MIDI transformers.
- **Confidence:** medium
- **Bears on:** future Yeast spec; not the Atmos engine directly.

### R-002 — Monophonic pitch correction needs pYIN, not bare YIN

- **Claim:** Robust monophonic correction requires probabilistic YIN (pYIN) for
  pitch tracking plus formant estimation and preservation so transposition does
  not produce "chipmunk" artifacts.
- **Evidence:** pYIN's HMM smoothing outperforms YIN on octave errors; formant
  preservation via spectral-envelope shifting is standard in Melodyne/Auto-Tune.
- **Confidence:** high
- **Bears on:** future Knead spec.

### R-003 — Polyphonic decomposition is an STFT + partial-tracking problem

- **Claim:** "DNA-level" polyphonic editing requires STFT analysis, partial
  tracking, and a phase vocoder to separate and re-pitch overlapping notes.
- **Evidence:** Melodyne DNA's published approach; phase-vocoder re-synthesis is
  the established technique for independent partial manipulation.
- **Confidence:** medium
- **Bears on:** future Knead spec; the partial-tracking primitives overlap with
  spectral sound-design.

### R-004 — Spectral analysis primitives are shared with immersive sound design

- **Claim:** The STFT/partial-tracking and formant tooling Knead needs is the
  same family of analysis used to characterize a source before spatial
  placement (transient detection, spectral centroid, width).
- **Evidence:** Source-width spread (MDAP) and per-object EQ in an Atmos mix
  consume the same spectral features partial tracking produces.
- **Confidence:** low
- **Bears on:** Atmos object pre-processing — opportunistic reuse, not a
  dependency.

## Open questions

- [ ] Q-001 — Are Yeast and Knead better served as their own specs rather than
  living under the Atmos research folder? (They are co-located here only because
  the source bundled them.)
- [ ] Q-002 — Is there real DSP reuse between Knead's partial tracking and the
  Atmos object analyzer, or is the overlap superficial?

## Recommendation

Treat Yeast and Knead as separate future features; this note exists to preserve
their research alongside Atmos because both touch spectral sound design. Only
R-004's shared-analysis observation bears on the Atmos engine, and only weakly —
do not couple the Atmos spec to pitch-correction work. Promote Yeast and Knead
to their own specs when prioritized.
