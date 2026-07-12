---
type: research
id: RESEARCH-workflow-ui
title: Workflow and UI capability gaps
status: open
owner: The Sourdaw team
sources:
  - Consolidated workflow and UI research (UI/UX, automation, sample library)
---

# Research: Workflow and UI capability gaps

## Question

Given Sourdaw's existing arrangement, MIDI editor, automation, and sample-library foundations,
which professional workflow and UI capabilities are missing, and what is the recommended
architecture for each (visualization, automation, sample intelligence, MPE, controllers)?

## Findings

### R-001 — Modulation halos should be CSS conic-gradients, not Canvas/WebGPU

- **Claim:** Bitwig-style colored modulation arcs around knobs (color-coded by source, 30 fps,
  hover-to-audition before commit) are best implemented as CSS `conic-gradient` with a
  `--mod-amount` custom property, GPU-composited by the browser — not Canvas or WebGPU.
- **Evidence:** halos are per-knob DOM decorations; CSS custom properties let the modulation engine
  update at 30 fps while the browser composites natively; Vital's hover-to-audition pattern.
- **Confidence:** high
- **Bears on:** the modulation-system spec (halo ACs).

### R-002 — Spectrum/spectrogram belong on one shared WebGPU pipeline

- **Claim:** A FabFilter-style analyzer and an iZotope-RX-style spectrogram should share one WebGPU
  pipeline rendering at 60 fps, uploading FFT magnitudes as a `Float32Array` to a GPU storage buffer
  each frame, consolidating the three existing `SpectrumAnalyzer` implementations.
- **Evidence:** WebGPU handles dense FFT display at 60 fps; three duplicate analyzers exist today;
  `spectrumMath.ts` already provides FFT utilities.
- **Confidence:** high
- **Bears on:** the spectrum-spectrogram spec.

### R-003 — A unified WebGPU timeline canvas is the target automation renderer

- **Claim:** A single WebGPU canvas overlaying the timeline, decoupled from React and reading an
  external store, rendering all curves/fills/nodes via tessellated line strips with MSAA 4×, is the
  uncompromised renderer; the current React/Canvas `GlutenCurve` path is a functional MVP that
  bottlenecks at thousands of points and should remain only as fallback.
- **Evidence:** standard DOM/Canvas bottlenecks under dense automation + 60 fps playhead; WebGPU
  has headroom.
- **Confidence:** high
- **Bears on:** the webgpu-automation-rendering spec.

### R-004 — Ghost clips (Copilot-style) are the right AI-suggestion surface

- **Claim:** AI suggestions should appear as semi-transparent, dashed, blue/purple "ghost" overlays
  that are accept/dismiss/cycle (Tab / Escape / Alt+]/[) and ephemeral until committed — extended
  to MIDI clips, audio clips (with provenance/audition), and automation overlays.
- **Evidence:** GitHub Copilot's ghost-text pattern; the requirement for reversible, auditionable,
  non-destructive previews.
- **Confidence:** high
- **Bears on:** the ai-ghost-surfaces spec.

### R-005 — Ripple editing and time-range selection are cited DAW gaps

- **Claim:** Reaper-style ripple insert/move (per-track or all-tracks) and a time-range selection
  independent of clip boundaries are professional expectations; Ableton's lack of ripple is a
  frequently cited failure.
- **Evidence:** Reaper's ripple model; ripple delete already exists in Sourdaw.
- **Confidence:** high
- **Bears on:** the arrangement-clip-interactions spec.

### R-006 — Sample intelligence = analysis (Workers) + pluggable embeddings + HNSW + UMAP

- **Claim:** Musical analysis (BPM via onset/autocorrelation, key via chroma, spectral descriptors)
  must run in Web Workers; semantic search needs a pluggable `EmbeddingModel` (CLAP/OpenL3), an HNSW
  index stored separately from full-precision vectors (OPFS/desktop), and a UMAP 2D map with
  precomputed GPU-rendered coordinates.
- **Evidence:** recommended index/embedding families; OPFS storage strategy; UMAP as default
  reduction with stored coordinates for instant render.
- **Confidence:** high
- **Bears on:** the sample-library-intelligence spec.

### R-007 — VCA fader tracks must scale gain in-place, not sum audio

- **Claim:** A true VCA fader controls assigned channels' gain without audio passing through it,
  preserves relative levels, scales post-fader sends, and shows no meters — implemented as a gain
  multiplier applied before each channel's post-fader sends, not as a summing bus.
- **Evidence:** professional mixer convention; the existing `vcaGroupId` folds gain into effective
  engine gain, which mis-models pre-fader sends.
- **Confidence:** high
- **Bears on:** the vca-fader-tracks spec.

### R-008 — Per-note MPE editing requires note-bound lanes, not clip CC lanes

- **Claim:** Rivalling Bitwig/Ableton needs expression lanes attached to the note object (pitch,
  CC74 timbre, pressure, release velocity), per-note transforms, controller recording into
  note-bound data, and a density-management UI for dense MPE.
- **Evidence:** the DSP already supports MPE (pressure/slide/pitch bend); the piano-roll UI is
  per-clip only today.
- **Confidence:** high
- **Bears on:** the mpe-expression-editing spec.

### R-009 — Controllers need a profile + sandboxed scripting + shareable mapping layer

