---
type: spec
id: SPEC-fermenter
title: Fermenter core instrument
status: done
owner: The Sourdaw team
sources:
  - research.md
  - ../intake/full-spec.md
---

# Fermenter core instrument

## Intent

Fermenter is Sourdaw's flagship hybrid synthesizer: wavetable, virtual analog,
FM/PM, additive, granular, sampler, noise, and physical-modeling generators
under one patch format, one parameter schema, and one DSP core compiled to both
native and WebAssembly. This spec covers the shared instrument shell — the voice
host, parameter system, block-processing contract, and patch round-trip — that
every engine plugs into. Each engine, the filter bank, the modulation system,
the effects, and the UI have their own `fermenter-*` specs.

## Non-goals

- The individual synthesis engines (`../fermenter-wavetable/spec.md` and the
  other `fermenter-*` engine specs).
- The filter bank, modulation system, and effects (their own specs).
- Plugin-hosting and instrument-rack integration (`../plugin-hosting-clap/spec.md`,
  `../device-racks/spec.md`).
- GPU-accelerated paths (`../fermenter-gpu-compute/spec.md`).

## Requirements

### AC-001 — One patch format spans every engine

When a patch is loaded, Fermenter must instantiate any combination of its
generator engines from a single patch schema with stable parameter paths.

Verify with: `pnpm test:run -- fermenterPatchSchema`

### AC-002 — The audio thread never allocates, locks, or blocks

When `process()` runs, the synth must perform no heap allocation, no lock
acquisition, and no blocking call.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::assert_no_alloc`

### AC-003 — Parameter paths resolve to numeric IDs off the audio thread

When a parameter is set by path string, the resolution from path to numeric
`ParamId` must happen on the control thread, and the audio thread must read only
dense numeric-indexed arrays.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::param_registry`

### AC-004 — Parameter changes are smoothed to avoid zipper noise

When a parameter target changes, its applied value must move toward the target
via one-pole smoothing over the parameter's configured time rather than jumping.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::param_smoothing`

### AC-005 — A block is processed in the defined order

When a block is rendered, the synth must drain parameter changes, apply MIDI,
allocate/steal voices, update modulators, render voices, process FX lanes, and
mix to stereo — in that order.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::block_order`

### AC-006 — Patch round-trip is byte-identical

When a patch is exported and re-imported, the resulting synth state must be
byte-identical to the exported state.

Verify with: `pnpm test:run -- fermenterPatchRoundtrip`

### AC-007 — Native and WASM render the same output

When the same patch and MIDI are rendered on native and on WASM, the outputs
must match within WASM SIMD tolerance.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::native_wasm_parity`

### AC-008 — Generators are interchangeable in the signal chain

When a voice is built, any generator engine must be placeable through the same
trait-based generator interface without a fixed per-engine signal flow.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::generator_dispatch`

### AC-009 — No cross-module internal imports

This instrument must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-010 — Every modulation-source type has a defined per-source contract

Each modulation source the instrument exposes — ADSR/MSEG envelopes, LFOs, step
sequencers, random modulators (Lorenz/Perlin), audio follower, performance
inputs, and the XY/Transform pad — must produce its specified output signal from
its own parameters so any source can drive any routing.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::modulation_source_contracts`

### AC-011 — Wavetable oscillators run the Serum-grade clean-oscillator path

When a wavetable voice renders, the oscillator must apply 2x internal
oversampling before mip-map selection, offer a filtered-noise blend for
transient "air," and support a "Fat" exponential unison detune curve
`detune[i] = detune_max * (i / total)^2` for crisp, alias-free output.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::serum_clean_oscillator`

### AC-012 — Omnisphere-style enhancement is available

When enabled, psychoacoustic harmonic enhancement must track the fundamental and
add 2f/3f/4f content at -20 dB via a comb filter, for a richer cinematic timbre.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::omnisphere_enhancement`

### AC-013 — Massive-style scanning filter is available

When enabled, a wavetable-position scan must pair with a dual filter (Ladder plus
Lowpass) emphasizing different harmonics, for an aggressive timbre.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::massive_scanning_filter`

### AC-014 — Alchemy-style spectral morphing is available

When enabled, spectral morphing must resynthesize additively (STFT plus partial
tracking, interpolating partial amplitudes and frequencies directly), giving
smooth professional-grade morphs.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::alchemy_spectral_morph`

