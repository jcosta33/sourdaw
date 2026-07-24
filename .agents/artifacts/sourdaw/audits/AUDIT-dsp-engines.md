---
type: audit
id: AUDIT-dsp-engines
title: DSP engines (crates/daw-dsp, proof-chamber, scoring) — golden-standard audit
scope: crates/daw-dsp/src/**, crates/proof-chamber/src/**, crates/scoring/src/**
baseline: origin/main @ 97971c19597308b7b21f8048bb8df160f64ac18c
mode: audit-only (no fixes)
date: 2026-07-23
---

# DSP Engines Audit

Observe. Prove. Prescribe nothing. Every observation anchors to `file:line`.

Static reading over `origin/main` @ `97971c1`. One throwaway `cargo test` was run against
`proof/limiter.rs` to probe the inter-sample-peak path and then reverted (nothing committed beyond
this artifact; the crate tree is unmodified). Toolchain confirmed working: `cargo test -p daw-dsp`
builds in ~13 s and the 4 existing limiter tests pass.

---

## 1. Golden Standard

First-class native + WASM audio DSP is measured against these references.

### Denormal handling
Recursive IIR paths (filters, reverbs, delays, envelopes) decay toward zero on silence and generate
subnormal floats, which trap to microcode and cause 10–100× CPU spikes. Native x86 fixes this with
FTZ/DAZ MXCSR flags; **WebAssembly has no portable flush-to-zero** — the SIMD proposal explicitly
leaves subnormal flushing implementation-defined, and scalar wasm has no FTZ control at all. In wasm
the only portable defenses are per-state threshold flush (`if x.abs() < eps { x = 0 }`) or a tiny
DC/noise injection into feedback state.
- WebAssembly SIMD subnormal flushing (unavailable/implementation-defined): https://github.com/WebAssembly/simd/issues/2 and https://github.com/WebAssembly/design/issues/1429
- EarLevel Engineering, "Floating point denormals" (mitigation: FTZ or low-amplitude injection): https://www.earlevel.com/main/2019/04/19/floating-point-denormals/

### Filter topology under modulation
Direct-form biquads (RBJ cookbook) are correct for **static** coefficients but exhibit transient
artifacts and coefficient-jump zipper when frequency/Q/gain are modulated, and lose precision at low
frequency in f32 state. Topology-Preserving-Transform (TPT) SVF with zero-delay feedback stays stable
and well-behaved under per-sample modulation and is the modern default for modulated filters.
- Zavalishin, *The Art of VA Filter Design* (2.1.0), TPT/zero-delay-feedback SVF: https://www.discodsp.net/VAFilterDesign_2.1.0.pdf
- Native Instruments mirror (1.1.1): https://www.native-instruments.com/fileadmin/ni_media/downloads/pdf/VAFilterDesign_1.1.1.pdf

### Compressor / limiter ballistics & true-peak
Dynamics design: log-domain gain computer with soft knee, **branching** attack/release smoothing, and
for mastering-grade limiters, program-dependent (dual) release to avoid pumping. Brick-wall limiters
must limit **true (inter-sample) peak**, not sample peak — a signal whose samples sit below the
ceiling can reconstruct above 0 dBFS at the DAC or after lossy re-encode. ITU-R BS.1770 defines
true-peak as a ≥4× oversampled measurement.
- Giannoulis, Massberg, Reiss, "Digital Dynamic Range Compressor Design — A Tutorial and Analysis", JAES 2012 (gain computer, branching smoother, soft knee): https://www.eecs.qmul.ac.uk/~josh/documents/2012/GiannoulisMassbergReiss-dynamicrangecompression-JAES2012.pdf
- ITU-R BS.1770 (true-peak / inter-sample peak, ≥4× oversampling): https://www.itu.int/rec/R-REC-BS.1770

### Oversampling of nonlinear stages
Waveshapers/saturators/tube models generate broadband harmonics that alias unless the nonlinearity
runs oversampled with a steep anti-alias filter (polyphase half-band FIR/IIR), or the nonlinearity is
antiderivative-anti-aliased (ADAA). A 2-point box average is a first-order FIR (single null at
Nyquist) and provides almost no alias rejection for a `tanh` stage.
- Parker, Zavalishin, Le Bivic, "Reducing the Aliasing of Nonlinear Waveshaping Using Continuous-Time Convolution" (ADAA), DAFx-16: https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf
- JUCE `dsp::Oversampling` (2× polyphase IIR / FIR half-band, the industry-baseline API): https://docs.juce.com/master/classdsp_1_1Oversampling.html

### Numerical hygiene at boundaries
NaN/Inf produced in one node must not reach the graph: a single NaN in a WebAudio output buffer
propagates and silences/poisons downstream nodes. First-class engines sanitize (`is_finite`) at the
module output boundary; f32 accumulators want DC blockers on feedback and guards on `log10`/`sqrt`.
- musicdsp.org denormal/DC-blocker archive: https://www.musicdsp.org/en/latest/Filters/135-dc-filter.html

---

## 2. Current-State Map — device × concern

Legend: ✅ present/first-class · ⚠️ partial/inconsistent · ❌ absent · — n/a. Anchors in Findings.

| Device (crate)                     | Denormal flush (feedback) | Param smoothing            | Nonlinear oversampling        | Filter topology            | NaN/Inf output guard |
|------------------------------------|---------------------------|----------------------------|-------------------------------|----------------------------|----------------------|
| Fermenter (synth)                  | ❌ SVF ic1/ic2 never flushed | ✅ per-param smoothers      | ⚠️ effects only               | ✅ TPT SVF + ladder         | ❌ boundary raw       |
| Toaster (drums)                    | ✅ 1e-20 flush across engines | ⚠️ pad params, engine.rs   | ✅ ADAA (`adaa.rs`) + poly_blep | mixed (modal/biquad)      | ❌ boundary raw       |
| Gluten (bus comp)                  | ❌ detector/filters no flush | ✅ branching smoother        | ⚠️ diode/fet oversample dir    | RBJ sidechain              | ❌ boundary raw       |
| Crust (limiter)                    | — (no Rust engine)         | —                          | —                             | —                          | —                    |
| Proof — limiter                    | n/a (FIR delay)            | one-pole release (basic)   | ❌ **sample-peak, not TP**     | —                          | ❌ boundary raw       |
| Proof — EQ / dynamic EQ            | ❌ BiquadState no flush     | ❌ **instant coeff swap**   | —                             | ⚠️ Direct-Form-I RBJ       | ❌ boundary raw       |
| Proof — exciter / oversample       | n/a                        | —                          | ✅ 2×/4× half-band FIR         | —                          | (round-trip finite-tested) |
| Bacteria (multiband FX)            | ❌ chorus/delay no flush    | ✅ params.rs smoothing      | ✅ **5th-order elliptic half-band poly-IIR** | RBJ per-band     | ❌ boundary raw       |
| ProofChamber (reverb)              | ✅ 1e-18 flush (fdn/spring) | ✅ smoothed                 | —                             | FDN/allpass tank           | ⚠️ internal guards    |
| Knead (pitch)                      | ❌                         | —                          | ⚠️ psola                       | —                          | ❌ boundary raw       |
| Grinder (amp sim)                  | ❌ miller LP / feedback     | ✅ param smoothing          | ⚠️ **2-pt average, not real OS** | tone-stack biquads       | ❌ boundary raw       |
| Levain (sampler)                   | ❌ realism biquads          | ✅ expression smoothing     | ⚠️ expression                  | RBJ realism                | ❌ boundary raw       |
| GrandBoule (piano)                 | ❌ waveguide strings/soundboard | ✅ param smoothing       | ⚠️ string/soundboard           | waveguide + biquad         | ❌ boundary raw       |
| Crumbs (sampler/slice, native)     | ✅ DENORMAL_DC 1e-18        | ✅ smooth.rs one-pole       | ⚠️ warp filters                | TPT (crumbs/filter.rs)     | ❌ boundary raw       |
| Scoring (tuner)                    | — (analysis)               | —                          | —                             | YIN/MPM                    | —                    |

**Denormal-protection concentration (authoritative):** state-flush appears only in
`toaster/*`, `crumbs/*`, and `proof-chamber/{fdn,proof_chamber,spring}.rs`
(`grep -rlE 'abs\(\) < 1e-(18|20)|DENORMAL_DC'`). **No `flush_to_zero`/FTZ/DAZ anywhere in `crates/`**
(`grep -rniE 'flush_to_zero|_MM_SET|ftz|daz'` → empty) — so unprotected families have zero denormal
defense in the wasm build.

---

## 3. Findings

### DSP-1 — Proof limiter is sample-peak despite "true peak" naming — Major
- **Evidence:** `crates/daw-dsp/src/proof/limiter.rs:1` (doc "true peak detection"),
  `:111` (`-1.0 dBTP default`), `:127` (`lim_ceiling`). The detector at `:166` computes
  `left[i].abs().max(right[i].abs())` on raw base-rate samples; there is **no oversampler anywhere in
  the limiting path**. `crates/daw-dsp/src/proof/chain.rs:56,93,182` instantiates a separate
  `TruePeakDetector` used **only for metering** — the codebase measures true-peak but does not limit
  to it.
- **Failure mode:** samples held at/under the ceiling reconstruct above it between samples.
- **Firing condition:** any HF-rich master (near-Nyquist energy) hitting the limiter.
- **Blast radius:** inter-sample peaks pass the "brick wall" and hard-clip in the export encoder —
  directly consistent with the export audit's finding that FLAC/MP3 clip. Whole master.
- **Note:** the throwaway `Oversampler4x`-based reconstruction test under-measured (the 15-tap
  half-band under-reconstructs the continuous peak), so it is *not* a reliable ISP oracle — the
  static evidence stands on its own; a real check needs ≥4× polyphase or an analytic peak.
- Remediation size: **M** (oversample the detection/gain path or add an ISP-aware ceiling).

### DSP-2 — Denormal protection absent from most IIR feedback paths; no FTZ in wasm — Major
- **Evidence:** flush exists only in `toaster/*`, `crumbs/*`, `proof-chamber/{fdn.rs:453,
  proof_chamber.rs:81, spring.rs}`. Absent from the SVF feedback state
  `fermenter/filter.rs:54-55` (`ic1eq`/`ic2eq` `2*v - s`, never flushed), `gluten/detector.rs` +
  gluten filters, `bacteria/chorus.rs` (delay feedback), `grinder` Miller LP `triode.rs:219`,
  `proof/biquad.rs:139-145` (`BiquadState` DF-I, no flush), `proof/eq.rs`, `proof/dynamic_eq.rs`,
  `grand_boule/{string,coupled_strings,soundboard}.rs` (waveguides), `levain/realism/*`.
  `grep -rniE 'flush_to_zero|ftz|daz'` over `crates/` is empty → no global FTZ.
- **Failure mode:** feedback state decays into subnormals on note-off/silence → per-sample microcode
  traps → CPU spikes; in wasm there is no FTZ fallback.
- **Firing condition:** any tail decaying to silence (piano release, reverb-less filter ring, muted
  bus) in the wasm engine.
- **Blast radius:** engine-wide xruns/underruns under otherwise-idle conditions; worst on low-power
  devices where wasm SIMD flushes to zero on ARM but scalar paths do not.
- Remediation size: **M** (one shared `flush_denormal` primitive applied at each feedback state, or a
  block-level DC-injection strategy).

### DSP-3 — Grinder tube stages use 2-point averaging, not real oversampling — Major
- **Evidence:** `crates/daw-dsp/src/grinder/triode.rs:225-234` and
  `grinder/power_amp.rs:257-265`: `intermediate = 0.5*(prev+input)` then two ODE substeps averaged
  `(first+second)*0.5`. The "downsample" is a single 2-tap box average — a first-order FIR with one
  null at Nyquist. The nonlinearity is `tanh` (`power_amp.rs:295-297`, `triode.rs:376,416`).
  Contrast the first-class paths that *do* exist in the same crate family: `bacteria/oversample.rs`
  (5th-order elliptic half-band polyphase IIR), `proof/oversample.rs` (15-tap half-band FIR 2×/4×),
  `toaster/adaa.rs` (antiderivative anti-aliasing).
- **Failure mode:** broadband harmonics from high-gain distortion fold back as aliasing; the box
  average removes almost none of it.
- **Firing condition:** high drive on Grinder amp/pedal models — i.e. the primary use case.
- **Blast radius:** audible inharmonic aliasing on the guitar path; inconsistent quality bar vs
  Bacteria/Proof/Toaster.
- Remediation size: **M–L** (route the tube ODE through `bacteria`-style polyphase OS or ADAA).

### DSP-4 — Proof EQ / dynamic EQ swap biquad coefficients instantly (zipper on automation) — Major
- **Evidence:** `crates/daw-dsp/src/proof/eq.rs:135,139,143,154` → `recompute()` at `:59-60`
  assigns `self.coeffs = …` with no crossfade/interpolation; `proof/dynamic_eq.rs:136` recomputes
  `eq_coeffs = BiquadCoeffs::peak(freq, gr_db, q, sr)` **every block** from the envelope. Underlying
  `BiquadState` is Direct-Form-I (`biquad.rs:120-146`), the least modulation-tolerant topology.
- **Failure mode:** discontinuous coefficient jumps produce zipper noise / clicks and DF-I transient
  ringing under fast parameter change.
- **Firing condition:** automated freq/gain/Q sweeps — now that offline automation drives device
  params through `scheduleParam` segments (#647), these become continuous coefficient streams rather
  than occasional UI tweaks.
- **Blast radius:** artifacts baked into offline renders/exports of automated masters.
- Remediation size: **M** (coefficient smoothing/crossfade, or migrate modulated bands to TPT SVF).

### DSP-5 — Proof mastering biquads are Direct-Form-I (topology note) — Minor
- **Evidence:** `crates/daw-dsp/src/proof/biquad.rs:120-146` DF-I with f32 `x1/x2/y1/y2`; used by EQ,
  crossover, sidechain. Fine for static mastering EQ; suboptimal precision at low freq and less
  stable than TPT under the modulation of DSP-4. Overlaps DSP-2 (no state flush) and DSP-4.
- **Blast radius:** low-frequency-band precision and modulated-band stability only.
- Remediation size: **M** (only if modulation/precision proves audible).

### DSP-6 — Limiter release is a single fixed one-pole (no program-dependent release) — Minor
- **Evidence:** `crates/daw-dsp/src/proof/limiter.rs:178-182` — one release coefficient, instant
  attack via lookahead. No dual/adaptive release. (Gluten, by contrast, uses a proper branching
  smoother — `gluten/smoother.rs` — and Giannoulis soft-knee gain computer —
  `gluten/gain_computer.rs:2,7-20`.)
- **Failure mode:** pumping/breathing on dense transient material at short release.
- **Blast radius:** master-bus loudness quality; audible on aggressive settings only.
- Remediation size: **S**.

### DSP-7 — Linear-phase EQ redesigns its FIR by allocation on param change — Minor / Open
- **Evidence:** `crates/daw-dsp/src/proof/linear_phase_eq.rs:103,118,138` — `vec![…]` /
  `.collect()` build the magnitude/IR/`fir_l` on FIR redesign; `process` at `:152` uses preallocated
  ring buffers (`:77-82`). If the redesign path is reachable from `set_param` on the audio thread,
  it allocates on the RT thread.
- **Unverified:** the calling thread for FIR redesign was not traced to closure — see Open Questions.
- Remediation size: **S** (precompute off-thread / double-buffer the FIR).

### DSP-8 — No NaN/Inf sanitization at the wasm output boundary — Minor (large blast radius)

Status: FIXED in #732 — a shared, zero-alloc `sanitize_block` scrubs NaN/Inf to silence at every wasm float output boundary: all daw-dsp device families, proof-chamber, scoring, and the decoder's `take_samples`. The per-device flush counter is exposed **at the wasm boundary** via `get_nan_flush_count()` (the decoder is scrub-only — it is a transient one-shot value with no persistent instance to poll); TS-side surfacing of the counter rides RT-10 (Wave 6), not this PR.
- **Evidence:** each device's `#[wasm_bindgen] pub fn process(&mut self, …) -> *const f32`
  (`proof/mod.rs:71`, `fermenter/mod.rs:92`, `grinder/mod.rs:73,90`, …) returns the raw output buffer
  with no `is_finite` sweep. Internal `is_finite` guards exist but are inconsistent per device
  (`grep` density: `fermenter/synth.rs` 36, `grinder/cabinet.rs` 27, many engines single-digit or
  zero). `lib.rs` is module declarations only — no shared boundary sanitizer.
- **Failure mode:** a NaN/Inf produced under extreme params in one device reaches the WebAudio buffer.
- **Blast radius:** a single NaN in a WebAudio output buffer propagates and can silence the whole
  downstream graph — small likelihood, large reach.
- Remediation size: **S** (one shared `sanitize_block` at each export before returning the pointer).

### DSP-9 — Two divergent denormal strategies with unprincipled thresholds — Polish
- **Evidence:** toaster/sp1200 flush at `abs() < 1e-20` (`sp1200.rs:189-193`,
  `bridged_t.rs:105-109`, many engines); crumbs injects `DENORMAL_DC = 1e-18` DC offset
  (`crumbs/types.rs:41-42`, `crumbs/filter.rs:127-130`). `1e-20` sits far above the actual f32
  subnormal range (~1.18e-38), so it functions as a coarse −400 dB noise gate rather than a true
  denormal guard — harmless sonically but inconsistent, un-shared, and magic-numbered across families.
- Remediation size: **S** (single shared primitive + documented threshold).

---

## 4. Remediation Roadmap (sizing only — no prescriptions)

| ID    | Severity | Size | Area                                  |
|-------|----------|------|---------------------------------------|
| DSP-1 | Major    | M    | Proof limiter true-peak path          |
| DSP-2 | Major    | M    | Cross-family denormal protection      |
| DSP-3 | Major    | M–L  | Grinder nonlinear oversampling        |
| DSP-4 | Major    | M    | Proof EQ/dyn-EQ coeff smoothing       |
| DSP-5 | Minor    | M    | Proof biquad topology                 |
| DSP-6 | Minor    | S    | Limiter program-dependent release     |
| DSP-7 | Minor    | S    | Linear-phase EQ RT allocation         |
| DSP-8 | Minor    | S    | wasm-boundary NaN/Inf guard           |
| DSP-9 | Polish   | S    | Unify denormal strategy/threshold     |

Counts: **9 findings** — 4 Major, 4 Minor, 1 Polish.

---

## 5. Open Questions

1. **DSP-1:** does the export pipeline apply any post-limiter true-peak stage, or is
   `proof/limiter.rs` the last brick wall before FLAC/MP3 encode? (Cross-reference the export audit.)
2. **DSP-7:** is `linear_phase_eq` FIR redesign ever invoked from an RT/audio-thread `set_param`, or
   only from a control-thread rebuild? Not traced to closure here.
3. **DSP-4:** does `scheduleParam` (#647) push per-block or per-sample param values into
   `proof/eq.rs::set_param`? Determines whether coefficient smoothing is mandatory or merely nice.
4. **DSP-2:** is FTZ set anywhere in the *native* (Tauri/CPAL) host outside `crates/` (e.g. a thread
   init)? The empty grep covers `crates/` only; the native audio thread setup was out of scope.
5. **Scoring / Knead:** analysis-grade (YIN/MPM pitch) — not audited for RT-output concerns since they
   do not sit on a continuous audio-output feedback path; confirm that assumption.

---

## 6. Unverified / out of scope
- No runtime/dynamic verification of denormal CPU cost, aliasing spectra, or NaN reachability
  (static reading only; the one throwaway limiter probe was reverted).
- Grand Boule, Levain, Knead, Crumbs warp, Fermenter voice internals scanned for the five concerns but
  not traced path-by-path.
- Allocation-in-`process` was screened by file-level heuristic; only `linear_phase_eq` (DSP-7) and the
  limiter (proven alloc-free by its own `assert_no_alloc` tests) were inspected closely.
