# Web Performance Gap Analysis

Audit of the codebase against [performance-web.md](./performance-web.md). Each section identifies the gap, the affected files, and the concrete remediation steps.

---

## 1. Metering Data in React State (Critical)

**Principle violated:** "Never put audio-rate or display-rate data in React state."

### Current State

[useMeterLevel.ts](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/hooks/useMeterLevel.ts) calls `setLevel()` (React `useState`) on **every `requestAnimationFrame` tick** — 60 setState calls/sec per meter instance. Each call triggers React reconciliation. With N visible tracks, that's N×60 reconciliations/sec just for meters.

### Affected Files

| File | Issue |
|---|---|
| [useMeterLevel.ts](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/hooks/useMeterLevel.ts) | `setLevel()` inside rAF loop |
| [StatusBar.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/views/StatusBar.tsx) | rAF loop likely updating React state for transport display |

### Remediation

1. Replace `useState` in `useMeterLevel` with a **`useRef`-based approach** that drives a `<canvas>` meter directly.
2. Create a `MeterCanvas` component that receives `trackId`, runs its own rAF loop, and writes peak/RMS directly to canvas pixels — zero React re-renders.
3. Alternatively, implement a **single master rAF scheduler** (see §6) and register meter draw callbacks on it.

---

## 2. Playhead Position in React Store (Critical)

**Principle violated:** "Meter levels, playhead position, and waveform scroll position must live in `useRef` values."

### Current State

