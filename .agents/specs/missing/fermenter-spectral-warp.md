# Fermenter Spectral Warp Implementation

## Context

The Fermenter synthesizer currently exposes a "Warp" module, but the underlying Rust DSP implementation only performs time-domain waveform transformations (Sync, Quantize, Squeeze, Bend, Formant, Fold). To deliver on the product's true harmonic capabilities and match the feature set of flagship wavetable synthesizers (like Vital), we must implement true frequency-domain spectral morphing.
Reference research: `.agents/specs/implemented/fermenter.md` (Part 3: Vital's Spectral Engine COMPLETE).

---

## Goal

Provide a real-time spectral morphing engine within Fermenter's wavetable oscillator, executing true frequency-domain transforms (like Vocode, Smear, Spectral Time Skew) before IFFT resynthesis, while bounding the computational cost to remain real-time safe.

---

## User-visible behavior

Users will be able to select from a new set of "Spectral" warp modes in the Fermenter UI. When adjusting the warp amount, they will hear harmonic-level transformations rather than just time-domain distortions. The UI will reflect the distinction between time-domain (e.g., Fold) and spectral-domain (e.g., Smear) operations.

---

## Scope

## **In scope:**
- Modifying the Rust DSP `WavetableOscillator` (or introducing a `SpectralOscillator`) to apply frequency-domain transformations before IFFT synthesis.
- Implementing the 11 Vital-style spectral morph algorithms (Vocode, Formant Scale, Smear, Low Pass, High Pass, Shepard Tone, Spectral Time Skew, etc.) detailed in the research.
- Exposing the new spectral modes via the `WarpMode` enum in the TypeScript model (`src/modules/Fermenter/models/`).
- Expanding Fermenter-specific Rust DSP tests to assert spectral correctness.

## **Non-goals (explicitly out of scope):**
- Removing the existing time-domain warp modes (they are useful and will remain available).
- Extending spectral morphing to other engines (Analog, FM, Granular, etc.).
- Implementing GPU-accelerated additive synthesis (this is a separate future architecture goal).

---

## Requirements

1. **Wavetable Frame Conversion:** The oscillator must read frequency-domain data (amplitudes and phases) for the current wavetable frame, or perform a forward FFT if only time-domain frames are available.
2. **Spectral Transformation:** The selected `SpectralMorphType` algorithm must operate on the frequency-domain bins at runtime, modulated by the continuous `warp_amount` parameter.
3. **Synthesis:** The oscillator must perform an Inverse FFT (IFFT) to synthesize the warped time-domain frame.
4. **Real-time Safety:** The IFFT/FFT workload must be bounded (e.g., calculating frames at a block-rate cadence rather than per-sample) to ensure the audio thread does not drop dropouts.
5. **Typescript Bridge:** The `WarpMode` enum in `src/modules/Fermenter/models/` must be expanded to include the new spectral modes.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md`).
- Must not introduce significant latency or PDC requirements; spectral frames must be precomputed or computed at the wavetable boundary.
- Must execute on the Rust DSP thread via `crates/daw-dsp`.

---

## Design decisions

### Decision: Table Update Scheduling

**Chosen:** Apply the spectral warp and IFFT at a bounded cadence (e.g., whenever the wavetable position, morph type, or morph amount changes significantly), rather than per-sample. The oscillator will linearly interpolate between the currently synthesized warped time-domain frame and the next.

## **Considered and rejected:**
- **Per-sample IFFT:** Rejected due to excessive CPU cost. Real-time wavetable synths cannot afford a full IFFT every sample per voice.

---

## Acceptance criteria

<acceptance_criteria>

- [ ] `WarpMode` enum in Rust and TypeScript includes the new spectral modes (e.g., `Smear`, `Vocode`, `SpectralTimeSkew`).
- [ ] The Rust DSP engine implements the frequency-domain transformations correctly, as verified by unit tests asserting harmonic content shifts (e.g., Smear broadens harmonic peaks).
- [ ] Changing `warp_amount` at control rate smoothly updates the generated waveform.
- [ ] `pnpm typecheck` and `pnpm deps:validate` pass with zero violations.
- [ ] `cargo test -p daw-dsp fermenter::` passes all new spectral assertions.

</acceptance_criteria>

---

## Implementation notes

- Reference the pseudocode and math formulas directly from `.agents/specs/implemented/fermenter.md` under "Part 3: Vital's Spectral Engine COMPLETE".
- Utilize `rust-fft` or existing FFT utilities in `crates/daw-dsp` for the frequency-to-time domain transformations.
- Focus on `crates/daw-dsp/src/fermenter/spectral.rs` and the main oscillator module (`synth.rs` or `oscillator.rs`).

---

## Test plan

- [ ] **Automated (Rust):** Write targeted unit tests in `crates/daw-dsp` that pass a known simple spectrum (e.g., a single sine wave harmonic), apply a spectral morph (like Low Pass or Smear), and assert that the resulting magnitude spectrum matches the expected transformation.
- [ ] **Automated (TypeScript):** Ensure the patch validator and store handlers correctly accept and persist the new `WarpMode` string literals.

---

## Open questions

- [ ] **[MINOR]** Should the current `warp_mode` control be split into `time_warp_mode` and `spectral_warp_mode` so users can apply both simultaneously, or do they share the same slot? (Assumption: They share the same slot, consistent with existing UI).

---

## Tradeoffs and risks

- **Performance:** Introducing runtime FFT/IFFT operations is the biggest risk. Careful scheduling and caching of warped frames are necessary to prevent audio thread underruns.
