# Audit: Chrome web app — bleeding-edge performance with legacy fallbacks

## Scope

**In scope:** The **web application** run in **Google Chrome** (Vite dev server, static deploy, or Chromium used for development). Identify and prioritize **additive** uses of stable and emerging **Chromium** web APIs so Chrome gets a no-compromise performance profile **without** requiring identical behavior in other browsers.

**Explicitly out of scope for this initiative:**

- **Tauri / native desktop shells** (macOS, Windows, Linux). Do **not** optimize WebView2, WKWebView, or WebKitGTK as part of this track. The product may later use **Rust-based or host-specific** solutions for native builds instead of porting every web fast path 1:1.
- **IPC-heavy native paths** — e.g. sample bridges, native decode — except where the **same TypeScript entry point** must stay dual-path safe (preserve behavior when `isTauri()` is true without redesigning native in this task).
- Cross-browser **parity of performance** — only **functional** fallback is required outside Chrome.
- Plugin hosting, CI/build script edits, unless a dedicated task says otherwise.

**Authoritative docs & skills (read before implementation):**

- `docs/architecture/01-system.md` — runtime boundaries, presentation vs engine, write/read model.
- `docs/architecture/03-typescript-module.md` — module boundaries, `repositories/` / `useCases/` / `services/` / contract barrels; cross-module import rules.
- `docs/architecture/02-rust-backend.md` — when logic belongs in Rust vs TS (native deferred here, but boundaries matter for WASM/DSP).
- `AGENTS.md` — contract surfaces, no deep imports, React Compiler (no manual memo), audio RT safety (no allocation on audio thread).
- `.agents/skills/bleeding-edge-primitives/SKILL.md` — `Float16Array`, `Atomics`, SAB patterns.
- `.agents/skills/web-audio-engine/SKILL.md` — AudioWorklet, graph, scheduling.
- `.agents/skills/ui-patterns/SKILL.md` — dense UI, accessibility, popovers / top layer.

Prefer **not** to hinge this initiative on `.agents/skills/tauri-platform/SKILL.md` unless shared files force a touch — **browser-first**.

---

## Goal

Deliver **maximum** client-side performance in **Chrome** (main-thread headroom, storage latency, metering throughput, input quality) using **bleeding-edge APIs** where justified.

**Simultaneously:** keep today’s implementation paths as **legacy fallbacks** for non-Chrome browsers and for environments where feature detection fails (no OPFS, no `crossOriginIsolated`, no OffscreenCanvas, etc.).

Architecturally, new logic must fit **`docs/architecture`** module rules: **I/O in repositories**, orchestration in **useCases**, pure helpers in **services** where appropriate, UI only in **presentations** — **not** ad-hoc `if` trees across every view (see **Dual-path model**).

---

## Dual-path model (non-negotiable)

Use **feature detection + centralized strategy selection**, not User-Agent sniffing unless unavoidable.

| Concern                           | Legacy path (retain; do not delete)                                    | Chrome-first path (add; gate)                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Heavy 2D / visualization          | Main-thread Canvas 2D + `requestAnimationFrame`                        | OffscreenCanvas in a Worker; optional **WebGPU compute** in a worker (never inside `AudioWorkletProcessor.process`) |
| Large PCM / waveform cache        | **IndexedDB** in `audioBufferCache.ts` (`sourdaw-audio`)               | **OPFS** via `navigator.storage.getDirectory()`; sync access handles **only** in workers per spec                   |
| Long tasks / offline render yield | `setTimeout(…, 0)` in `yieldToMain.ts`                                 | `globalThis.scheduler?.yield?.()` with identical observable scheduling semantics modulo priority                    |
| Decode pipeline (**web** branch)  | `AudioContext.decodeAudioData` (full buffer) + symphonia WASM fallback | Optional **WebCodecs** / chunked pipeline **only** with the same external contract (`AudioBuffer` + id)             |
| Metering / visualization reads    | `AnalyserNode` polling on main thread                                  | Shared **SAB** + worklet ring / telemetry where `crossOriginIsolated` and `SharedArrayBuffer` exist                 |
| Undo persistence                  | `sessionStorage` JSON in `undoStore.ts` (coalesced writes)             | Optional OPFS or worker-streamed snapshots — **additive**; must not drop legacy session restore                     |