[playheadScheduler.ts](file:///Users/josecosta/dev/webdaw/src/modules/Transport/useCases/playheadScheduler.ts#L627) calls `transportStore.set()` on every scheduler tick (~100 times/sec, setTimeout at 10ms grain). This pushes `playheadPosition` into a `Store` that triggers `useSyncExternalStore` subscribers across the entire app. Every component reading transport state re-renders on every tick.

```typescript
// Line 627 — fires every 10ms during playback
transportStore.set({ ...current, playheadPosition: newPosition });
```

### Affected Files

| File | Issue |
|---|---|
| [playheadScheduler.ts](file:///Users/josecosta/dev/webdaw/src/modules/Transport/useCases/playheadScheduler.ts) | `transportStore.set()` every tick |
| [transportStore.ts](file:///Users/josecosta/dev/webdaw/src/modules/Transport/stores/transportStore.ts) | Store notifies all subscribers |
| Every component using `transportStore` | Re-renders ~100x/sec during playback |

### Remediation

1. **Split transport state**: Keep discrete state (isPlaying, tempo, loop points) in `transportStore`. Move `playheadPosition` to a **separate `useRef`-based channel** — e.g., a plain `{ current: number }` object or a `Float64Array(1)`.
2. Playhead-reading components (timeline, status bar) read position from the ref inside their rAF callback, never from React state.
3. The playhead scheduler writes to the ref instead of calling `transportStore.set()`.

---

## 3. Per-Call Float32Array Allocation in Metering (High)

**Principle violated:** "Pre-allocate and reuse TypedArrays — never create `new Float32Array` in the render loop."

### Current State

[createWebAudioEngine.ts](file:///Users/josecosta/dev/webdaw/src/modules/AudioEngine/repositories/createWebAudioEngine.ts#L246) allocates a **new `Float32Array`** on every call to `getTrackPeakLevel()` and `getMasterPeakLevel()`:

```typescript
// Line 246 — called 60x/sec per visible track
const data = new Float32Array(strip.analyserNode.frequencyBinCount);
strip.analyserNode.getFloatTimeDomainData(data);
```

This creates GC pressure (N allocations × 60fps). The `getBusPeakLevel` function at line ~954 has the same issue.

### Affected Files

| File | Lines | Issue |
|---|---|---|
| [createWebAudioEngine.ts](file:///Users/josecosta/dev/webdaw/src/modules/AudioEngine/repositories/createWebAudioEngine.ts) | 241–256 | `getTrackPeakLevel` — new Float32Array per call |
| [createWebAudioEngine.ts](file:///Users/josecosta/dev/webdaw/src/modules/AudioEngine/repositories/createWebAudioEngine.ts) | 258–269 | `getMasterPeakLevel` — new Float32Array per call |
| [createWebAudioEngine.ts](file:///Users/josecosta/dev/webdaw/src/modules/AudioEngine/repositories/createWebAudioEngine.ts) | ~950 | `getBusPeakLevel` — same pattern |

### Remediation

1. Pre-allocate a **single `Float32Array`** per analyser node at strip creation time and reuse it:
   ```typescript
   const meterBuffer = new Float32Array(analyserNode.frequencyBinCount);
   // In getTrackPeakLevel:
   strip.analyserNode.getFloatTimeDomainData(strip.meterBuffer);
   ```
2. Store the buffer on the `TrackChannelStrip` type and pass it to `getFloatTimeDomainData`.

---

## 4. Multiple Independent rAF Loops (High)

**Principle violated:** "A single master `requestAnimationFrame` loop drives all visual updates — never create multiple independent rAF loops."

### Current State

The codebase has **10+ independent rAF loops**, each calling `requestAnimationFrame` individually:

| Component | File |
|---|---|
| Meter level hook | [useMeterLevel.ts](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/hooks/useMeterLevel.ts) |
| Status bar | [StatusBar.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/views/StatusBar.tsx) |
| Timeline surface | [TimelineSurface.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Arrangement/presentations/views/TimelineSurface.tsx) |
| LUFS meter | [LUFSMeter.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/LUFSMeter.tsx) |
| Phase correlation | [PhaseCorrelationDisplay.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/PhaseCorrelationDisplay.tsx) |
| VU meter | [VUMeterCanvas.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/VUMeterCanvas.tsx) |
| Oscilloscope | [Oscilloscope.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/Oscilloscope.tsx) |
| Spectrogram | [Spectrogram.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/Spectrogram.tsx) |
| Spectrum analyzer | [SpectrumAnalyzer.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/SpectrumAnalyzer.tsx) |
| Goniometer | [Goniometer.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/Goniometer.tsx) |
| Compressor GR | [CompressorGainReduction.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/CompressorGainReduction.tsx) |

### Remediation

1. Create an **`AnimationScheduler`** class (singleton) with `register(callback)` / `unregister(callback)` API.
2. The scheduler runs a single `requestAnimationFrame` loop and calls all registered callbacks per frame.
3. Each visual component registers its draw function on mount and unregisters on unmount.
4. The scheduler uses a dirty-flag pattern: callbacks can signal `dirty = true`, and the scheduler only calls dirty callbacks.

---

## 5. No CSS Containment or Compositor Hints (Medium)

**Principle violated:** "`contain: strict` on each major panel... `will-change: transform` for the playhead."

### Current State

**Zero** `contain:`, `content-visibility:`, or `will-change:` CSS properties found anywhere in the codebase. This means:
- Every style/layout change in one panel can trigger recalculation across the entire DOM.
- The playhead (if CSS-animated) gets no compositor layer, causing main-thread paint on every frame.

### Remediation

1. **Add `contain: strict`** to major layout panels: timeline, mixer, track list, bottom dock, inspector.
2. **Add `content-visibility: auto`** to off-screen track rows and inspector sections — can deliver up to 7× paint time reduction.
3. **Add `will-change: transform`** to the playhead element for zero-cost compositor movement.
4. Implementation locations:
   - [TimelineSurface.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Arrangement/presentations/views/TimelineSurface.tsx) container div
   - Track row containers in [TrackListView.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Arrangement/presentations/views/TrackListView.tsx)
   - Panel containers in workspace layout components

---

## 6. No Track List Virtualization (Medium)

**Principle violated:** "TanStack Virtual handles track list virtualization — only rendering visible tracks' DOM/Canvas elements."

### Current State

`@tanstack/react-virtual` is **not installed** and not used anywhere. All tracks render their full DOM regardless of visibility. For projects with 20+ tracks, this means unnecessary DOM nodes, layout calculations, and canvas elements for off-screen content.

### Remediation

1. Install `@tanstack/react-virtual`.
2. Implement `useVirtualizer` in [TrackListView.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Arrangement/presentations/views/TrackListView.tsx) with ~5 track overscan.
3. Audio processing must remain active for all tracks regardless of virtualization (the audio graph runs independently).
4. For horizontal timeline virtualization, implement a second virtualizer instance for clip rendering (only render clips in the visible beat range).

---

## 7. No Waveform Mipmaps (Medium)

**Principle violated:** "Pre-compute min/max peaks at multiple resolutions... pick the closest mip level ≥ requested."

### Current State

[audioBufferCache.ts](file:///Users/josecosta/dev/webdaw/src/modules/AudioEngine/stores/audioBufferCache.ts#L80) computes peaks on-demand with a fixed `numBins` parameter. There is no multi-resolution mipmap precomputation. Each zoom level recomputes peaks from scratch (even though results are cached by key, the initial computation for each zoom level is expensive for long audio files).

### Remediation

1. On audio import, pre-compute peak mipmaps at standard resolutions (256, 512, 1024, 2048, 4096, 8192 samples/pixel) using a Web Worker.
2. Store mipmaps in `audioBufferCache` alongside the AudioBuffer.
3. On zoom, pick the closest mip level ≥ requested resolution — O(1) lookup instead of O(n) peak scan.
4. Only load the visible viewport + 1 viewport of lookahead data for long files.
5. Consider WASM-accelerated peak computation via `audio-waveform-mipmap` pattern.

---

## 8. No SharedArrayBuffer / COOP+COEP Headers (Medium)

**Principle violated:** "SharedArrayBuffer enables zero-copy communication between AudioWorklet and the main thread."

### Current State

- [tauri.conf.json](file:///Users/josecosta/dev/webdaw/src-tauri/tauri.conf.json) has `"csp": null` — **no COOP/COEP headers configured**.
- Zero `SharedArrayBuffer` usage in the codebase.
- AudioWorklet↔main-thread communication uses `postMessage` only.

Without COOP/COEP:
- `SharedArrayBuffer` is unavailable in the browser.
- `performance.measureUserAgentSpecificMemory()` is unavailable.
- `crossOriginIsolated` is `false`.

### Remediation

1. **Configure COOP/COEP headers** in Tauri:
   ```json
   "security": {
     "csp": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'",
       "headers": {
         "Cross-Origin-Opener-Policy": "same-origin",
         "Cross-Origin-Embedder-Policy": "require-corp"
       }
   }
   ```
2. For the web build, configure equivalent headers in the Vite dev server and production hosting.
3. Once enabled, implement `ringbuf.js`-style SPSC ring buffers over SharedArrayBuffer for AudioWorklet↔main-thread meter data.

> [!CAUTION]
> COOP/COEP will break any cross-origin resources loaded without `crossorigin` attribute or CORS headers. Audit all external resource loads first.

---

## 9. No OffscreenCanvas for Heavy Visualization (Low-Medium)

**Principle violated:** "Web Workers with OffscreenCanvas move waveform rendering, FFT analysis, and file decoding entirely off the main thread."

### Current State

All canvas rendering (spectrogram, oscilloscope, spectrum analyzer, goniometer) runs on the **main thread**. With multiple visualizers open simultaneously, this competes with React reconciliation and user input handling for main-thread time.

### Affected Components

| Component | File |
|---|---|
| [Spectrogram.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/Spectrogram.tsx) | FFT + heatmap rendering on main thread |
| [Oscilloscope.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/Oscilloscope.tsx) | Waveform rendering on main thread |
| [SpectrumAnalyzer.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/SpectrumAnalyzer.tsx) | FFT bar rendering on main thread |
| [Goniometer.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Workspace/presentations/components/Goniometer.tsx) | Phase display on main thread |

### Remediation

1. For each heavy visualizer, transfer the canvas to a **Web Worker** via `canvas.transferControlToOffscreen()`.
2. Audio data flows from AudioWorklet → SharedArrayBuffer → Worker → OffscreenCanvas → displayed.
3. Priority order: Spectrogram (most compute-heavy), then Spectrum Analyzer, then Oscilloscope.

---

## 10. IndexedDB for Audio Storage (Low-Medium)

**Principle violated:** "OPFS is 2–4× faster than IndexedDB with synchronous `FileSystemSyncAccessHandle`."

### Current State

[audioBufferCache.ts](file:///Users/josecosta/dev/webdaw/src/modules/AudioEngine/stores/audioBufferCache.ts) uses **IndexedDB** for persisting audio buffers. This works but is suboptimal — serialization overhead, no synchronous access, and lower throughput than OPFS.

### Remediation

1. Migrate audio file storage from IndexedDB to **OPFS** (Origin Private File System).
2. Use `FileSystemSyncAccessHandle` in a Web Worker for byte-level random access.
3. Keep IndexedDB for project metadata and small records.
4. Add a migration path to move existing IndexedDB buffers to OPFS on first load.

---

## 11. Timeline Renderer — Partial Coverage (Low)

### Current State — What's Good ✅

[TimelineSurface.tsx](file:///Users/josecosta/dev/webdaw/src/modules/Arrangement/presentations/views/TimelineSurface.tsx) already follows several best practices:
- Uses a **dedicated rAF loop** with a **dirty-flag pattern** (lines 199–260).
- Has a **WebGPU renderer** with Canvas2D fallback ([createWebGpuRenderer.ts](file:///Users/josecosta/dev/webdaw/src/modules/Arrangement/repositories/createWebGpuRenderer.ts)).
- Reads from stores directly (not React state) inside the render loop.
- Uses `ResizeObserver` for responsive canvas sizing.

### Remaining Gaps

1. **The `buildTimelineRenderModel()` call** (line 256) rebuilds the full render model every frame during playback — should only rebuild when track/clip data actually changes, using separate dirty flags for "data changed" vs "playhead moved."
2. **Auto-scroll** (lines 243–253) calls `timelineViewStore.set()` during the rAF loop, which triggers store subscribers. Should use a ref for scroll position.

---

## 12. Rust Audio Engine — Not Yet Implemented (Architectural)

**Principle:** "All audio processing lives in Rust... the webview is a dumb display."

### Current State

The Rust backend ([lib.rs](file:///Users/josecosta/dev/webdaw/src-tauri/src/lib.rs)) provides IPC commands for:
- LLM/speech (sidecar management)
- File I/O (`read_audio_file`, `write_audio_file`)
- Plugin hosting (CLAP/VST3)
- MIDI device I/O
- Audio IPC bridge (unclear functionality)

**No Rust audio engine exists.** All audio processing runs in JavaScript via the Web Audio API in [createWebAudioEngine.ts](file:///Users/josecosta/dev/webdaw/src/modules/AudioEngine/repositories/createWebAudioEngine.ts). This is fine for the web-only target but misses the native performance target.

### Remediation (Long-term)

This is the largest architectural change and should be phased:

1. **Phase 1:** Create `audio-core` crate with platform-agnostic DSP.
2. **Phase 2:** Implement `audio-native` with `cpal` + `rtrb` lock-free pipeline.
3. **Phase 3:** Implement `audio-wasm` compiling `audio-core` to WASM for AudioWorklet.
4. **Phase 4:** Bridge via Tauri Channels (meter data) and `BackendProvider` pattern.

> [!IMPORTANT]
> This is a multi-month effort. The JavaScript Web Audio engine should remain functional as the fallback/web path.

---

## Priority Matrix

| Priority | Gap | Impact | Effort |
|---|---|---|---|
| 🔴 P0 | §1 Metering in React state | Eliminates N×60 reconciliations/sec | Small |
| 🔴 P0 | §2 Playhead in React store | Eliminates ~100 full-tree re-renders/sec | Small |
| 🟠 P1 | §3 Float32Array allocation per meter call | Eliminates GC pressure in hot path | Trivial |
| 🟠 P1 | §4 Consolidate rAF loops | Reduces rAF overhead, enables dirty-flag optimization | Medium |
| 🟡 P2 | §5 CSS containment | Reduces layout/paint scope | Small |
| 🟡 P2 | §6 Track virtualization | Reduces DOM node count for large projects | Medium |
| 🟡 P2 | §7 Waveform mipmaps | Eliminates zoom lag for long audio | Medium |
| 🟡 P2 | §8 COOP/COEP + SharedArrayBuffer | Enables zero-copy audio↔UI data | Medium |
| 🟢 P3 | §9 OffscreenCanvas visualizers | Moves FFT/rendering off main thread | Large |
| 🟢 P3 | §10 OPFS storage | Faster audio persistence | Medium |
| ⚪ P4 | §11 Timeline render model optimization | Reduces per-frame computation | Small |
| ⚪ P4 | §12 Rust audio engine | Full native performance | Very Large |
