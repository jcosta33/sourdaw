# Spec of the Gaps

## Context

This specification consolidates the remaining implementation gaps, technical debt, and pending requirements from existing "Implemented" and "Partial" specifications. By centralizing these items, we ensure they are tracked while allowing the original feature specs to be closed out as "Implemented" relative to their initial core milestones.

---

## 1. UI & Design System Gaps

### 1.1 Design System Token Alignment (Implemented)

- **Source:** `design-system.md`
- **Status:** Consolidated surface token naming in `tokens.css` to match the spec's `--surface-*` convention. Legacy aliases are maintained for compatibility. `main.css` now imports `tokens.css` as the single source of truth.

### 1.2 Layout Component Migration (Implemented)

- **Source:** `layout-components-migration.md`, `layout-components.md`
- **Status:** Completed systematic migration of "Tier 1" components (`DawControlStrip.tsx`, `DawDialogFooter.tsx`, `DawMetricCluster.tsx`, `DawPluginMetricStrip.tsx`) and major panels (`GlutenPanel`, `YeastPanel`, `BacteriaPanel`) from inline Tailwind flex/grid classes to the `Stack`, `Row`, and `Grid` primitives.

---

## 2. Core Engine & Infrastructure Gaps

### 2.1 CRDT & Persistence

- **Source:** `crdt.md`
- **Gap:** Implement `CrdtHistory` and `crdtLazyLoad.ts` enhancements.
- **Gap:** Refactor `crdtMerge` to replace Brute-Force Trial Merge anti-pattern.
- **Gap:** Implement robust incremental auto-save.

### 2.2 Freeze, Flatten, & Bounce

- **Source:** `freeze-flatten-bounce.md`
- **Gap:** Advanced bounce options dialog (inserts, sends, automation toggles).
- **Gap:** Sidechain-aware dependency graph ordering for freeze renders.
- **Gap:** UI components: progress bar in track header, stale warning overlay.
- **Gap:** LWW semantics collaborative lock UI and explicit conflict resolution.
- **Gap:** Advanced file system GC based on age/size limits.
- **Debt:** Fix duplicate UUIDs in `activeAlternativeId` arrays during bounce operations.

### 2.3 Audio & Platform

- **Source:** `audio-generation-browser.md`
- **Gap:** Refine full fallback routing for browser-based AI generation.
- **Gap:** Verify WebGPU fallback robustness across browser versions.
- **Gap:** Optimize OPFS storage cleanup logic for heavy use.

---

## 3. Instrument & DSP Gaps

### 3.1 Fermenter (Flagship Synth)

- **Source:** `fermenter.md`
- **Gap:** Vital-style spectral morphing.
- **Gap:** Wavetable mip-maps for alias-free high-frequency playback.
- **Gap:** True PM/FM routing matrices.
- **Gap:** GPU-accelerated additive synthesis engine.

### 3.2 Knead & Clip Pitch Editing

- **Source:** `knead.md`, `clip-pitch-editing.md`
- **Gap:** Polyphonic STFT/partial tracking.
- **Gap:** Probabilistic pYIN integration.
- **Gap:** Formant estimation and preservation (LPC/cepstral).
- **Gap:** Phase vocoder and transient preservation pathways.
- **Gap:** Assignment/repair tools, harmonizer mode, pitch-to-MIDI extraction, and Revoice mode.
- **Gap:** 6-hotspot UI interaction model for pitch blob manipulation.
- **Technical Debt:** Replace blocking IPC with triple-buffer lock-free mechanism for real-time pitch editing.

### 3.3 Drum Machine Realism

- **Source:** `drum-machine-realism.md`
- **Gap:** Physical models for 909, LinnDrum, and SP1200 engines.
- **Gap:** Complete PolyBLEP implementation for the 808 hi-hat.
- **Gap:** µ-law companding integration for remaining legacy engines.

### 3.4 Unified Sampler Suite

- **Source:** `unified-sampler-suite.md`
- **Gap:** Consolidation into a standalone `sampler_engine` Rust crate.
- **Gap:** Implementation of the dedicated `modules/Sampler` React module.
- **Gap:** Four playback modes, unified UI, and advanced warp/slice features.

### 3.5 Piano Plugin (Grand Boule)

- **Source:** `piano-plugin.md`
- **Gap:** Implementation of the dedicated frontend UI module (`src/modules/PianoPlugin`).

### 3.6 Levain Orchestral Engine

- **Source:** `orchestra.md`
- **Gap:** Physical modeling augmentation (Phase 3).
- **Gap:** Full progressive-disclosure UI (Levels 1-6).

---

## 4. Feature & Tool Gaps

### 4.1 Sample Library Intelligence

- **Source:** `sample-library.md`
- **Gap:** Freesound OAuth2 integration and offline CC0 library (packs) support.
- **Gap:** Migration to Rust-backed `PackIndex` and `SampleEntry` models with Blake3 content-addressing.
- **Gap:** `nucleo-matcher` high-performance fuzzy search.
- **Gap:** Advanced audio preview system (dedicated thread, crossfades).
- **Gap:** Waveform peak cache and background pack downloader.

### 4.2 Yeast (MIDI FX)

- **Source:** `yeast.md`
- **Gap:** Real-time Piano Roll Preview (forward visibility into scheduled events).
- **Gap:** Groove Template Extraction pipeline from MIDI clips.
- **Gap:** Extend scheduling bridge with a read-only tap for preview events.

---

## Acceptance Criteria

- [ ] This spec is updated whenever a new gap is identified in an "Implemented" feature.
- [ ] Items are removed from this spec only when their implementation is verified and moved to an "Implemented" status in their respective domain.