**Rules**

1. Ship **both** paths until product explicitly removes legacy; default new PRs to **add** Chrome path, **not** replace.
2. **One funnel per concern** — e.g. a single repository helper chooses OPFS vs IDB so `presentations/` does not duplicate storage policy.
3. **Same domain types in/out** — only the adapter layer changes; no parallel type systems per browser.
4. **Tests** — existing specs cover legacy; add tests/mocks for gated branches where reasonable.

---

## Relevant code paths

| Area                                            | Paths                                                                                                                                                                                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Master / mixer spectrum UI                      | `src/modules/Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx`                                                                                                                                               |
| Device spectrum (duplicates)                    | `src/modules/Bacteria/presentations/components/SpectrumAnalyzer.tsx`, `src/modules/Fermenter/presentations/components/SpectrumAnalyzer.tsx`                                                                             |
| Timeline & waveforms                            | `src/modules/Arrangement/presentations/views/TimelineSurface.tsx`, `src/modules/Crust/presentations/components/CrustWaveformDisplay.tsx`                                                                                |
| Per-track peak meter                            | `src/modules/Arrangement/presentations/views/TrackHeader/TrackLevelIndicator.tsx`                                                                                                                                       |
| Arrangement / mixer chrome for view transitions | `src/modules/Arrangement/presentations/views/ArrangementBar.tsx`, `src/modules/Workspace/presentations/views/MixerPanel.tsx`                                                                                            |
| Context / timeline menus                        | `src/modules/Arrangement/presentations/views/ClipContextMenu.tsx`, `TimelineEmptyMenu.tsx`; shared menu primitives `#/components/daw/DawMenuParts` (**`DawMenuButton` lives here**, not a standalone file)              |
| Automation drawing                              | `src/modules/Automation/useCases/automationDrawMode.ts` (camelCase; not `AutomationDrawMode.ts`)                                                                                                                        |
| Main-thread knobs / faders                      | Search under `Workspace` / shared components for `RotaryKnob`, `Fader` (pattern: pointer-driven controls)                                                                                                               |
| Audio buffer cache                              | `src/modules/AudioEngine/stores/audioBufferCache.ts`                                                                                                                                                                    |
| Undo                                            | `src/modules/Command/stores/undoStore.ts`                                                                                                                                                                               |
| Bacteria WASM worklet                           | `src/modules/AudioEngine/services/bacteriaProcessor.ts` (processor name `bacteria-processor`) — not `BacteriaProcessor.ts`                                                                                              |
| Engine & analysers                              | `src/modules/AudioEngine/repositories/createWebAudioEngine.ts`                                                                                                                                                          |
| **Web** decode                                  | `src/modules/AudioEngine/useCases/decodeAudioFile.ts` — browser branches only for this audit’s fast-path work                                                                                                           |
| Tauri-only decode / IPC                         | `repositories/audioDecoding/tauriDecoding/`, `src/modules/Sampler/repositories/samplerBridge.ts` — **native latency concerns; not the optimization target**                                                             |
| Offline render                                  | `src/modules/AudioEngine/useCases/offlineRender/yieldToMain.ts`                                                                                                                                                         |
| MIDI surface                                    | `src/modules/AudioEngine/repositories/webMidi/`                                                                                                                                                                         |
| Collaboration                                   | `src/modules/Collaboration/repositories/peerConnection.ts` (**WebRTC** data channels), `src/modules/Collaboration/useCases/collaboration/sessionManagement.ts` (**CompressionStream** already used for invite payloads) |
| Project save entry                              | `src/modules/Project/useCases/projectPersistence/saveProject/saveProject.ts` (CRDT persistence — not the same as “ZIP in saveProject”)                                                                                  |
| Cross-origin isolation (**web**)                | `vite.config.ts` `server.headers` and `preview.headers`                                                                                                                                                                 |
| WASM / DSP sources                              | `crates/daw-dsp/` (e.g. `bacteria/stft.rs`, `convolution.rs`, `spectral.rs`), `crates/scoring/`                                                                                                                         |

