---
type: spec
id: SPEC-fermenter-spectral-warp
title: Fermenter spectral warp
status: draft
owner: The Sourdaw team
sources:
  - .agents/specs/fermenter-spectral-warp/
---

# Fermenter spectral warp

## Intent

Add true frequency-domain spectral morphing to the Fermenter wavetable
synthesizer: convert wavetable frames to the spectral domain, apply Vital-style
spectral transforms, and resynthesize — exposed as new "Spectral" warp modes —
all within the audio thread's real-time constraints.

## Non-goals

- Changing Fermenter's existing time-domain warp modes.
- A new oscillator type; this extends `WavetableOscillator`.
- User-importable custom spectral algorithms in v1.
- Extending spectral morphing to other engines (Analog, FM, Granular, etc.).

## Requirements

### AC-001 — Wavetable frames convert to and from the spectral domain

The oscillator must convert a wavetable frame to its complex spectrum and back
with round-trip error below an inaudible threshold.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::frame_spectral_roundtrip`

### AC-002 — Eleven Vital-style spectral transforms are available

The `WarpMode` enum must expand to include 11 spectral transformations, each
producing its defined effect on the spectrum.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::spectral_transforms`

### AC-003 — Spectral synthesis is real-time safe

Spectral processing must not allocate, lock, or block on the audio thread.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::spectral_assert_no_alloc`

### AC-004 — Spectral table updates run at a bounded cadence

Recomputing the spectral table on a parameter change must occur at a bounded
cadence (not every sample) so audio-rate processing stays within budget.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::bounded_update_cadence`

### AC-005 — The TypeScript bridge exposes the spectral modes

The new spectral `WarpMode` values must be reachable from the frontend
synthesizer parameter bridge and selectable as warp modes.

Verify with: `pnpm test:run -- fermenterWarpModes`

### AC-006 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-007 — The UI distinguishes time-domain from spectral-domain warp modes

The warp-mode selector must visibly reflect the distinction between time-domain
operations (e.g. Fold) and spectral-domain operations (e.g. Smear) so a user can
tell which kind of transform each mode performs.

Verify with: `pnpm test:run -- fermenterWarpModeKinds`

### AC-008 — Spectral transforms operate in the frequency domain via FFT resynthesis

Each spectral warp mode must apply its transform to frequency-domain bins and
resynthesize via IFFT (using the workspace FFT utilities, e.g. `rustfft`), with
the spectral engine and oscillator wiring living in the Fermenter DSP module
(`crates/daw-dsp/src/fermenter/spectral.rs` and the oscillator module, i.e.
`crates/daw-dsp/src/fermenter/oscillator.rs` — the original notes flagged
`synth.rs` or `oscillator.rs` as candidates; `oscillator.rs` is the one that
exists) — not as a time-domain approximation.

Verify with: `pnpm cargo:test -- -p daw-dsp fermenter::spectral_frequency_domain`

## Open questions

- [ ] (non-blocking) What update cadence (e.g. per control block vs every N
      blocks) best balances morph responsiveness against CPU for AC-004?
- [ ] (non-blocking) [MINOR] Should the `warp_mode` control be split into
      `time_warp_mode` and `spectral_warp_mode` so users can apply a time-domain and
      a spectral-domain warp simultaneously, or do they share the same slot?
      (Original assumption: they share the same slot, consistent with the existing
      UI.)
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md §1.3
      Fermenter — The Master Synth) Anti-aliasing for the wavetable engine via
      **mip-map generation and lookup**: pre-compute band-limited versions of each
      wavetable frame and select the mip level at lookup time by the played
      frequency, so high notes do not alias. The intake frames this as a flagship
      upgrade to the wavetable playback path (which today does "basic wavetable
      playback"). Open: whether the mip pyramid is generated alongside the spectral
      table conversion this spec introduces (sharing the spectral-domain frames) or
      is a separate time-domain pre-pass; and the mip-level count / crossover
      policy. Not covered by AC-001..AC-008, which address spectral morphing
      correctness and RT-safety but not anti-aliasing.
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md §1.3
      Fermenter — The Master Synth) **True Phase Modulation (PM/FM) routing
      matrices**: add genuine PM/FM operator routing (a modulation matrix between
      oscillator/operator slots), not just static layer crossfading. This is a
      distinct synthesis capability from spectral morphing; the spec's Non-goals
      already exclude "a new oscillator type" and "extending spectral morphing to
      other engines (FM, ...)", so PM/FM routing is forward scope to be specced
      separately. Open: matrix shape (which sources route to which destinations),
      per-route depth control, and whether it lives in `WavetableOscillator` or a
      new operator-graph layer.
