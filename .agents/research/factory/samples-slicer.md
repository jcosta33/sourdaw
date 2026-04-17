# Samples & Slicer Research (Consolidated)

## 1. Sample Library Browser Integration

**Codebase Finding:** **Completely missing.** There is no implementation of the Sample Library Browser in the current codebase. The Rust data models (`PackIndex`, `SampleEntry`), Tauri commands (`search_samples`, etc.), and frontend components have not been built.

### Missing Features & Architecture:

- **Freesound Integration:** OAuth2 authentication, advanced search API integration, and metadata extraction.
- **Offline CC0 Libraries:** Integration with GitHub-hosted libraries (VCSL, LMMS Assets, etc.) and academic sources (University of Iowa MIS).
- **Storage Model:** `index.json` per pack, deterministic sample ID generation (using `blake3`).
- **In-Memory Engine:** Fuzzy search using `nucleo-matcher` across 50k+ items, `BTreeMap` category trees.
- **Audio Preview:** macOS thread-safe `rodio` implementation with `symphonia` for waveform peak decoding and caching.
- **Filesystem Watching:** Debounced hot-reloading of the library using `notify-debouncer-full`.
- **Downloader:** Future implementation to fetch, extract, and index ZIP packs.

## 2. Slicer Plugin UX & Architecture

**Codebase Finding:** **Completely missing.** The Slicer plugin does not exist in the TS frontend or Rust DSP. Only unrelated preset names contain the word "Slicer".

### Missing Features & Architecture:

- **Unified UI Architecture (Multiple Blocks):**
    - **Play & Macros:** Drop a loop, instant auto-slice, playable 16-pad grid.
    - **Generators & Layers:** Sensitivity slider (continuous threshold mapping) with "Suggest" AI detection, dual-color markers (auto vs. manual/locked), and per-pad tuning/envelopes.
    - **Sequencing & Build:** 16/32 step sequencer with velocity, pitch offset, step retrigger (stutter), and generative Chaos/Randomize controls. Roger Linn-style swing.
    - **Routing & FX:** Per-slice output routing (separate DAW mixer channels), choke groups, and velocity zone mapping.
    - **Advanced / Lab:** Advanced transient algorithms (HFC, Spectral Flux, etc.), per-slice time-stretch algorithms, REX2 import, and "Send to Toaster" integration.
- **Waveform Display:** 12-hue palette matching pad colors, draggable slice boundary handles with zero-crossing snap.

## 3. Levain Orchestral Plugin (Feature Audit)

### Still Missing / Incomplete (To Be Implemented):

- **Stubbed Parameters:** `tone`, `attack`, and `release` in `engine.rs` are currently no-ops.
- **Legato Engine:** Legato is off by default (`enabled: false`). No actual transition samples are loaded (relies purely on `SyntheticGlide`).
- **Expression Engine:** Vibrato amplitude LFO (bow pressure variation) and vibrato timbre LFO (formant filter) are missing. Velocity does not independently select attack character samples.
- **Mic System:** `delay_ms`, `stereo_width`, and `phase_invert` are ignored by the Rust `MicMixer`. GCC-PHAT alignment tool is missing. Several mic positions exist only in the model.
- **Sample Content:** Extremely limited. Missing velocity layers, round robins, legato transitions, release triggers, and most instrument families (only `violin-1` is present).
- **Performance Intelligence:** Auto-divisi UI control is missing. Auto-articulation is present but unwired by default. Dynamic bloom is not implemented.
- **Unified UI Architecture:** Currently a flat view. Missing unified instrument stack, preset browser, XY pad, keyboard range visualizer, and articulation timeline blocks within a single cohesive view.
- **Advanced Synthesis:** Physical modeling (bow/breath noise, waveguide), Spectral Modeling Synthesis (SMS), and Convolution Reverb (with orchestral IRs) are all completely missing.

## 4. Integrated Stem Separation Workflow

**Codebase Finding:** **Partially Implemented**.
Local AI stem separation (Demucs) is fully implemented and works well natively and in the browser. However, it needs to feed the rest of the DAW fluidly rather than acting solely as restoration tech.

### Missing Features & Architecture:

Not just a “separate stems” button, but a creative workflow:

- **Drag & Split:** Drag song in, split locally.
- **Auto-Routing:** Route each stem to mixer lanes automatically.
- **Direct-to-Device Routing:** “Send vocals to Knead / drums to Toaster sampler / bass to Fermenter layer”.
- **Re-sampling:** Re-sample separated regions straight into the sampler suite.