---

## Current behavior

### Main-thread UI and canvas

- **Spectrum analyzers:** At least **three** components render FFT data with **Canvas 2D** and **`requestAnimationFrame`** on the main thread (`Workspace/.../SpectrumAnalyzer.tsx` is the primary metering UX; Bacteria and Fermenter duplicate the pattern). Data comes from `getMasterAnalyser` / `getTrackAnalyser` (`#/modules/AudioEngine/useCases`).
- **Timeline:** `TimelineSurface.tsx` — dense arrangement drawing (clips, grid, interaction) on the main thread.
- **Waveforms:** `CrustWaveformDisplay.tsx` — canvas-driven waveform rendering.
- **Track meters:** `TrackLevelIndicator.tsx` — **per-instance** rAF loop, Canvas 2D, `AnalyserNode` time-domain reads; code intentionally avoids React state churn and reuses a `Float32Array` when FFT size is stable.

### Storage and undo

- **`audioBufferCache.ts`:** In-process **LRU** `Map` (`MAX_AUDIO_BUFFER_ENTRIES`); **IndexedDB** (`sourdaw-audio`, versioned store `buffers`) persists serialized `Float32Array` channel data via `persistToIdb` / `restoreFromIdb`. Separate in-memory waveform peak maps with LRU eviction.
- **`undoStore.ts`:** Loads/saves **`sessionStorage`** key `sourdaw-undo-session`; **microtask-coalesced** writes after subscribe (avoids hundreds of JSON writes per second on rapid batches). Trims to **`MAX_UNDO_PERSIST`** serialized action entries.

### DSP and engine (web-relevant)

- **`bacteriaProcessor.ts`:** **AudioWorklet** loads WASM (`daw_dsp`) via `initSync`; DSP including **spectral / STFT / convolution** runs in **Rust** (`crates/daw-dsp/src/bacteria/…`) inside the **audio render quantum** — same thread budget as mixing. Optional **`SharedArrayBuffer` telemetry** via `init-sab`: levels, latency, band peaks blit into a `Float32Array` view when configured — **partial “metering hub” already present** for Bacteria.
- **`createWebAudioEngine.ts`:** **`AnalyserNode`** on master (and per-track strips) — visualization paths often **poll** `getByteTimeDomainData` / frequency data from the **main thread**.
- **`decodeAudioFile.ts`:** **`isTauri()`** path writes temp files and uses native decode — **out of scope** for Chrome web optimization. **Browser path:** `decodeAudioData` over full buffer, then WASM fallback — this is the **legacy web** path to preserve; Chrome-first streaming/WebCodecs is **additive**.

### Scheduling

- **`yieldToMain.ts`:** Currently **`new Promise((resolve) => setTimeout(resolve, 0))`** — **not** `scheduler.yield()`; Chrome path can wrap `scheduler.yield` when available.

### Collaboration

- **`peerConnection.ts`:** **WebRTC** (`RTCPeerConnection`, RTCDataChannels) — **not** WebTransport.
- **`sessionManagement.ts`:** **`CompressionStream` / `DecompressionStream`** (`deflate-raw`) for **compressed invites** — Compression Streams are **already in use** here; widening use (e.g. exports) must follow the same **dual-path** discipline.

### Cross-origin isolation (SharedArrayBuffer / advanced APIs)

- **`vite.config.ts`** serves **`Cross-Origin-Opener-Policy: same-origin`** and **`Cross-Origin-Embedder-Policy: require-corp`** for **dev `server`** and **`preview`** — **both** are required for typical **cross-origin isolation** (`crossOriginIsolated`), not COOP alone.
- **Production web** hosting must repeat these headers if SAB-based features are relied upon in Chrome. **`src-tauri/tauri.conf.json`** also sets COOP/COEP for the **native shell** — **do not change** for this browser-first initiative unless a separate task requires it; focus **web** header story for static deploys.

---

## Findings

1. **Strategic split:** This initiative targets **Chrome + web**; **native** is explicitly **not** the optimization surface — Rust/host work may supersede duplicate effort there later.