- [ ] (non-blocking) (deferred-gap from intake/implementation-gaps.md §1.3
      Fermenter — The Master Synth) **GPU-accelerated additive synthesis
      (WebGPU/wgpu)**: offload additive (sine-bank) resynthesis to the GPU via
      WebGPU on web and `wgpu` natively, to scale partial counts beyond what the
      CPU audio thread can afford. This crosses the RT-audio-thread boundary
      (GPU↔audio-thread handoff, latency, and the no-block constraint of AC-003)
      and is a substantial architectural addition. Open: how GPU-rendered partials
      are delivered to the RT audio thread without blocking it, fallback when no GPU
      is available, and whether this supersedes or complements the CPU spectral path
      in this spec.
- [ ] (non-blocking) (restored detail) Per-mode effect sketches for the 11
      transforms AC-002 requires (from `research/factory/fermenter.md` §1) — kept
      here as defining intent, not prescribed algorithms, so AC-002's "defined
      effect" per mode has a concrete reference. Vocode = keytracked formant shift,
      resampling harmonic amplitudes at offset positions and compensating for the
      MIDI note so formants stay at absolute frequencies; Harmonic Stretch = linear
      frequency remapping that scales harmonics up while the fundamental stays put;
      Inharmonic Stretch = nonlinear remapping mimicking string inharmonicity (e.g.
      `f_k = k * f0 * sqrt(1 + B * k²)`); Smear = spectral blur, convolving the
      amplitude spectrum with a broadening (Gaussian-like) kernel; Random Amplitudes
      = randomize each harmonic's magnitude (deterministic seeded RNG) while
      preserving phase; Low Pass / High Pass = progressively attenuate harmonics
      above/below a morph-amount cutoff in the frequency domain; Phase Disperse =
      allpass shift of each harmonic's phase increasing with harmonic number;
      Shepard Tone = octave-wrapped pitch shift with a bell-curve envelope for the
      infinite-pitch illusion; Spectral Time Skew = each harmonic reads from a
      different wavetable frame (needs the full wavetable, not one frame). Open:
      which specific 11 the v1 set commits to and the exact effect tolerance each
      test in AC-002 asserts.
- [ ] (non-blocking) (restored detail) The original "Routing & FX" UI block
      (`research/factory/fermenter.md` §5) named a **lane routing map** and
      **serial/parallel/split routing-topology toggles** alongside per-voice FX
      placement. Per-voice FX placement has a home (fermenter-voice-management
      AC-006), but the routing-topology toggles and the lane routing map have no
      requirement owner. Out of this spec's DSP/bridge scope — likely belongs in a
      Fermenter UI/routing spec. Open: which spec owns lane routing topology.
- [ ] (non-blocking) (restored detail) The original "Advanced / Lab" UI block
      (`research/factory/fermenter.md` §5) enumerated specific Lab editors:
      **import/analysis workflows, a wavetable editor, an additive editor, and a
      granular source editor**. The current Fermenter UI surface names only a
      generic "Lab" disclosure level and does not enumerate these as controls; no
      file names an "additive editor" or "granular source editor". Out of this
      spec's scope (DSP + warp-mode bridge). Open: which spec owns the Lab editors.

## Affected areas

- `crates/daw-dsp/src/fermenter/` (`WavetableOscillator`, spectral transforms,
  `WarpMode` enum)
- `src/modules/Fermenter/` (TypeScript parameter bridge, warp-mode selector)

## Known risks

- Dangling reference: the original implementation notes pointed implementers at
  an earlier Fermenter implementation spec (no longer present; preserved in
  git history at bb84b0e), under "Part 3: Vital's Spectral Engine COMPLETE", for
  pseudocode and math formulas. That document does not exist anywhere in the
  current project specifications, so the math reference it cited is gone. The per-mode effect
  sketches restored under Open questions (from `research/factory/fermenter.md`
  §1) are the surviving substitute; an implementer should not expect to find the
  cited earlier Fermenter implementation spec (no longer present; preserved
  in git history at bb84b0e).

## Dropped from sources

- User-importable / scriptable spectral algorithms — v1 ships the fixed
  Vital-style set only.
- A spectral display in the Fermenter UI — visualization is a follow-up; this
  spec covers the DSP and bridge.
