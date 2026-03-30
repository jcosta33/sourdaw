# Local-First Sample Library and Intelligent Discovery for Sourdaw — AI Implementation Guide

## Purpose

This guide defines the architecture for a **local-first audio sample library** that works across:

- **browser-native builds**
- **Tauri desktop builds**
- optional **hybrid runtime deployments**

The system must let users connect large external sample folders and then:

- index tens of thousands of audio files
- extract searchable metadata
- preview files with minimal latency
- stay synchronized with filesystem changes
- preserve user tags and analysis even when files go offline
- optionally provide **AI-assisted sample discovery**, **similarity search**, and **2D spatial browsing**

The design target is a professional library manager for **Sourdaw**, not a cloud upload service.

---

# 1. Product Definition

The library manager is built around one core principle:

> **The user’s filesystem is the source of truth.**

The app should not require users to import or duplicate their library into a private application database just to search and preview it.

Instead, the architecture uses three distinct layers:

1. **External library root**
2. **Persistent metadata index**
3. **Derived binary cache**

This creates a system that is:

- local-first
- privacy-preserving
- scalable to large libraries
- resilient to restarts and reconnects
- fast enough for creative auditioning

---

# 2. Runtime Targets

## 2.1 Browser Build

Browser builds should use:

- `showDirectoryPicker()` where available
- `FileSystemDirectoryHandle` / `FileSystemFileHandle`
- IndexedDB for metadata and serialized handles
- OPFS for cached binary artifacts
- Web Workers for indexing and analysis
- Web Audio / media-element preview paths

## 2.2 Tauri Build

Desktop builds should use:

- native filesystem access through Tauri’s Rust side
- scoped access rules via the Tauri FS plugin
- native file watchers
- local config or SQLite for persistent library roots
- `convertFileSrc()` or a custom streaming bridge for asset URLs inside the webview

## 2.3 Unified Requirement

Both builds must share one common logical contract:

- the same indexing pipeline
- the same metadata schema
- the same analysis jobs
- the same cache semantics
- the same UI states

The only difference should be **how files are accessed**, not how the library behaves.

---

# 3. Core Architectural Principle: FileProvider Abstraction

The entire system should sit behind a unified `FileProvider` interface.

```ts
interface FileProvider {
    kind: 'browser' | 'tauri' | 'memory';

    listDirectory(pathOrHandle: LibraryRootRef): AsyncIterable<FileEntry>;
    stat(ref: FileRef): Promise<FileStat>;
    openStream(ref: FileRef, range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
    openFile(ref: FileRef): Promise<File | NativeFileHandle>;
    readBytes(ref: FileRef, offset: number, length: number): Promise<Uint8Array>;
    exists(ref: FileRef): Promise<boolean>;
    watch?(root: LibraryRootRef, cb: (events: FileChangeEvent[]) => void): Promise<UnwatchFn>;
}
```

## 3.1 Browser Backend

The browser backend uses:

- directory handles
- file handles
- async iteration over directory contents
- `queryPermission()` / `requestPermission()` logic
- `File` objects and byte reads
- optional `FileSystemObserver` when available

## 3.2 Tauri Backend

The Tauri backend uses:

- absolute paths or scoped path references
- Rust-side `std::fs` or `tokio::fs`
- native watch events
- direct stat/read/open logic
- secure path-to-URL conversion for preview and waveform asset serving

## 3.3 Design Rule

All higher-level systems must depend on `FileProvider`, not on browser handles or Tauri paths directly.

This keeps:

- indexing portable
- tests easier
- fallback modes possible
- feature support consistent across platforms

---

# 4. Library Root Model

A library root is a user-connected folder plus its sync metadata.

```ts
type LibraryRoot = {
    id: string;
    name: string;
    provider: 'browser' | 'tauri';
    rootRef: LibraryRootRef;
    connectedAt: number;
    lastScanAt?: number;
    lastKnownState?: 'ready' | 'offline' | 'permission_required' | 'missing';
    settings: {
        recursive: boolean;
        autoAnalyze: boolean;
        autoWaveform: boolean;
        watchMode: 'native' | 'observer' | 'poll';
    };
};
```