2. **Dual-path is contractual:** Removing IndexedDB-only code or main-thread-only rendering **without** fallback violates scope; Chrome wins must be **additive**.

3. **“Metering hub” is half-built:** Bacteria exposes **SAB** telemetry from the worklet; **Workspace** spectrum and **track** meters still **poll analysers** on the main thread — convergence should go through **narrow repository/engine APIs**, not scattered refactors.

4. **Three `SpectrumAnalyzer` forks** triple the cost of Offscreen/WebGPU migration — extract a **shared internal core** per `docs/architecture/03-typescript-module.md` (module-local `services/` or shared worker protocol **inside** the owning module) before copying worker code three ways.

5. **WebTransport ≠ drop-in:** Sync today is **Automerge over WebRTC** data channels. Replacing with **WebTransport** implies signaling, firewall, and server topology — **spec + infra**, not a frontend-only swap.

6. **OPFS design constraint:** `FileSystemSyncAccessHandle` is **worker-scoped** in Chromium — hot paths belong in **workers + repositories**, not React effects on the main thread.

7. **Standards snapshot (Chromium-oriented; always feature-detect):**
    - **`scheduler.yield()`** — available in current Chromium generations (e.g. Chrome 129+ range); **legacy** remains `setTimeout`.
    - **`Float16Array`** — shipping in contemporary Chrome; **legacy** keeps `Float32Array` storage until a deliberate memory initiative.
    - **View Transitions / Popover / pointer coalescing** — adopt behind `document.startViewTransition`, `popover`, and Pointer Events APIs with fallbacks.

8. **WASM SIMD** — not evidenced in repo-wide `simd128` toggles today; **optional** second WASM artifact for Chrome-capable clients, selected in **repositories**, aligns with architecture.

---

## Priorities (ordered)

1. **Rendering offload (Chrome)** — OffscreenCanvas + worker for spectrum / timeline / meter draws; **legacy** main-thread canvas when APIs unavailable.
2. **Storage (Chrome)** — OPFS alongside IndexedDB in **`audioBufferCache`** via repository-level dual path.
3. **Metering (Chrome)** — extend **SAB / worklet** patterns from `bacteriaProcessor` toward shared engine metering where isolation allows; **legacy** `AnalyserNode` polling otherwise.
4. **Input (Chrome)** — coalesced / predicted pointer events for automation and controls; **legacy** current handlers.
5. **Collaboration transport** — **WebTransport** only after product/network spec; **do not** replace `peerConnection` casually.

---

## Phased action list (Chrome-first; legacy preserved each phase)

### Phase 1 — Rendering leap [critical]

1. Migrate **`Workspace/.../Metering/SpectrumAnalyzer.tsx`** to an OffscreenCanvas worker (`transferControlToOffscreen`), with **automatic fallback** to current main-thread drawing.
2. Optionally add **WebGPU** compute **in the worker** for FFT→heatmap (not in AudioWorklet `process()`).

### Phase 2 — Storage leap [high]

1. Add **OPFS** read/write beside IndexedDB in **`audioBufferCache.ts`** — migrate or shadow-read before trusting OPFS exclusively.
2. Consider **worker + OPFS** for large undo snapshots later — **sessionStorage** path remains until explicitly removed.

### Phase 3 — Input & motion [medium]

1. **Predicted / coalesced** pointer handling in **`automationDrawMode.ts`** and primary knobs/faders where it removes stair-stepping.
2. **View Transitions** for **`ArrangementBar`** / **`MixerPanel`** toggles where state changes are bounded (`document.startViewTransition` with feature detect).

---

## Open issues

### 1. Stale filenames in older notes

Historical references to `BacteriaProcessor.ts`, `AutomationDrawMode.ts`, `Collaboration/.../transport.ts`, or flat `Project/useCases/saveProject.ts` were **wrong**. Use paths in **Relevant code paths** above.

### 2. Centralize dual-path policy

**Problem:** Scattershot detection breaks `docs/architecture` boundaries.

**Needed:** Repository-level **adapters** (storage, decode bootstrap, canvas strategy) invoked from **useCases** or a single hook — not per-component duplication.

