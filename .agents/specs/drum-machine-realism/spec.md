---
type: spec
id: SPEC-drum-machine-realism
title: Circuit-faithful drum synthesis engines
status: in-progress
owner: The Sourdaw team
sources:
  - research.md
---

# Circuit-faithful drum synthesis engines

## Intent

Replace the Toaster drum machine's simplified parametric voices with circuit-informed models
that reproduce the timbral character of the TR-808, TR-909, SP-1200, LinnDrum, and CR-78,
using documented transfer functions, component values, and nonlinearities — additively, so
the existing generic engines remain available.

## Non-goals

- Pads, sequencer, routing, UI, or preset management (owned by the main drum machine spec).
- Wave digital filter implementation (a future fidelity upgrade).
- Sample-playback engines, multi-sample, or auto-slice.
- New effect types (reverb, delay, compressor) and time-stretch algorithms.
- Oversampling for the saturation curves used here.

## Requirements

### AC-001 — 808 kick is a bridged-T resonator with attack chirp

The 808 kick must produce a sub-bass tone near 49 Hz with a downward pitch chirp from
~130 Hz on attack, driven by an envelope-controlled bridged-T network.

Verify with: `pnpm cargo:test -- -p daw-dsp kick_808`

### AC-002 — 808 kick accent is timbral

When accent rises, the 808 kick must change ring time, chirp depth, and harmonic content —
not only output level.

Verify with: `pnpm cargo:test -- -p daw-dsp kick_808`

### AC-003 — 808 snare has dual tonal components plus noise

The 808 snare must produce two tonal components near 173 Hz and 335 Hz crossfaded by Tone,
with noise amplitude scaled by Snappy.

Verify with: `pnpm cargo:test -- -p daw-dsp snare_808`

### AC-004 — 808 hi-hat uses six square oscillators

The 808 hi-hat must synthesize its metallic character from six PolyBLEP square oscillators
at the measured frequencies, not loopback-FM sine oscillators.

Verify with: `pnpm cargo:test -- -p daw-dsp hihat_808`

### AC-005 — Square oscillators are band-limited

A PolyBLEP square oscillator must produce no spectral content above 20 kHz at a -60 dB
threshold.

Verify with: `pnpm cargo:test -- -p daw-dsp poly_blep`

### AC-006 — Closed hat chokes open hat

When the closed hat triggers while the open hat is sounding, the open hat must be silenced
within 1 ms.

Verify with: `pnpm cargo:test -- -p daw-dsp hihat_808`

### AC-007 — 909 kick is distinct from the 808

The 909 kick must use a phase-reset VCO with diode waveshaper and a separate click path,
giving more midrange punch than the 808 kick.

Verify with: `pnpm cargo:test -- -p daw-dsp kick_909`

### AC-008 — 909 LFSR noise is deterministic

The 31-bit LFSR must be deterministic for a given seed and have period 2,147,483,647.

Verify with: `pnpm cargo:test -- -p daw-dsp lfsr`

### AC-009 — SP-1200 drop-sample aliasing is present

The SP-1200 effect must produce non-harmonic aliasing from no-interpolation drop-sample
pitch shifting at non-integer ratios.

Verify with: `pnpm cargo:test -- -p daw-dsp sp1200`

### AC-010 — LinnDrum µ-law expansion warms low-level detail

The LinnDrum model must expand 8-bit samples through µ-255 companding, increasing low-level
detail over linear 8-bit quantization.

Verify with: `pnpm cargo:test -- -p daw-dsp mu_law`

### AC-011 — Component tolerance is seeded and bounded

A non-zero tolerance seed must vary center frequency and decay within ±20% for capacitors
and ±5% for resistors.

Verify with: `pnpm cargo:test -- -p daw-dsp tolerance`

### AC-012 — Every voice output is DC-blocked

Each circuit-faithful voice output must pass through a DC blocker so sustained retriggering
accumulates no DC offset.

Verify with: `pnpm cargo:test -- -p daw-dsp dc_block`

### AC-013 — Engine process paths are allocation-free

No engine's per-sample processing must allocate on the heap, lock a mutex, or block.

Verify with: `pnpm cargo:test -- -p daw-dsp toaster`

### AC-014 — No cross-module internal imports

This feature must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-015 — All IIR filter states flush denormals

Every IIR filter state in the circuit-faithful engines (bridged-T, SVF, biquad cascades,
one-pole) must flush denormals via a platform-appropriate mechanism (x86 MXCSR FTZ+DAZ bits
0x8040; ARM flush-by-default; a portable WASM fallback), so a decaying state never triggers a
denormal CPU spike.

Verify with: `pnpm cargo:test -- -p daw-dsp denormal`

### AC-016 — 808 clap is a dual-path multi-burst

The 808 clap must produce three rapid sawtooth sub-envelope bursts at ~100 Hz plus a 20 ms
final discharge on a burst path, summed with a parallel ~100 ms RC reverb-tail path.

Verify with: `pnpm cargo:test -- -p daw-dsp clap_808`