## 4.1 Source of Truth Rule

The library root itself remains authoritative for:

- folder structure
- actual audio bytes
- file modification times
- rename / move / delete truth

The app database stores only:

- references
- derived metadata
- user tags
- analysis outputs
- cache pointers

---

# 5. Persistence and Rehydration

## 5.1 Browser Build

Persist:

- serialized directory handles
- library metadata
- last-known scan state
- tags / favorites / ratings
- derived analysis keys

On relaunch:

1. restore handle from IndexedDB
2. call `queryPermission()`
3. if access is granted, continue sync
4. if access is `"prompt"`, show reconnect UX
5. if access fails, keep metadata but mark the root offline

## 5.2 Tauri Build

Persist:

- absolute root path or approved scoped path
- library settings
- cached metadata / analysis

On relaunch:

- validate path existence
- validate scope access
- resume indexing or watching without browser-style permission flow

## 5.3 UX Requirement

Rehydration must never silently destroy the library index.

If a folder is unavailable:

- mark files as offline
- preserve tags and analysis
- preserve search results for metadata-only browsing
- disable playback for unavailable assets

---

# 6. Three-Tier Storage Architecture

## Layer A — External Library Source

The user’s connected folder.

Stores:

- real audio files
- canonical folder structure
- real modification timestamps

Do not duplicate by default.

## Layer B — Metadata Index

Use IndexedDB in browser builds and either IndexedDB or SQLite-backed metadata on desktop if desired.

Stores:

- file identity
- relative path
- file stats
- format metadata
- musical metadata
- tags
- user labels
- favorites
- waveform cache pointers
- embedding pointers
- sync status

## Layer C — Binary Cache

Use OPFS in browser builds and app-local cache storage in desktop builds.

Stores:

- waveform peaks
- preview thumbnails
- derived lower-rate preview audio
- decoded analysis windows
- embeddings
- index shards
- rendered temporary drag-out assets

---

# 7. Metadata Schema

A practical file record:

```ts
type SampleRecord = {
    id: string;
    libraryRootId: string;
    relativePath: string;
    displayName: string;
    ext: 'wav' | 'aiff' | 'flac' | 'mp3' | 'ogg' | 'm4a' | string;

    sync: {
        exists: boolean;
        mtimeMs?: number;
        sizeBytes?: number;
        hashHint?: string;
        status: 'discovered' | 'indexed' | 'analyzed' | 'offline' | 'error';
    };

    format: {
        durationSec?: number;
        sampleRate?: number;
        channels?: number;
        bitDepth?: number;
        codec?: string;
    };

    musical: {
        bpm?: number;
        key?: string;
        rootNote?: number;
        transientCount?: number;
        loudnessLUFS?: number;
    };

    descriptors: {
        brightness?: number;
        spectralFlatness?: number;
        spectralCentroid?: number;
        crest?: number;
        inharmonicity?: number;
        attackMs?: number;
    };

    tags: string[];
    ucs?: string[];
    preview: {
        waveformCacheKey?: string;
        audioThumbCacheKey?: string;
    };

    embedding?: {
        model: string;
        dim: number;
        vectorKey?: string;
        mapX?: number;
        mapY?: number;
    };
};
```

---

# 8. Directory Traversal and Discovery

## 8.1 Requirement

The app must discover large libraries without freezing the UI.

## 8.2 Browser Traversal Pattern

Use async iteration over the directory tree.

```ts
async function* traverseDirectory(
    dir: FileSystemDirectoryHandle,
    path = ''
): AsyncIterable<{ path: string; handle: FileSystemFileHandle }> {
    for await (const entry of dir.values()) {
        const childPath = path ? `${path}/${entry.name}` : entry.name;
        if (entry.kind === 'file') {
            yield { path: childPath, handle: entry };
        } else if (entry.kind === 'directory') {
            yield* traverseDirectory(entry, childPath);
        }
    }
}
```

## 8.3 Tauri Traversal Pattern

Use Rust-side recursive traversal or async filesystem walking.

Requirements:

- depth-first or breadth-first are both acceptable
- avoid reading full file contents during discovery
- return results incrementally to the frontend
- batch metadata commits

