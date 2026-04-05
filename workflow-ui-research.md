# Workflow & UI Research (Consolidated)

_Note: Features from the original research documents that have already been implemented exactly as stated in the WebDAW codebase (such as the base single-window layout, `oklch` color system, JetBrains/Inter typography, WebGPU timeline rendering, LUFS metering, YIN/MPM/Polyphonic tuning, FileProvider abstraction, and basic breakpoint automation) have been removed. The following represents the remaining gaps, advanced features, and deviations between the research specifications and the current codebase._

---

## 1. UI, UX, and Advanced Visualizations

### The visualization features that generate the most praise (Missing)

**Modulation halos**
Colored arcs around knobs showing modulation range. Real-time animation showing current value. Color-coded by source.
_Implementation Note:_ The research proposed CSS `conic-gradient` with `--mod-amount` custom properties updated from JS at 30fps. Currently, the codebase uses standard knobs without conic-gradient modulation halos.

**Spectrogram (waterfall)**
Frequency on Y-axis, time on X-axis, amplitude as heatmap color.
_Implementation Note:_ WebGPU compute texture approach. Maintain a 2D storage texture, shift old data left by one column per frame via compute shader, write new FFT column to rightmost position. Currently missing from the analysis tools.

**Stereo goniometer / Lissajous**
L+R channels connected to X and Y of a virtual oscilloscope, rotated 45°.
_Implementation Note:_ Canvas2D. Sample L/R from AudioWorklet, plot `(L+R, L-R)` coordinates with slowly decaying alpha. Currently missing from the mastering/analysis visualizers.

### Arrangement & Workflow Differentiators (Missing)

**Ripple editing**
Reaper's implementation: toggle Alt+P, per-track or all-tracks modes. Delete/insert/move automatically shifts subsequent content. Ableton's lack of ripple editing is one of its most cited failures.

**Nested device chains**
Any device can house other devices: multiband processing, parallel routing, mid/side, feedback loops through a visual nesting metaphor.

**AI stem separation**
Non-destructive spectral editing / stem separation built into the DAW.
_Implementation Note:_ The codebase has an `AudioAnalysis/repositories/browserStemSeparation.ts` stub using WebGPU/WASM, but full timeline UX integration for non-destructive stem editing is missing.

---

## 2. Advanced Automation Architecture

While the codebase has successfully implemented `automationStore`, linear/ease curves (`tension` handle support), and Read/Touch/Latch/Write modes, several advanced paradigms remain unimplemented.

### Missing Paradigms

**Layer 3 — Automation Objects (Reusable Containers)**
Self-contained automation blocks inspired by REAPER's automation items. These are bounded regions of automation data that can be created on any lane, then **moved, pooled (linked copies), stretched, looped, and saved to a library**.
_Implementation Note:_ Pooled copies update simultaneously. Essential for creative reuse (sidechain pump shapes, filter sweeps, LFO patterns as drag-and-drop assets).

**Layer 2 — Clip Automation (Relative Modes)**
The codebase supports basic clip automation shifting, but lacks Bitwig's specific layer mathematics: **additive** (offsets the track value by ±50% of parameter range) and **multiplicative** (scales the track value from 100% to 0%).
_Priority resolution logic:_ Effective value = `Track Absolute Value × Clip Multiplicative × (1 + Clip Additive offset)`.

**Trim Mode & Preview Mode**

- **Trim mode**: A modifier that works with Touch and Latch. A second trim curve appears in the center of the lane, and adjustments offset existing automation proportionally.
- **Preview mode** (Pro Tools style): Suspends all writing. The user adjusts parameters freely, previewing changes. When satisfied, "Write to Selection" commits the captured values.

**LOD mipmap system for automation curves**
Pre-compute a mipmap hierarchy using the Visvalingam-Whyatt algorithm for extreme zoom-out performance. (Level 0: all points, Level 1: ε = 1px, etc.).
_Implementation Note:_ The WebGPU renderer currently lacks this LOD decimation for automation lines.

**Automation comping & Cross-track linking**

- Record multiple automation passes, then comp the best sections.
- Define mathematical relationships between parameters on different tracks.

---

## 3. Scoring Tuner (Remaining Polish)

The Sourdaw Scoring Tuner currently fully implements YIN/MPM detection, Polyphonic string tracking, and both Strobe and Needle GPU rendering, exactly as specified. The following minor polish items are missing:

**Calibration History Graph**
Ring buffer of the last 5–30 seconds of (timestamp, cents) pairs decimated at 20–60 Hz cadence. UI renders as GPU line strip, ±50 cents vertical range, with optional confidence shading.

**Sweeteners (Per-note Cent Offsets)**
Small per-note offsets (0.1 cent granularity) to compensate for instrument-specific intonation issues (string inharmonicity).
_Implementation Note:_ While `.scl` and `.tun` imports exist, a dedicated UI for managing and selecting named "Sweeteners" (like Peterson's presets) is missing.

---

## 4. Local-First Sample Library (Intelligence Layer)

The foundational FileProvider abstraction and indexing pipeline are implemented, but the advanced "Intelligent Discovery" and semantic features remain unbuilt.

### Optional Embedding and Semantic Search Layer

Map each sample to a vector representation that supports similarity search, clustering, and semantic browsing.
_Implementation Candidates:_ CLAP-style multimodal embeddings or OpenL3-style perceptual embeddings.
_Storage:_ Store full-precision vectors in OPFS, lightweight HNSW index separately.

### 2D Spatial Map Architecture

Let users browse libraries by **timbral proximity** rather than by folder tree or text search alone.
_Implementation Note:_ Use **UMAP** as the default map method. Store map coordinates in metadata so the UI can render instantly. Render using GPU-backed point clouds for large libraries.

### DAW Integration and Drag-Out

Let users drag samples directly from the library into the DAW timeline or sampler.
_Implementation Note:_ Desktop builds should implement OS-native promised-file drag systems (Windows virtual file transfer, macOS file promise providers). Treated as a dedicated adapter layer (`DragOutProvider`).