### AC-017 — 909 clap is a four-burst envelope

The 909 clap must produce four sequential op-amp-style bursts ~11 ms apart on its primary
path plus a longer-decay reverb-tail path, giving its distinct "ta-ta-ta-TAA" attack.

Verify with: `pnpm cargo:test -- -p daw-dsp clap_909`

### AC-018 — 909 hi-hat plays a pre-baked 6-bit buffer

The 909 hi-hat must generate a metallic-noise buffer from the six-oscillator bank at init,
quantized to 6-bit (64 levels) at ~1 s / 32 kHz.

Verify with: `pnpm cargo:test -- -p daw-dsp hihat_909`

### AC-019 — 808 toms, cowbell, clave, rimshot, and maracas are circuit-specific

Each remaining 808 voice must use its documented topology: toms as bridged-T with a
diode-driven downward pitch sweep, cowbell from oscillators 1+2 (800/540 Hz) through an
~850 Hz BPF, clave as a single bridged-T at 2500 Hz, rimshot as two bridged-T at 1667/455 Hz
with HPF, and maracas as broadband white noise through a VCA.

Verify with: `pnpm cargo:test -- -p daw-dsp perc_808`

### AC-020 — CR-78 voices use swing-VCA envelopes and an RLC metallic beat

The CR-78 voices must use single-transistor swing-type VCA envelopes, synthesize the hi-hat
from squares plus white noise through a bridged-T bandpass, and model the metallic beat as
three filtered squares through a Q≈10–15 RLC bandpass resonator.

Verify with: `pnpm cargo:test -- -p daw-dsp cr78`

### AC-021 — LinnDrum kick/toms/congas pass through a CEM3320 VCF

The LinnDrum model must apply a 24 dB/oct CEM3320-style ladder lowpass (four cascaded
one-poles with feedback saturation `gm·tanh((Vin−Vfb)/2Vt)`) to kick, toms, and congas, with
no anti-aliasing on playback by design.

Verify with: `pnpm cargo:test -- -p daw-dsp linndrum`

### AC-022 — SP-1200 reproduces all five signal-chain stages

The SP-1200 effect must implement the full chain — an ~13 kHz 8th-order elliptic anti-alias
input filter (≥42 dB at Nyquist), 12-bit ADC, drop-sample pitch shift, a ZOH DAC with no
reconstruction filter (spectral imaging), and channel-dependent output filters — at a 26.04 kHz
sample rate, not the aliasing stage alone.

Verify with: `pnpm cargo:test -- -p daw-dsp sp1200`

### AC-023 — Memoryless nonlinearities use first-order ADAA

Every memoryless saturation stage in these engines (tanh, diode clip, hard clip) must apply
first-order antiderivative antialiasing using the correct antiderivative, not raw pointwise
evaluation.

Verify with: `pnpm cargo:test -- -p daw-dsp adaa`

### AC-024 — Envelopes are exponential RC decays

All voice envelopes must use exponential RC decay (`state = target + (state−target)·coeff`),
with multi-burst envelopes built as RC-stage state machines, rather than linear ramps.

Verify with: `pnpm cargo:test -- -p daw-dsp rc_decay`

### AC-025 — 909 snare uses LFSR noise and 909 component values

The 909 snare must use the dual bridged-T architecture driven by the 31-bit LFSR noise
source (not white noise) with 909-appropriate higher, sharper component values, giving it a
distinct character from the 808 snare.

Verify with: `pnpm cargo:test -- -p daw-dsp snare_909`

### AC-026 — Adapted reference code carries its required license notice

Any engine source file that adapts code, algorithms, or structural patterns from
mi-plaits-dsp-rs, Plaits, DaisySP, or ChowKick must carry that project's required copyright
and license-header notice; a file implemented only from the math in the spec/research needs no
notice.

Verify with: `rg -l "Adapted from|Based on Mutable" crates/daw-dsp/src/toaster/engines/`

### AC-027 — Tolerance seed 0 is deterministic nominal

With a tolerance seed of 0, every circuit-faithful voice must use nominal component values
deterministically.

Verify with: `pnpm cargo:test -- -p daw-dsp tolerance`

### AC-028 — 909 hi-hat tune changes playback rate, not buffer content

The 909 hi-hat tune parameter must change the pre-baked buffer's playback rate through a
post-DAC lowpass, leaving the buffer content unchanged.

Verify with: `pnpm cargo:test -- -p daw-dsp hihat_909`

## Open questions

- [ ] (non-blocking) Expose congas as distinct voices, or leave them to sample-based alternatives?
- [ ] (non-blocking) Timing of a wave-digital-filter fidelity upgrade beyond the behavioral biquads.

## Affected areas

- `crates/daw-dsp/src/toaster/engines/` (`kick_808`, `kick_909`, `snare_808`, `hihat_808`, `hihat_909`, `clap_808`, `clap_909`, `tom_808`, `perc_808`, `cr78`)
- `crates/daw-dsp/src/toaster/` primitives (`bridged_t`, `poly_blep`, `adaa`, `dc_block`, `tolerance`, `lfsr`, `sp1200`, `mu_law`)
- `crates/daw-dsp/src/toaster/engines/mod.rs` (`DrumEngineType` variants)