### AC-015 — Pigments-style multi-engine voices are available

When configured, a voice must run two completely different synthesis engines
simultaneously with per-voice and per-step modulation (Pigments), for versatile
timbres.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::multi_engine_and_fft_osc`

### AC-016 — The remaining flagship-parity differentiators are honored

When the instrument renders, the Vital-class differentiators (exact per-octave
spectral band-limiting, runtime spectral warping, pitch-correlated unison phase,
audio-rate modulation to 20 kHz), the Diva-class analog feel (ZDF self-oscillation,
per-voice oscillator drift, filter-type-specific saturation in three places), and
the Phase Plant architecture (trait-based generator/effect dispatch, per-voice FX
with independent tails) must all be present for competitive sound parity.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::flagship_parity_differentiators`

### AC-017 — Omnisphere-style Innerspace effect is available

When enabled, the Innerspace effect must granularize the reverb tail while
randomizing each grain's pitch by ±1 semitone, for a richer cinematic timbre.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::omnisphere_enhancement`

### AC-018 — Massive-style Dimension Expander is available

When enabled, the Dimension Expander must run 8 very short delays (1–30 ms), each
slightly different and subtly pitch-modulated, for a wide stereo image.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::massive_scanning_filter`

### AC-019 — Alchemy-style Transform Pad is available

When enabled, the Transform Pad must bilinearly interpolate continuous parameters
while crossfading between two instances for discrete ones, giving smooth
professional-grade morphs.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::alchemy_spectral_morph`

### AC-020 — Zebra-style FFT oscillator is available

