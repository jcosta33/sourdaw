---
type: spec
id: SPEC-orchestra-spectral-modeling
title: Orchestra spectral modeling synthesis (SMS)
status: draft
owner: The Sourdaw team
sources:
  - self
---

# Orchestra spectral modeling synthesis (SMS)

## Intent

Add a spectral-modeling layer to Orchestra for resynthesis, phrase morphing, and
transient-aware time-stretch/pitch-shift: analyze samples into partials + noise +
transients off the audio thread, then resynthesize in real time without smearing
attacks.

## Non-goals

- The core sample-playback engine — owned by `SPEC-orchestra`.
- GPU offloading of partial-bank rendering — owned by
  `SPEC-orchestra-gpu-visualization`.
- Physical-modeling augmentation — owned by `SPEC-orchestra-physical-modeling`.

## Requirements

### AC-001 — Analysis separates partials, noise, and transients

When a sample is analyzed, the pipeline must produce partial tracks, a stochastic
noise-residual envelope, and detected transient events as separate components.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::sms::analysis_three_components`

### AC-002 — Noise is modeled as a filtered stochastic term

When resynthesizing the noise component, the engine must shape filtered noise by
the stochastic envelope rather than approximating noise with many sinusoids.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::sms::noise_is_stochastic`

### AC-003 — Synthesis uses recursive oscillators, not per-sample sin()

When resynthesizing partials, the oscillator bank must use recursive sin/cos
updates rather than calling `sin()` per sample.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::sms::recursive_oscillators`

### AC-004 — Transients are injected, not stretched

When time-stretching, the engine must reinsert detected transient waveforms at
their scheduled times rather than stretching them.

Verify with: `pnpm cargo:test -- -p daw-dsp levain::sms::transients_not_stretched`

## Open questions

- [ ] (blocking) Which time-stretch method is the default (WSOLA, phase vocoder,
  or an external hybrid) for each use (legato vs sustained pads)? Required before
  build.
- [ ] (non-blocking) Onset-detection function family (energy / spectral flux /
  complex-domain / multi-band) for transient detection.

## Affected areas

- `crates/daw-dsp/src/levain/sms/` (analysis, partial tracking, transient
  detection, resynthesis)
- `crates/daw-dsp/src/` (STFT windows, overlap-add, fast oscillators)

## Dropped from sources

- The time-stretch method comparison table and onset-detection literature —
  design rationale informing the Open questions, not requirements. The full
  onset-detection function family (energy envelope derivative, spectral flux,
  phase/complex-domain, multi-band fusion) is restored verbatim in `research.md`.
- Vibrato spectral envelope modulation (SEM) as a named SMS application — the
  source lists it alongside phrase morphing; restored in `research.md` as design
  rationale, not (yet) a requirement.
- "Texture layer" creative features built on SMS — deferred until the analysis/
  resynthesis core lands.
