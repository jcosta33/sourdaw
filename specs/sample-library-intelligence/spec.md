---
type: spec
id: SPEC-sample-library-intelligence
title: Intelligent sample library
status: in-progress
owner: The Sourdaw team
sources:
  - ../workflow-ui/research.md
---

# Intelligent sample library

## Intent

Layer intelligence onto the existing `SampleLibrary` module: musical analysis (BPM, key,
descriptors) in Web Workers, a pluggable embedding model with HNSW similarity search, a UMAP 2D
timbral map, and a rich drag-out / contextual-audition layer with auto-tagging. The goal is to
browse and retrieve sounds by musical meaning, not just filename.

## Non-goals

- Training or shipping specific ML embedding checkpoints.
- The base file scanning / IndexedDB persistence / folder UI — already implemented.

## Requirements

### AC-001 — Musical analysis runs off the UI thread

Importing samples must populate BPM, key, and descriptor fields (centroid, flatness, crest, RMS,
transient density, inharmonicity) on `SampleRecord` via Web Workers with zero main-thread
long-tasks (>50 ms).

Verify with: `pnpm test:run -- SampleLibrary musicalAnalysis`

### AC-002 — A pluggable embedding model produces vectors

A pluggable `EmbeddingModel` interface with at least one implementation (CLAP or OpenL3 family)
must map each sample to a stored vector (OPFS in browser, desktop cache in Tauri).

Verify with: `pnpm test:run -- SampleLibrary embeddingModel`

### AC-003 — HNSW similarity search returns ranked results fast

"Find similar sound" must return results ranked by embedding distance with p95 query latency
<100 ms on a 100k-sample library, the HNSW index stored separately from vectors.

Verify with: `pnpm test:run -- SampleLibrary similaritySearch`

### AC-004 — A UMAP 2D map renders by timbral proximity

A UMAP 2D map must render up to 100k points (GPU-backed) from pre-computed coordinates with
pan/zoom/select/audition and no recomputation on open.

Verify with: `manual` — open the map on a large library and confirm instant render with interactive pan/zoom/audition

### AC-005 — Drag-out works in browser and desktop

Samples must drag out to the timeline/sampler via HTML5 drag (browser) and native file promise
(desktop) through a `DragOutProvider` supporting tempo-cropped, pitch-shifted, and normalized variants.

Verify with: `pnpm test:run -- SampleLibrary dragOutProvider`

### AC-006 — Contextual audition previews in tempo and key

Dragging must audition the sample time-stretched to project tempo and pitch-shifted to project key
before drop, starting within 100 ms of hover.

Verify with: `manual` — hover-drag a sample and confirm tempo/key-matched audible preview before dropping

### AC-007 — Import auto-tags samples

Importing must auto-tag samples (kick, snare, dark, pad, lead, etc.) into `SampleRecord.tags`.

Verify with: `pnpm test:run -- SampleLibrary autoTagging`

## Open questions

- [ ] (non-blocking) Default embedding checkpoint — CLAP vs OpenL3? Proposed: CLAP for richer semantics.

## Affected areas

- `SampleLibrary` module (`SampleRecord` analysis fields, drag-out adapters)
- embedding/vector infrastructure (in `AudioAnalysis` or a new `SampleIntelligence` module)

## Dropped from sources

- "Last-used chain" ranking and smart collections beyond auto-tag/recently-used — incremental follow-up.
