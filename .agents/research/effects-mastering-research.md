# Effects & Mastering Research - Consolidated Findings

This document consolidates the implementation specifications for Gluten (Compressor), Grinder (Amp Sim), Crust (Limiter), Proof (Mastering Suite), and Dutch Oven (Reverb). The core DSP for all five processors has been successfully implemented in the Rust backend (`crates/daw-dsp` and `crates/proof-chamber`) exactly as described in the original research documents. The information retained below represents the missing features, UI/UX architecture, and implementation deviations discovered during codebase analysis.

---

## 1. Gluten (Bus Compressor)

**Codebase Annotation:** The core DSP (VCA, Opto, FET, Diode Bridge topologies, gain computer, sidechain, lookahead, oversampling) is fully implemented in `crates/daw-dsp/src/gluten/`. The following UI/UX features remain to be fully implemented in the frontend (`GlutenPanel`).

### Missing / Pending Features: UI/UX Progressive Disclosure

**Level 1 — Play**
One bar GR meter.

**Level 2 — Shape**
Full compressor controls: Threshold, Ratio, Attack, Release, Knee, Makeup Gain, Mix. GR meter with peak hold.

**Level 3 — Build**
Adds: Sidechain HPF/LPF, Sidechain parametric EQ band, Stereo Link (0–100%), Range, Hold, Auto Release toggle. GR history waveform.

**Level 4 — Route**
Adds: External sidechain toggle, Mid/Side mode, Lookahead, Oversampling, Detection mode (Peak/RMS), Multi-model blend crossfader.

**Level 5 — Lab**
Adds: VCA type selector, diode curve parameters, transformer harmonic controls, advanced metering.

### Metering and Visualization Architecture

- **Thread-safe DSP-to-UI communication:** Must use lock-free SPSC ring buffers for streaming data.
- **Gain-matched bypass:** Measure input and output loudness (EBU R128 Momentary) and apply the difference as compensation when bypass is toggled.

---

## 2. Grinder (Amp Sim & Neural Capture)

**Codebase Annotation:** The hybrid DSP engine (Circuit modeling, Preamp, Tone Stack, Power Amp, Transformer, Cabinet convolution, Neural NAM-compatible playback, Pedals) is fully implemented in `crates/daw-dsp/src/grinder/`. The following UX, visualization, and advanced routing features are missing or pending.

### Missing / Pending Features: UX Architecture & WebGPU Visualization

**Five-Level Progressive Disclosure**

- **Level 1 (Play):** Clean amp-head view, Gain, Bass, Mid, Treble, Master, Cab selector.
- **Level 2 (Shape):** Model-specific switches (Bright, Fat), Presence/Resonance, small tray of essential pedals (gate, drive, comp).
- **Level 3 (Build):** Drag-and-drop pedal chain, Mic room, Dual amp setup tools, blend routing.
- **Level 4 (Route):** Split/merge blocks, stereo/dual-amp routing, wet-dry-wet layouts, insert points, per-stage meters.
- **Level 5 (Lab):** Tube bias, sag depth, transformer saturation, input impedance calibration, NAM loader, anti-aliasing modes.

**WebGPU Visualization & Mic Room**

- **Virtual Mic Room:** A WebGPU-driven cab view letting users move mics over a speaker cone (center vs. edge, distance). Support for polar patterns.
- **Buffer Strategy:** Use staged approaches (ring-buffered CPU-to-GPU uploads, staging buffers) without synchronous per-sample UI transfers to prevent stalling.

---

## 3. Proof (Mastering Suite)

**Codebase Annotation:** The DSP modules (EQ, Multiband Dynamics, Imager, Exciter, Limiter, Match EQ, Dithering) and the Reorderable Module chain are fully implemented in `crates/daw-dsp/src/proof/`. The following AI and advanced UI features remain missing.

### Missing / Pending Features: AI & Translation Workflow

**Translation & Reference Checks**
- **Translation Curves:** Integrated monitor simulation EQ curves (Mono, Phone, Car, NS-10, Club) to check mix translation without leaving the DAW.
- **Reference Workflow:** Easy "master bus compare A/B/C" against loaded reference tracks with synchronized loudness.

**Analysis Features**
- Needs feature extraction: Spectral centroid, spectral flatness, bass/mid/high energy ratios, tonal balance deviation, LRA, PLR, stereo correlation.

**Heuristic Rule Engine / ONNX Model**

- An engine to suggest initial settings based on analysis (e.g., cutting excess bass, applying gentle compression for high LRA, auto-mono bass if correlation is low).
- Future integration with an ONNX model (`ort` crate) for genre classification and advanced mastering decisions.

**UI/UX Implementation**

- **Reorderable Module Architecture:** The UI must implement drag-to-reorder functionality (e.g., using `@dnd-kit/core`) that updates the Rust backend via Tauri invokes.
- **A/B Testing Discipline:** Implement auto gain-matching for honest A/B comparisons.

---

## 4. Dutch Oven (Reverb)

**Codebase Annotation:** The DSP engine for the reverb features (FDN, Convolution, Spring, Hybrid, Reverse, Decay EQ) is implemented in a dedicated crate named `crates/proof-chamber/`. The UI references it as `Dutch Oven` (e.g., `ProofChamberPanel` labelled as "Dutch Oven").

### Missing / Pending Features: Unified UI Architecture

**Unified View Blocks**

- **Main Reverb:** Space selector, Size, Decay, Mix, Pre-Delay, High/Low Cut, Width, Diffusion, Modulation Rate/Depth.
- **Balance & Dynamics:** Early/Late Balance, Ducking.
- **Routing & Engine:** IR Loader (drag-and-drop), Hybrid Mode (Parallel/Series), True Stereo, Input/Output Mode.
- **Advanced Tweaks (Lab):** Matrix Type, specific Delay Lengths, Shimmer Pitch/Mode, Gravity, Saturation Type, Custom IR EQ.
