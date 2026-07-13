---
type: research
id: RESEARCH-knead
title: Knead — pitch correction and melodic editing (DSP derivations & workflows)
status: open
owner: The Sourdaw team
sources:
  - "research/factory/special-effects.md (migration-recovered §2 Knead)"
---

# Research: Knead — Pitch Correction and Melodic Editing

_Restored verbatim from `research/factory/special-effects.md` §2 (migration-lost
content). Numeric DSP derivations and production workflows that inform the Knead
spec (`./spec.md`)._

**Codebase Status:** The real-time monophonic MVP is **implemented**, including YIN tracking (`yin.rs`), the PSOLA shifter (`psola.rs`), voicing detection (`voicing.rs`), the `KneadEngine`, and the basic `KneadEditor.tsx` UI shell with `NoteBlob` models.

## 2.1 Missing Advanced Monophonic Features

**pYIN — Probabilistic Candidates & Sequence Decoding**
_(Status: **Missing**. Only standard YIN is implemented; `pYIN` is absent from the DSP codebase.)_

- Produce **multiple pitch candidates** with probabilities.
- Use an HMM decoded with Viterbi to pick a globally consistent pitch track and jointly estimate voicing.
- Includes transition costs for continuity vs. octave jumps and V/UV chatter.

**Formant Estimation, Preservation, and Shifting**
_(Status: **Missing**. The UI has a `formantPreserve` toggle, but there is no LPC or cepstral formant DSP engine.)_

- **LPC envelope**: LPC order 12–20, pre-emphasis 0.95, analysis frame 20–40 ms.
- **Cepstral envelope**: lifter approach for inharmonic signals.
- **Mechanism**: compute spectral envelope, shift fine structure, preserve/follow/shift envelope independently.

**Complex Blob Editing Tools**
_(Status: **Incomplete**. `NoteBlob` rendering exists, but advanced repair tools are missing.)_

- "Assignment Mode (Lab)" for editing detection rather than the sound directly.
- Operations needed: split note at cursor, merge contiguous notes, reassign partials, add/remove note hypotheses.

## 2.2 Missing Polyphonic "DNA-level" Decomposition Mode (Lab)

_(Status: **Entirely Missing**. No STFT, partial tracking, or harmonic grouping code exists in `daw-dsp/src/knead/`.)_

**Polyphonic Pipeline Overview**

- STFT (e.g., Blackman-Harris 8192 window, 2048 hop).
- Peak picking and sub-bin quadratic interpolation.
- Partial tracking (peak matching, birth/death, slope constraints).
- Harmonic grouping into note objects using subharmonic summation or GCD-like f0 candidates.
- Soft masks / spectral proportion factors for soft attribution.
- Residual modeling (keeping transients/noise outside stable partial tracks).

**Phase Vocoder (Peak-based / Phase-locked)**
_(Status: **Missing**. Only PSOLA is implemented, limiting large pitch shifts and polyphony.)_

- STFT analysis, transient detection, phase propagation with phase-locking around spectral peaks to reduce "phasiness".

**Transient Detection and Preservation**
_(Status: **Missing**.)_

- Mark transient frames using spectral flux / energy slope.
- Route transient energy into the residual or handle with time-domain methods to prevent phase-vocoder smearing.

**Hybrid Designs with Neural Multipitch Priors**
_(Status: **Missing**.)_

- Use NN posteriorgrams (e.g., Basic Pitch via ONNX/`ort` crate) to propose active pitches, onsets, and confidence regions.
- Run sinusoidal tracking constrained to those neural proposals.

## 2.3 Missing Production Workflows (Route Level)

_(Status: **Missing** from both the UI and DSP engine.)_

- **Harmonizer**: Up to 4 voices, scale-aware intervals (3rd/5th/octave), spread (delay/detune/formant variance).
- **Doubler**: Two default layers with random drift and microtiming.
- **Pitch-to-MIDI**: Mono mode from blobs and poly mode from NN posteriorgrams (export).
- **Performance Transfer (Revoice-style)**: Guide track + dub track with transfer strength for timing, pitch, and level.

## 2.4 A Serious Vocal Suite (Bundle)

_(Status: **Missing**. Knead provides the foundation, but a comprehensive workflow bundle is absent.)_
To rival paid DAWs, Sourdaw needs a vocal lane that feels intentional, not merely possible.

- **Pitch Correction:** Deep integration with formant preservation.
- **Doubler / Harmonizer:** Real-time generation of multiple voices.
- **De-esser:** Dedicated vocal de-essing (a basic Faust one exists, needs UI integration).
- **Vocal Comp Strip:** Transient cleanup / breath control.
- **Vocal-Specific FX:** Delay/reverb presets tailored for vocals.
- **Fast Path:** "Record → comp → tune → polish" unified workflow.