## 8.4 Progressive Discovery UX

As entries are discovered:

- populate the list immediately
- mark new rows as “discovered”
- fill in richer metadata asynchronously
- avoid blocking on full analysis

---

# 9. Indexing Pipeline

Use a staged pipeline.

## Stage 1 — Discovery

Collect:

- file path
- extension
- file size
- mtime
- root association

## Stage 2 — Fast Metadata

Parse:

- duration where cheaply available
- channels
- sample rate
- container and codec info
- embedded tags

## Stage 3 — Musical Analysis

Compute:

- waveform peaks
- BPM
- key
- transient markers
- descriptors
- optional embeddings

## Stage 4 — Cache Materialization

Store:

- waveform cache
- audio thumbnail
- embedding vectors
- map coordinates

## Stage 5 — Search-Ready Commit

Mark record as:

- indexed
- analyzed
- ready for preview

---

# 10. Transaction Strategy

The metadata store must be updated in **batches**, not record-by-record transactions.

## 10.1 Rule

Write:

- hundreds or thousands of changes per transaction where practical

Avoid:

- one transaction per file
- synchronous UI-driven writes inside the render loop

## 10.2 Suggested Batch Sizes

Use dynamic batching, for example:

- 100–500 files per fast discovery batch
- 25–100 files per analysis commit batch
- lower sizes on constrained devices

## 10.3 Sharding

Sharding can be useful for very large libraries, but it should be a measured optimization, not the default complexity.

Recommended default:

- one primary object store for `sample_records`
- secondary stores or indexes for:
    - tags
    - embeddings
    - waveform cache refs
    - library roots

Only introduce aggressive sharding if measured workloads justify it.

---

# 11. Metadata Extraction Strategy

## 11.1 Principle

Never fully decode every file during initial indexing.

## 11.2 Fast Path

Use lightweight header/tag parsing to get:

- duration
- sample rate
- channel count
- container metadata
- embedded tags

This should be the default path for first-time indexing.

## 11.3 Heavy Path

Use targeted decode windows only when required for:

- waveform generation
- BPM detection
- key detection
- descriptors
- preview generation

## 11.4 Memory Rule

Do not decode full multi-minute files into PCM unless:

- the user explicitly previews them
- analysis specifically requires more data
- the result is bounded and released promptly

---

# 12. Audio Analysis Pipeline

Run analysis in **Web Workers** for browser builds and in background threads/tasks for native builds.

## 12.1 Waveform Peaks

Generate min/max peak data rather than storing full PCM for UI rendering.

For each visual bucket:

- scan a window of samples
- store min amplitude
- store max amplitude

This gives:

- fast waveform rendering
- tiny cache size
- instant zoom previews

## 12.2 BPM Detection

Use onset-envelope and autocorrelation or tempogram-style analysis.

Autocorrelation form:

$$
R(\tau) = \sum_t x(t)\,x(t-\tau)
$$

Where:

- `x(t)` is an onset-strength or energy envelope
- the best lag `\tau` corresponds to likely beat periodicity

Use:

- partial-file windows for long audio
- confidence scoring
- fallback to “unknown” rather than false precision

## 12.3 Key Detection

Use chroma-based or equivalent pitch-class analysis.

A standard chroma accumulation form:

$$
\text{Chromagram}(p) = \sum_{k \in \{k \mid \text{freq}(k) \approx \text{pitch}(p)\}} |X(k)|^2
$$

Use:

- tonal-window filtering
- ignore long silence-only or percussive-only regions
- weighted voting over multiple windows
- confidence floor before assigning a final key

## 12.4 Descriptor Extraction

Recommended descriptors:

- spectral centroid
- spectral flatness
- spectral crest
- RMS / loudness proxy
- transient density
- inharmonicity estimate
- zero-crossing rate where useful
- low/mid/high band energy ratios

These are useful both for faceted search and for later embedding fallback systems.

---

# 13. Optional Embedding and Semantic Search Layer

This layer is optional but should be designed in from the start.

## 13.1 Embedding Goal

Map each sample to a vector representation that supports:

- similarity search
- clustering
- semantic browsing
- map visualization
- “find similar” features

## 13.2 Recommended Embedding Families

Good candidates include:

- **CLAP**-style multimodal embeddings
- **OpenL3**-style perceptual embeddings
- **PANNs**-style event-oriented embeddings
- smaller domain-specific audio encoders for on-device use

## 13.3 Design Rule

Treat the embedding subsystem as **pluggable**.

```ts
interface EmbeddingModel {
    id: string;
    dimension: number;
    domain: 'general' | 'drums' | 'loops' | 'fx';
    embed(audioWindow: Float32Array | AudioChunkSet): Promise<Float32Array>;
}
```

## 13.4 Practical Recommendation

Start with:

- lightweight hand-crafted descriptors for all files
- embeddings only for files the user cares about or for idle-time background enrichment

This keeps first-run performance sane.

---

# 14. Vector Search Architecture

Use an approximate nearest-neighbor system for similarity search.

## 14.1 Recommended Index Families

- **HNSW** for strong recall/latency balance
- optional IVF/HNSW hybrid for very large libraries
- exact cosine search only for small subsets or reranking

## 14.2 Storage Strategy

Store:

- full-precision vectors in OPFS or desktop cache
- lightweight search index separately
- metadata IDs outside the vector heap

## 14.3 Query Flow

1. embed query item
2. search ANN index
3. rerank top candidates if needed
4. fetch metadata records
5. render similarity list or map highlight

---

# 15. 2D Spatial Map Architecture

The spatial explorer is a visualization layer over embeddings.

## 15.1 Purpose

Let users browse libraries by **timbral proximity** rather than by folder tree or text search alone.

## 15.2 Dimensionality Reduction

Recommended methods:

- **UMAP** as the default map method
- t-SNE only for offline analysis or experimental modes
- optional parametric UMAP or projection model for stable incremental insertion

## 15.3 Stability Requirement

The map must not re-scramble wildly every time new content is indexed.

Use one or more of:

- fixed random seed
- anchor/landmark points
- projection transform for new points
- periodic full-layout recomputation only on explicit rebuild

## 15.4 Stored Coordinates

Store map coordinates in metadata so the UI can render instantly without recomputing the layout on every launch.

---

# 16. Rendering Architecture for Large Libraries

## 16.1 List View

Use **virtual scrolling**.

Never render all rows at once.

Requirements:

- viewport-only row rendering
- recycled row components
- stable keyboard navigation
- progressive metadata fill-in

## 16.2 Map View

Use **GPU-backed rendering** for large point clouds.

Recommended stack:

- WebGPU if available
- fallback to WebGL or canvas-based reduction for smaller datasets

## 16.3 LOD Strategy

For very large maps, use level-of-detail:

- coarse point sample when zoomed out
- more detail on zoom
- selection overlay in a separate pass
- cluster summaries for dense clouds

---

# 17. OPFS and Cache Design

## 17.1 What Goes Into OPFS

Browser cache artifacts should include:

- waveform peak files
- audio thumbnails
- preview transcodes
- vector index shards
- embedding blobs
- partial decoded windows for repeated analysis
- map coordinate datasets

## 17.2 What Should Not Go Into OPFS By Default

Do not copy the full original library into OPFS unless the user explicitly asks for an offline mirror.

## 17.3 Cache Key Design

Use deterministic cache keys derived from:

- library root ID
- relative path
- file size
- mtime
- analysis version
- algorithm version

This makes cache invalidation tractable.

---

# 18. Playback and Preview Path

## 18.1 Browser Preview

Preview paths may use:

- file handles → `File` → `ArrayBuffer`
- media-element blob URLs
- Web Audio decode for short files
- partial-read / streaming strategies where available

## 18.2 Desktop Preview

Desktop builds may use:

- native byte reads through Rust
- `convertFileSrc()` for webview-loadable URLs
- a custom local streaming endpoint if range-aware preview is needed

## 18.3 Preview Rules

- preview start should feel immediate
- long files should not require full decode to begin preview
- replaying the same item should hit a recently-used cache where possible
- preview loudness should be normalized or at least gain-clamped to avoid jump scares