When configured, an oscillator must support per-cycle IFFT resynthesis from a
user-editable magnitude spectrum driven by a 2D X/Y modulation grid (Zebra), for
spatial timbres.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::multi_engine_and_fft_osc`

## Open questions

- [ ] (non-blocking) What WASM voice ceiling (the source suggests 32) should be
  the configured default versus exposed as a quality setting?

- [ ] (deferred-gap from intake/spec-of-the-gaps.md, non-blocking) Four Fermenter
  flagship-synth gaps remain open from the original `fermenter.md` source (item
  "3.1 Fermenter (Flagship Synth)"): (1) **Vital-style spectral morphing** — the
  morph path between wavetables/spectra is not yet implemented to Vital's standard;
  (2) **wavetable mip-maps for alias-free high-frequency playback** — per-octave
  band-limited mip-map tables so high notes do not alias (this is the storage/table
  side that AC-011's "before mip-map selection" oversampling step depends on, and
  AC-016's "exact per-octave spectral band-limiting" Vital-class differentiator
  asserts); (3) **true PM/FM routing matrices** — a full any-source-to-any-operator
  phase/frequency-modulation routing matrix rather than fixed FM pairs; (4)
  **GPU-accelerated additive synthesis engine** — the additive generator running on
  the GPU compute path (tracked separately under `../fermenter-gpu-compute/spec.md`,
  noted here as a non-goal of this shell spec but recorded for losslessness). Mark
  blocking vs non-blocking per gap when an engine-specific spec is cut; all four are
  currently non-blocking for the instrument shell.

- [ ] (deferred-gap from intake/audit-deferred-fixes.md, non-blocking) "Group B —
  DSP correctness" collects four DSP-correctness/cost fixes that live in plugins
  *other than* Fermenter (Proof multiband + limiter, Crumbs granular sampler,
  Grinder amp sim), recorded here for losslessness — they are out of scope for this
  Fermenter shell spec and should be re-homed to their owning plugin specs:
  - **B1 — LR4 four-band sums flat (I-08):** `FourBandSplitter::process` must use a
    parallel-split + allpass-compensation topology (split at `f1` to LP1/HP1, split
    `HP1` at `f2`, split `HP2_high` at `f3`; allpass compensation on lower bands so
    phase aligns at each split, since an LR4 sums to allpass at the split
    frequency). Summing all four bands must be within ±0.5 dB of the dry signal
    across 20 Hz – 20 kHz; the summed signal lags by a documented LR4 group delay
    but magnitude is flat. Rejected alternatives: phase-linear FIR bank (higher CPU
    + latency), single-pass LR4 with no compensation (status quo, doesn't sum flat).
  - **B2 — Limiter is O(1) per sample (I-22):** replace `limiter.rs`'s linear scan
    with a Lemire monotonic `VecDeque<(usize, f32)>` deque (push new sample; pop
    from back while back value ≤ current; pop from front while front index is
    outside the window; front is the window max — O(1) amortised). Preserve the
    param surface (`lim_lookahead`, `ceiling`, attack/release); the deque length
    tracks `lookahead_samples` and must repopulate from existing delay-line state on
    resize. Doubling lookahead (1–50 ms range) must not more than double per-block
    runtime; new output must match the old implementation sample-by-sample within
    `f32::EPSILON × 8`.
  - **B3 — Crumbs anti-aliasing on pitch-up (I-12):** in `CrumbsVoice::trigger` and
    `set_tune`, when `speed > 1.0` set the per-channel `filter_l`/`filter_r`
    (`TptSvf`) cutoff to `min(user_cutoff_or_nyquist, nyquist / speed)`; the AA
    filter runs even when `filter_enabled` is false (gated on `speed > 1.0`), and
    when both user filter and AA are needed they share the SVF instance at
    `min(user_cutoff, nyquist/speed)`. A 2 kHz sine pitched up an octave
    (`speed = 2.0`) must show no significant energy in 12–22 kHz above the noise
    floor.
  - **B4 — Grinder declares automatable AudioParams (I-26):** `grinderProcessor.ts`
    must declare 11 `parameterDescriptors` — `gain, bass, mid, treble, presence,
    resonance, master, inputGain, outputGain, tubeDrive, feedback` — read per-sample
    via `values[i]` inside the inner loop (not `values[frames-1]`); all other params
    stay control-rate via `port.postMessage`.

- [ ] (restored detail, non-blocking) Two wavetable-oscillator behaviors from the
  original `fermenter.md` source were dropped and have no home in any current
  `fermenter-*` spec; recorded here for losslessness pending an owning
  wavetable-engine spec (this shell lists the engines as a non-goal):
  (1) **FM/RM from other oscillators (Wave Morph Types 7–10, source lines
  2429–2431):** time-domain frequency or ring modulation where the modulator is
  *another oscillator or the sample player*, cross-modulating in real time —
  distinct from the 6-operator DX7 FM engine. No spec captures this time-domain
  FM/RM warp path. (2) **"Spect Spread" Advanced-tab control (source line 2057):**
  distributes different spectral-morph amounts across the unison voices (the morph
  *amount* `osc_N_spectral_morph_amount`, range 0.0–1.0, is the per-voice base; Spect
  Spread spreads it across voices). Mark blocking vs non-blocking when the
  wavetable-engine spec is cut.

- [ ] (restored detail, non-blocking) Two backlog rows from the original
  `audits/combined-audit.md` Feature-Gaps / Proof tables have zero trace anywhere
  else in the current project specifications; recorded here for losslessness (neither is
  Fermenter-specific — re-home each to its owning area's spec when one is cut):
  (1) **S-12 — Minimap non-resizable (Low, combined-audit.md:282):** the
  arrangement minimap cannot be resized by the user; a user-facing feature gap.
  (2) **S-05 — Engine-side param verification (Medium, status '?',
  combined-audit.md:215 and :139):** an untraced Proof-plugin surveillance item
  whose only recorded prescription is "Needs XOI runtime test" — confirm whether
  engine-side parameter values match the control-thread targets at runtime.

## Affected areas

- `crates/daw-dsp/src/fermenter/` (voice host, parameter registry, block loop)
- `src/modules/Fermenter/` (parameter bridge, patch import/export)

## Dropped from sources

- The aspirational `daw-synth` crate split — the shipped layout keeps the synth
  under `crates/daw-dsp/src/fermenter`; this spec uses the real paths.
- SIMD micro-optimization code (SoA layouts, AVX2/wasm128 kernels) — an
  implementation technique, not an observable requirement.
- Competitive "secret sauce" analysis (Part 10) — the differentiating sound
  behaviors it described are captured as requirements in AC-010 through AC-016
  below (this spec previously claimed Part 10 was moved to `research.md`, which
  was never done); the comparative prose itself is not restated.