### 3. COOP + COEP documentation for **web** production

**Problem:** `SharedArrayBuffer` features require **cross-origin isolation**; Vite dev is configured; **static hosts** must mirror headers.

**Needed:** Record hosting requirements in task/spec; **legacy path** when `!crossOriginIsolated`.

### 4. Scheduler gap

**Problem:** `yieldToMain.ts` uses **`setTimeout(0)`** only.

**Needed:** Add `scheduler.yield` **behind detection** with equivalent fallback; benchmark offline export long tasks.

### 5. Triple SpectrumAnalyzer

**Needed:** Shared FFT → draw or worker protocol before duplicating Phase 1 three times.

### 6. Minimum Chrome / deployment

**Needed:** Product sets **minimum Chrome** for marketing vs implementation; implementers still **feature-detect** per API.

---

## Open questions

1. **Static web host** — can production set **COOP + COEP** like Vite? If not, SAB features must stay off or use a different deployment path.
2. **WebCodecs** — acceptable complexity vs `decodeAudioData` for long imports? Needs a **spec** if pursued.
3. **Window Management API** — relevant only for **multi-window web** Chrome experiments; **not** tied to native windowing in this initiative.

---

## Risks

- **Deleting legacy paths** breaks Firefox/Safari — blocked without explicit product sign-off.
- **WebGPU** misuse inside **audio callback** threads — forbidden; keep GPU on workers / main UI thread.
- **OPFS** data corruption during migration — prefer shadow reads / dual-write phases.
- **WebTransport** — breaks more than transport (signaling, TURN/STUN assumptions).
- **`pnpm deps:validate`** regressions if contract boundaries are ignored during refactors.

---

## Suggested approaches

- **Rendering:** Worker bundle pattern aligned with existing **`vite.config.ts` `worker.format: 'iife'`** for AudioWorklet compatibility — reuse discipline for visualization workers.
- **Metering:** Grow **SAB** rings from **`createWebAudioEngine`** / track strips only with RT-safe guarantees; see **`GrandBouleNode.ts`** and COOP messaging patterns for prior art.
- **SIMD:** Optional **simd128** WASM build for Chrome; generic wasm for legacy — selection in **repositories**, not views.
- **UI primitives:** **Popover** for menus currently built with Radix/stacking workarounds (`ClipContextMenu`, `TimelineEmptyMenu`, `DawMenuParts`).

All approaches must obey **`docs/architecture/03-typescript-module.md`**: **no `export type` from `useCases/`** to other modules; duplicate narrow consumer types where needed.

---

## Recommendation

**Start with Phase 1, item 1:** **`Workspace/presentations/views/Metering/SpectrumAnalyzer.tsx`** — most visible, most isolated, clear **legacy fallback**.

**Second:** **Dual-path OPFS + IndexedDB** in **`audioBufferCache.ts`**.

Do **not** begin **WebTransport** without a Collaboration **spec** and networking approval.

---

## Verification strategy

| Concern          | Method                                                   | Chrome target                           | Legacy check                          |
| ---------------- | -------------------------------------------------------- | --------------------------------------- | ------------------------------------- |
| Main-thread cost | Chrome DevTools Performance — long tasks during playback | ↓ vs baseline on fast path              | Firefox/Safari smoke: no regressions  |
| Input            | Pointer coalescing / prediction in automation            | Smoother strokes                        | Same tools usable without new APIs    |
| Memory           | Heap snapshots if **`Float16Array`** storage lands       | Measurable savings where adopted        | Float32 path still works              |
| Cache I/O        | Benchmark OPFS vs IDB for large buffer restore           | p50/p95 improvement when gated          | IDB-only browsers unchanged           |
| Isolation        | `crossOriginIsolated` in Chrome when testing SAB         | `true` in dev with current Vite headers | If `false`, only legacy metering path |
| Architecture     | **`pnpm deps:validate`**                                 | Zero violations after refactors         | Same                                  |

---

## Resolved

- _(none — fill when phases complete.)_

---

## Appendix A — Technical opportunity matrix (Chrome web: add + gate; legacy remains)

### A. Rendering & UI