---

# 19. Change Detection and Synchronization

## 19.1 Browser Strategy

Support a hierarchy of sync methods:

1. `FileSystemObserver` when available and stable enough
2. directory-level differential polling
3. manual refresh as fallback

## 19.2 Polling Strategy

Polling should:

- check directory/file metadata only
- avoid full-content reads
- use exponential backoff or idle-time scheduling
- stop or slow down in background tabs

## 19.3 Native Strategy

Desktop builds should use native file watching.

Requirements:

- recursive watch support
- debounce for burst changes
- immediate mode for critical workflows if needed
- rename/move reconciliation where possible

## 19.4 Reconciliation Logic

For each change event:

- update existence
- update mtime/size
- invalidate stale cache entries
- re-run only the necessary analysis stages
- keep user tags unless the record is explicitly deleted by user policy

---

# 20. Missing Files and External Drives

This is a first-class workflow, not an edge case.

## 20.1 States

A file or library root may be:

- `ready`
- `offline`
- `permission_required`
- `missing`
- `moved`
- `relink_candidate`

## 20.2 UX Requirements

If an external SSD is disconnected:

- keep the library visible
- show an offline banner
- keep search, tags, favorites, and map browsing available
- disable preview for unavailable files
- offer reconnect / relink actions

## 20.3 Relink Strategy

Relinking should reconcile by:

- relative path
- filename
- size
- optional content hash hints

Do not throw away the user’s organization just because the drive path changed.

---

# 21. Search and Faceted Filtering

Provide multiple search modes.

## 21.1 Text Search

- filename
- folder path
- tags
- notes
- UCS category terms

## 21.2 Musical Facets

- BPM range
- key
- root note
- duration range
- mono/stereo
- sample rate
- transient density

## 21.3 Descriptor Facets

- brightness
- noisiness
- punch
- tonal vs. noisy
- harmonic vs. inharmonic

## 21.4 Similarity Search

- query by selected sample
- query by dragged reference audio
- query by text label if multimodal embeddings are enabled

---

# 22. UX Design Pattern

The UX vocabulary should say:

- **Connect folder**
- **Link library**
- **Sync**
- **Analyze**
- **Available offline / currently offline**
- **Restore access**

It should not feel like:

- upload
- import-and-duplicate
- cloud sync unless that is a separate feature

---

# 23. Primary UX Flows

## 23.1 First Connection

1. user clicks “Connect Sample Folder”
2. app explains local-first behavior
3. user grants access
4. indexing begins immediately
5. files appear progressively
6. background analysis fills metadata over time

## 23.2 Resume Session

1. app restores library roots
2. permission or scope is verified
3. existing metadata appears immediately
4. sync and change reconciliation run in background

## 23.3 Offline Drive

1. banner indicates drive missing
2. records remain searchable
3. preview disabled
4. user can relink or reconnect

## 23.4 Manual Refresh

1. user triggers rescan
2. only changed subtrees are re-indexed where possible
3. tags and user state preserved

---

# 24. Worker and Thread Architecture

## 24.1 Browser

Use a worker pool for:

- metadata parsing
- waveform generation
- BPM/key analysis
- embedding generation
- cache file writes

Keep main thread responsible for:

- UI
- viewport state
- user input
- lightweight query orchestration

## 24.2 Desktop

Use Rust background tasks or worker pools for:

- filesystem crawling
- metadata parsing
- decoding windows
- analysis
- cache writing
- watch event reconciliation

## 24.3 Scheduling Rule

Indexing and analysis must be:

- cancellable
- resumable
- priority-aware
- backpressure-aware

User-triggered preview always outranks background analysis.

---

# 25. DAW Integration and Drag-Out

This subsystem is optional but strategically important.

## 25.1 Goal

Let users drag samples directly from the library into a DAW timeline or sampler.

## 25.2 Native Promise Files

Desktop builds may implement OS-native promised-file drag systems:

- Windows virtual file transfer via file-descriptor/file-contents style data objects
- macOS file promise providers

## 25.3 Design Rule

Treat drag-out as a dedicated adapter layer, not as part of the library core.

