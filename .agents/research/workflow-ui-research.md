# Consolidated Workflow & UI Research

*Note: This document consolidates research on UI/UX, Automation, and the Sample Library. Features that have already been fully implemented in the Sourdaw codebase have been removed. The remaining sections detail missing capabilities or architectural plans that still need to be built, annotated with findings from the current codebase.*

## 2. UI/UX & Layout (Missing Features)
**Codebase Annotation:** The core single-window layout, bottom zone, Cmd+K command palette (`CommandPalette.tsx`), and the `oklch` dark theme (`colorPresets.ts`) are implemented. The following advanced visualization and AI UI features remain missing.

### Modulation Halos (Bitwig-style)
Colored arcs around knobs showing modulation range. Real-time animation showing current value. Color-coded by source. Vital synth's **live preview** — hovering over a target auditions modulation before committing.
*Implementation planned:* CSS `conic-gradient` with `--mod-amount` custom property updated from JS at 30fps. GPU-composited by browser.

### Spectrum Analyzer & Spectrogram
* **Spectrum analyzer (FabFilter Pro-Q style):** Real-time FFT with configurable resolution, perceptual tilt, adjustable release speed, GPU-accelerated at 60fps. Innovations: Spectrum Grab (hover to freeze), collision detection.
* **Spectrogram (waterfall):** Frequency on Y-axis, time on X-axis, amplitude as heatmap color. iZotope RX gold standard — waveform + spectrogram overlay.
*Implementation planned:* WebGPU. Upload FFT data as Float32Array to GPU storage buffer each frame.

### Session View + Arrangement Side-by-Side
Unlike Ableton which requires tab-switching, both views should be simultaneously visible. The current codebase supports arrangement but lacks the vertical Session View clip launcher.

### Ripple Editing
Reaper's implementation: toggle Alt+P, per-track or all-tracks modes. Delete/insert/move automatically shifts subsequent content. Ableton's lack of ripple editing is one of its most cited failures.

### AI Integration UX: Ghost Clips
Borrow GitHub Copilot's ghost text pattern for the timeline: **AI-generated clips appear as semi-transparent, dashed-border elements** with a distinctive visual treatment (subtle blue/purple tint). Accept with Tab or click, dismiss with Escape, cycle alternatives with Alt+] / Alt+[. Ghost clips are ephemeral — only committed to the timeline on explicit acceptance. "In progress" shows an animated shimmer/pulse on the ghost clip area.

---

## 3. Automation System (Missing Features)
**Codebase Annotation:** The core 3-layer automation architecture (track absolute, clip relative, automation objects) and basic breakpoint editing/shape insertion tools are implemented (`src/modules/Automation/`). However, the WebGPU rendering pipeline and advanced routing features are missing.

### Technical Rendering Architecture (WebGPU)
**WebGPU can absolutely handle this at scale.** Performance is not a concern for automation rendering with WebGPU. Currently, automation relies on standard React/Canvas rendering (`GlutenCurve`).
**Recommended rendering architecture:**
Separate React's rendering cycle from the GPU rendering loop. React manages DOM elements (lane headers, controls, labels, menus) through virtualized scrolling. A single WebGPU canvas overlays the entire timeline area and renders all curves, waveforms, fills, and nodes. The WebGPU renderer reads from an external store.
**Curve rendering pipeline:** Use tessellated line strips with MSAA 4×. Subdivide Bezier/curved segments into short line segments on the CPU, expand into screen-aligned quads.
**SUPERIOR METHOD:** Original Research - A unified WebGPU timeline is vastly superior for a professional DAW. While the current React/Canvas (`GlutenCurve`) implementation is a functional MVP, standard DOM/Canvas rendering quickly bottlenecks with thousands of automation points, dense waveforms, and 60fps playhead updates. The WebGPU architecture should remain the target for uncompromised rendering performance.

### Procedural Modulation System
LFO, envelope, step sequencer modulators connectable to any parameter (Bitwig-inspired). Needs to be connected to the UI's Modulation Halos.

### VCA Fader Tracks
VCA faders control gain of assigned channels **without audio passing through** — maintain relative positions, correctly scale post-fader sends. No meters on VCA strips. Store VCA associations; apply gain multiplier before each channel's post-fader sends.

### Power User & Innovation Features
* **Automation comping:** Record multiple automation passes, then comp the best sections.
* **AI-assisted volume riding:** Analyze audio dynamics and suggest automation curves to maintain a target perceived loudness.
* **Cross-track automation linking:** Define mathematical relationships between parameters on different tracks.

---

## 4. Intelligent Sample Library (Missing Features)
**Codebase Annotation:** The foundational local-first architecture (`FileProvider`), IndexedDB persistence, and directory traversal are implemented (`src/modules/SampleLibrary/`). The following analysis and intelligence layers are missing.

### Stage 3 — Musical Analysis
* **BPM Detection:** Use onset-envelope and autocorrelation or tempogram-style analysis.
* **Key Detection:** Use chroma-based or equivalent pitch-class analysis with tonal-window filtering.
* **Descriptor Extraction:** Spectral centroid, spectral flatness, spectral crest, RMS / loudness proxy, transient density, inharmonicity estimate.

### Optional Embedding and Semantic Search Layer
Map each sample to a vector representation that supports similarity search, clustering, semantic browsing, and map visualization.
* **Recommended Embedding Families:** CLAP-style multimodal embeddings, OpenL3-style perceptual embeddings.
* Treat the embedding subsystem as **pluggable** (`interface EmbeddingModel`).

### Vector Search Architecture
Use an approximate nearest-neighbor (ANN) system for similarity search.
* **Recommended Index Families:** HNSW for strong recall/latency balance.
* **Storage Strategy:** Store full-precision vectors in OPFS or desktop cache, lightweight search index separately.

### 2D Spatial Map Architecture
The spatial explorer is a visualization layer over embeddings to let users browse libraries by **timbral proximity**.
* **Dimensionality Reduction:** UMAP as the default map method.
* **Rendering:** Use GPU-backed rendering for large point clouds (WebGPU if available). Store map coordinates in metadata so the UI can render instantly without recomputing.

### DAW Integration and Drag-Out
Let users drag samples directly from the library into a DAW timeline or sampler.
* **Native Promise Files:** Desktop builds may implement OS-native promised-file drag systems (Windows virtual file transfer, macOS file promise providers).
* Treat drag-out as a dedicated adapter layer (`interface DragOutProvider`), supporting renders of tempo-cropped, pitch-shifted, or normalized variants.