| API                              | Implementation targets                                                                         | Impact (Chrome)                             | Gate / fallback                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| **OffscreenCanvas + workers**    | `SpectrumAnalyzer` (3 sites), `TimelineSurface`, `TrackLevelIndicator`, `CrustWaveformDisplay` | Decouple heavy draws from React/main thread | `OffscreenCanvas` + worker bootstrap; else legacy canvas |
| **WebGPU compute**               | Spectrum heatmap / heavy non-audio math                                                        | Parallel spectral / visualization           | `navigator.gpu`; worker only; legacy CPU path            |
| **View Transitions API**         | `ArrangementBar`, `MixerPanel`                                                                 | Smooth layout animations                    | `document.startViewTransition`                           |
| **Popover API**                  | `ClipContextMenu`, `TimelineEmptyMenu`, `DawMenuParts`                                         | Top-layer without z-index fights            | Feature detect; Radix fallback                           |
| **Coalesced / predicted events** | `RotaryKnob`, `Fader`, `automationDrawMode.ts`                                                 | Higher-rate automation drawing              | Pointer Events; legacy single events                     |
| **Window Management API**        | Multi-window **web** experiments only                                                          | Secondary metering/mixer windows in Chrome  | Permission-gated; **not** native Tauri windowing         |

### B. Audio & DSP (web)

| API                         | Targets                                           | Notes                                                                                     |
| --------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Worklet + SAB telemetry** | `createWebAudioEngine.ts`, `bacteriaProcessor.ts` | Replace heavy `AnalyserNode` polling where isolation allows; **legacy** polling if no SAB |
| **WASM SIMD (`simd128`)**   | `crates/daw-dsp`, `crates/scoring`                | Optional second binary for Chrome; **legacy** non-SIMD wasm                               |
| **WebCodecs**               | `decodeAudioFile.ts` **browser** branch           | Streaming / chunked decode — **additive**; full-buffer path stays legacy                  |
| **Float16Array**            | In-memory sample storage where precision allows   | ~half RAM; must preserve quality gates; **legacy** Float32                                |

### C. Data & system

| API                     | Targets                                    | Notes                                                                            |
| ----------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| **OPFS**                | `audioBufferCache.ts`, future undo buffers | Fast binary I/O in Chrome; **IndexedDB** remains legacy                          |
| **`scheduler.yield()`** | `yieldToMain.ts`                           | Finer scheduling than `setTimeout`; **fallback** unchanged                       |
| **Compression Streams** | Broader than invites                       | `sessionManagement` already uses deflate — any expansion follows dual-path rules |
| **WebTransport**        | Would parallel **`peerConnection.ts`**     | **Future**; requires infra spec                                                  |

---

## Verification notes (2026-04-14)

### Pass 1 — dual-path spot-check

| Item | Result |
|------|--------|
| **`scheduler.yield` in app** | **Not found** — `rg 'scheduler\\?\\.yield'` over `src/` returns **no** matches. Offline yield is still `setTimeout(..., 0)` in `AudioEngine/useCases/offlineRender/yieldToMain.ts`. Chrome-first row in **Dual-path model** for long tasks is **not yet implemented** as written. |
| **OPFS / IndexedDB / SAB** | **Not re-benchmarked** — architecture audit only; performance work remains per **Phased action list**. |

## Handoff checklist for the implementing agent

1. **Scope:** You are delivering **Chrome web** wins with **legacy fallbacks**; **do not** scope-creep into native/Tauri except to **preserve** existing branches untouched.
2. **Read** **`docs/architecture`** (`01-system`, `03-typescript-module`, `02-rust-backend` as needed) **`AGENTS.md`**, and the skills listed under **Scope**.
3. **Dual-path:** Feature-detect; centralize **repositories/useCases**; **no** deletion of legacy paths in v1.
4. **Isolation:** For SAB/WebGPU workers, confirm **`crossOriginIsolated`** in Chrome dev; document production **COOP+COEP** hosting.
5. Run **`pnpm deps:validate`** and **`pnpm typecheck`** after substantive edits.
6. Non-trivial features → **`.agents/specs/`** with acceptance criteria; this file stays an **audit**, not a substitute spec.