```ts
interface DragOutProvider {
    beginDrag(sampleId: string, options: DragRenderOptions): Promise<void>;
}
```

Possible render options:

- original file
- preview-normalized copy
- tempo-cropped version
- pitch-shifted export
- trimmed export

---

# 26. Security Model

## 26.1 Browser

- require explicit user-granted handles
- never assume absolute path visibility
- re-check permission state on restore
- surface revocation cleanly

## 26.2 Desktop

- restrict filesystem scope
- avoid broad wildcard access unless the user explicitly chose it
- separate read scopes from write scopes where possible

## 26.3 General

- never delete user files without explicit confirmation
- treat cache storage as disposable
- treat source files as canonical

---

# 27. Performance Targets

Targets should be measurable, not aspirational hand-waving.

## 27.1 First Discovery

- visible results should begin appearing almost immediately
- the UI must remain interactive during scans

## 27.2 Search

- common metadata searches should feel instant
- descriptor and tag filters should update without blocking the UI

## 27.3 Preview

- starting a preview should feel immediate for common sample sizes
- repeated previews should hit cache whenever possible

## 27.4 Rendering

- list scrolling should stay smooth
- map panning/zooming should stay smooth with progressive LOD

## 27.5 Memory

- never preload the whole library
- enforce explicit cache budgets
- release decoded buffers deterministically when possible

---

# 28. Implementation Plan

## Phase 1 — Local-First Core

1. `FileProvider` abstraction
2. library root persistence
3. discovery crawl
4. metadata database
5. progressive file list
6. manual refresh

## Phase 2 — Analysis and Preview

1. fast header parsing
2. waveform generation
3. preview path
4. BPM/key analysis
5. faceted search
6. virtual scrolling

## Phase 3 — Sync Robustness

1. permission rehydration
2. broken-link states
3. differential polling
4. native watch integration
5. cache invalidation

## Phase 4 — Binary Cache

1. OPFS/app-cache storage
2. waveform and preview thumbnails
3. cache-key versioning
4. bounded cache eviction

## Phase 5 — Intelligent Discovery

1. descriptor search
2. embeddings
3. ANN similarity index
4. 2D map projection
5. GPU point-cloud explorer

## Phase 6 — DAW Bridge

1. drag-out original files
2. promised-file export adapters
3. rendered drag variants
4. sampler/clip-target integration

---

# 29. Validation and QA

## 29.1 Filesystem Validation

- reconnect after restart
- moved folder handling
- offline drive handling
- permission revocation handling
- watch vs. poll parity

## 29.2 Metadata Validation

- no silent data loss
- deterministic updates on changed files
- batch writes do not corrupt indexes
- stale cache invalidated correctly

## 29.3 Audio Validation

- preview works across supported formats
- waveform cache matches source
- BPM/key confidence behaves sensibly
- long-file preview does not exhaust memory

## 29.4 UX Validation

- first-run flow is understandable
- offline state is understandable
- users can relink without re-tagging everything
- progressive indexing feels alive rather than frozen

---

# 30. Minimal Build Summary

If an AI agent needs the shortest faithful implementation brief, use this:

1. Build the sample library as a **local-first filesystem client**, not a cloud uploader.
2. Use a `FileProvider` abstraction so browser handles and Tauri paths share one indexing pipeline.
3. Keep the user’s folder as the source of truth, store metadata in IndexedDB or equivalent, and store derived binary caches in OPFS/app-local cache.
4. Persist library roots across sessions and rehydrate permissions or scope on launch.
5. Traverse folders asynchronously and batch database writes.
6. Use header parsing first; only decode targeted audio windows for waveform, BPM, key, and descriptor analysis.
7. Keep preview on-demand and cache recent results.
8. Detect changes with native watchers where available and polling/manual refresh elsewhere.
9. Preserve metadata and tags when files go offline or drives disconnect.
10. Add optional intelligence as a separate layer: embeddings, ANN similarity search, and a UMAP-based 2D map.
11. Use virtual scrolling for list views and GPU-backed rendering for large point clouds.
12. Treat drag-out to DAWs as a dedicated adapter layer, not as part of the core indexing engine.

---