- **Claim:** On top of MIDI Learn/MCU/OSC, the missing layer is auto-detected controller profiles
  for popular hardware, an expanded sandboxed JS/TS scripting API for third-party scripts, and a
  portable import/export format for shared mappings (client-side only).
- **Evidence:** the foundation (MIDI Learn, basic scripting) exists; the profile/community layer
  does not.
- **Confidence:** high
- **Bears on:** the hardware-controller-ecosystem and clip-aliases-variations specs.

## Open questions

- [ ] Q-001 — Default embedding checkpoint (CLAP vs OpenL3)? Benchmark during implementation.
- [ ] Q-002 — Should AI suggestions eventually carry a trust/confidence score? Research-only until
  usage data exists.

## Recommendation

Treat the source as a portfolio of independent workflow features, each its own spec: CSS modulation
halos (R-001) feeding a procedural modulation engine, a shared WebGPU spectrum/spectrogram pipeline
(R-002), a unified WebGPU automation canvas with Canvas-2D fallback (R-003), Copilot-style ghost
suggestion surfaces (R-004), ripple/time-range arrangement editing (R-005), Worker-based sample
analysis with pluggable embeddings + HNSW + UMAP (R-006), true VCA fader tracks (R-007), note-bound
MPE editing (R-008), and a controller profile/scripting/sharing ecosystem (R-009). Sequence
modulation after the halo primitive, and the sample map after the WebGPU infrastructure.

## Design decisions (restored verbatim from source)

The source spec's `## Design decisions` section — eight chosen-vs-rejected rationales — was dropped
during the split. It is restored here verbatim because the rationale behind each interaction is
research-grade context that informs the downstream specs.

### Decision: Alt+drag for duplication vs dedicated duplicate tool

**Chosen:** Alt+drag modifier on existing move gesture.

**Considered and rejected:** A separate "duplicate" tool in the toolbar — rejected because Alt+drag is the universal DAW convention (Ableton, Logic, Cubase, FL Studio, Bitwig, Reaper all use it). A separate tool adds friction. The modifier approach is zero-UI-cost and matches muscle memory from every other DAW.

### Decision: Quick-swap tool via hold duration vs modifier key

**Chosen:** Hold duration (>300ms = temporary, <300ms = permanent switch).

**Considered and rejected:** Using a modifier key (e.g., Ctrl+S for temporary select) — rejected because modifier keys are already heavily used (Shift = add to selection, Alt = duplicate/rubber band, Ctrl/Cmd = system shortcuts). Duration-based detection reuses the existing shortcut keys without new bindings. Bitwig and Reaper both use this hold-to-swap pattern.

### Decision: WebGPU unified timeline canvas vs per-lane canvases

**Chosen:** Single WebGPU canvas overlaying the entire timeline.

**Considered and rejected:** Per-lane individual canvases — rejected because synchronizing multiple GPU contexts is wasteful and creates compositing artifacts. A single canvas with shared vertex buffer is simpler and more performant.

### Decision: CSS conic-gradient for modulation halos vs Canvas/WebGPU

**Chosen:** CSS `conic-gradient` with custom properties.

**Considered and rejected:** Canvas or WebGPU rendering — rejected because halos are per-knob DOM decorations. CSS custom properties let the modulation engine update at 30fps while the browser handles compositing natively.

### Decision: HNSW for vector search vs alternatives

**Chosen:** HNSW approximate nearest-neighbor index.

**Considered and rejected:** Brute-force (O(n) per query, too slow at 100k+), VP-trees/ball-trees (inferior recall/latency ratio at typical embedding dimensions).

### Decision: UMAP for 2D map vs t-SNE

**Chosen:** UMAP.

**Considered and rejected:** t-SNE — less global structure preservation, slower on large datasets, no incremental update support.

### Decision: In-place MIDI editing scope

**Chosen:** Basic inline editing (select, move, draw, delete) in arrangement; double-click for full editor.

**Considered and rejected:** Full-featured inline editing — rejected because the arrangement track height constrains the UI. Complex operations (expression editing, velocity lanes, multi-clip editing) require the full piano roll's vertical space. The inline view is for quick tweaks; the full editor is for deep work.

### Decision: Hybrid Web / Rust tier assignment for AI features

**Chosen:** Interactive / real-time AI features run in the browser Web tier (main thread or Web Worker). Heavy offline / quality-focused AI inference (e.g., singing synthesis, full-song generation, large embedding models) runs in the Rust tier via Tauri commands or Python sidecar. The tier is a design-time property per feature, documented per R-E5, not a runtime toggle.

**Considered and rejected:** (a) Browser-only — rejected because current neural singing / full-song generation models exceed browser WASM/ONNX practical limits for quality, and would either degrade output or push model size past what OPFS can realistically cache per user. (b) Rust-only — rejected because interactive features (ghost UI, modulation halos, spectrum, WebGPU automation, drag-out, MPE editing) require sub-16ms latency that a Tauri IPC round-trip cannot consistently deliver for every UI event. (c) Dynamic runtime tier selection — rejected because it hides a significant performance/behavior cliff from the developer and complicates testing. Explicit per-feature tier assignment is auditable and predictable.

This decision is grounded in `intake/research-ai.md` § 1 (Rust-tier analysis for BPM/Key/Pitch) and the co-located `../audio-generation/research.md` (Rust-tier singing synthesis via ONNX Runtime + Python sidecar for heavy models). The consolidated tier assignments for this spec's AI features are listed in User-visible behavior § E5.