## Dropped from sources

- Full WDF modeling — behavioral biquads (bilinear, TDF-II) are the starting point; WDF is a future upgrade (see `research.md`).
- CNN/neural processing for any voice — out of scope here.
- Oversampling for nonlinearities — first-order ADAA suffices for the gentle saturation curves used.
- Circuit-level mechanism detail behind the surviving requirements — exact 808 kick component
  values (R165 47k, R166 6.8k, R167 1M, C41/C42 15 nF), the Werner Q43-leakage pitch-sigh
  constants (α=14.3150, V₀=−0.5560, m=1.4765e−5), the feedback-path/feedback-buffer transfer
  functions, and the per-voice component tables — are not duplicated as ACs here; they are
  restored verbatim in `research.md` ("Restored detail sections") and remain the source of
  truth for the fidelity targets named in AC-001…AC-026 (original lost item 18).
- 909 kick circuit-level mechanism behind AC-007 (no §3 "TR-909" detail section survives in
  `research.md`, unlike the 808 kick's full table restore): the back-to-back 1N4148 diode
  waveshaper obeys the Shockley equation `I = Is·(e^(V/(n·VT))−1)` with Is ≈ 2.52 nA, n ≈ 1.0,
  VT ≈ 25.85 mV; resting pitch ~55 Hz set by R59 = 47 kΩ; tune-range cap C9 = 0.22–0.33 µF
  (varies by PCB revision); EG3 supplies the instant-attack / slow-decay pitch contour and
  ENV-2 the lower click-path amplitude envelope (LPF/BPF transient + filtered LFSR noise); the
  VCO resets phase on every trigger via Q11 for a consistent click. These are the source of
  truth for the "phase-reset VCO + diode waveshaper + separate click path" named in AC-007
  (original lost items 2, 7).
- 909 noise-generator hardware behind AC-008/AC-025: two CD4006 18-stage shift registers plus
  one CD4070 quad-XOR gate form the 31-stage maximal-length LFSR (taps at stages 31 and 13).
  Hardware clock note (informative): the hardware LFSR is clocked at ~300 kHz while the DSP
  runs it at the audio sample rate; the decimation factor does not materially alter the spectral
  character at typical audio rates, so AC-008 specifies sample-rate clocking, not the 300 kHz
  rate (original lost items 3, 8).
- 909 hi-hat EPROM provenance (informational) behind AC-018: three 32 KB HN61256P EPROMs hold
  the cymbal samples, recorded from Paiste and Zildjian hi-hat cymbals by Roland engineer
  Atsushi Hoshiai; the model is a pre-baked oscillator-bank buffer substitute, not a re-capture
  of those recordings (original lost item 4).
- 909 clap circuit constants behind AC-017: the BPF-filtered LFSR noise is centered at ~1140 Hz
  with Q ≈ 1.95, and C61 = 0.01 µF sets the reverb-tail decay timing (original lost item 5).
- SP-1200 Stages 1–4 constants behind AC-022 (the restored `research.md` §4 keeps only Stage 5
  + the SSM2044 detail): Stage 1 is an order-11 IIR anti-alias input filter at 96 kHz, derived
  via SPICE AC analysis → MATLAB `invfreqz.m` system identification, attenuating 42 dB at
  Nyquist; Stage 2 is an AD7541 12-bit DAC (4096 levels, 72 dB dynamic range, measured 26.04 kHz
  sample rate); Stage 3 is `quantize_12bit` + drop-sample pitch (`buffer[floor(n·ratio) % len]`,
  no interpolation) yielding the irrational-ratio "stardust" aliasing; Stage 4 is a ZOH DAC with
  no reconstruction filter, response `H(f) = sinc(f/fs)·e^(−jπf/fs)` modeled by repeating each
  sample N = 4 times. The five SP-1200 artifacts compound multiplicatively (12-bit quantization
  distortion, undersampling aliasing, drop-sample aliasing, ZOH spectral imaging, no
  reconstruction filter); concretely, undersampling folds content above 13.02 kHz back as
  `f_alias = |f − k·26040|`, drop-sample pitch at ratio r makes the effective rate `26040/r`, and
  the unfiltered ZOH leaves mirror images at `f + k·26040 Hz` shaped by the sinc envelope — these
  are the source of truth for the "all five stages" named in AC-022 (original lost item 6).
- The original source spec's ~22-item Test plan (e.g. `BridgedTFilter` centered within ±5% of
  49.4 Hz, a naive-square control test proving PolyBLEP is necessary, LFSR full-period
  return-to-initial-state, µ-law monotonicity) is not reproduced as a separate checklist; each
  behavior it covered is now carried by an AC and its `Verify with:` line. The full original
  test plan is preserved in git (`bb84b0e:specs/implemented/drum-machine-realism.md`) for the
  implementing task to mine (original lost item 20).
