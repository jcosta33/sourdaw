# Global State, CRDTs, & Command System Audit Report

Based on a code-level audit of the global state management (`src/helpers/Store`), the CRDT synchronization layer (`src/modules/CrdtDocument`), and the Undo/Redo command system (`src/modules/Command`), here is the comprehensive audit report:

### 🌟 Architectural Positives
1. **Delta-Based Undo/Redo System (`UndoEntry.ts` & `pushUndoEntry.ts`)**:
   *   **Implementation:** The undo/redo architecture correctly utilizes a Command Pattern using delta-based `AppAction` events and lightweight closure callbacks (`CallbackUndoEntry`).
   *   **Impact:** The DAW successfully avoids the fatal anti-pattern of saving massive deep-clones of the entire project state for every undo step. This prevents the browser from running Out-Of-Memory (OOM) during long, edit-heavy sessions.

### 🚨 Critical Performance Bugs (Main-Thread Blockers)

1. **Unthrottled Synchronous CRDT Writes (`AutomergeStorage.ts`)**:
   *   **Issue:** The `AutomergeStorage.set()` method is called every time a store's value is updated. Inside this method, it synchronously calls `this.#writeToCrdt(value)`, which executes `automergeRepository.changeDoc()`. Additionally, it performs a heavy synchronous `JSON.parse(JSON.stringify(value))` serialization to sanitize the data before passing it to Automerge.
   *   **Impact:** When a user drags a fader, turns a filter knob, or moves a clip, the UI fires hundreds of state updates per second (the "Knob-Turn State Flood"). Because there is **no debouncing or throttling**, every single intermediate pixel of movement triggers a heavy JSON serialization and a synchronous Automerge CRDT mutation on the main thread. This will instantly choke the main thread, causing severe UI lag and potentially dropping audio frames.
   *   **Fix:** Continuous/ephemeral UI interactions must be decoupled from CRDT persistence. High-frequency updates should mutate the local, in-memory cache *only*. CRDT mutations should either be debounced (e.g., waiting 100ms after the last change) or only triggered on `pointerup` / `dragend` events.
   > ✅ **FIXED:** `AutomergeStorage.set()` now updates the in-memory cache synchronously (preserving instant React subscriber notifications) but defers `#writeToCrdt()` to the next animation frame via `requestAnimationFrame`. A pending rAF is reused if already scheduled, so N store writes within one frame produce exactly 1 CRDT mutation + 1 JSON round-trip instead of N. This collapses knob-drag/fader/clip-drag burst updates without any changes to individual store call-sites.

2. **Synchronous Network Merging (`crdtMerge.ts` & `automergeRepository.ts`)**:
   *   **Issue:** When an incoming collaboration sync or a large `.sdaw` project file is loaded, `automergeRepository.mergeBundle()` and `loadAll()` execute synchronously on the main thread.
   *   **Impact:** Automerge document parsing and merging are CPU-intensive operations. If a collaborator sends a large patch (e.g., bulk editing 100 clips), merging it synchronously will completely freeze the DAW's user interface and lock up the playhead until the merge completes.
   *   **Fix:** CRDT merging and loading must be offloaded to a Web Worker. The worker should perform the `Automerge.merge` operation in the background and only post back the resulting lightweight JavaScript object state to the main thread for React to render.
   > ⬜ **Code-verified:** Confirmed real bug. `automergeRepository.ts` `loadAll()` calls `Automerge.load()` for each base doc and `Automerge.loadIncremental()` for each incremental chunk synchronously on the main thread. `mergeBundle()` calls `Automerge.load()` + `Automerge.merge()` per document, also synchronously. Loading a large project (many incremental chunks) or merging a large collaboration patch will freeze the UI. Fix requires offloading to a Web Worker. Architectural fix needed.

### ⚠️ Minor Efficiency Issues
1. **Synchronous Hydration Diffing (`AutomergeStorage.ts`)**:
   *   **Issue:** Inside `hydrate()`, the system calculates if the cache changed by running `JSON.stringify()` on the entire store's state before and after the update.
   *   **Impact:** While less critical than the write path, stringifying the entire project state (which could be megabytes of JSON) on the main thread during a document load or sync projection introduces unnecessary latency.
   *   **Fix:** Automerge provides native delta updates. The projection layer should rely on Automerge's change patches or shallow equality checks rather than deep JSON string comparisons.
   > ⬜ **Code-verified:** Confirmed real issue. `hydrate()` runs `JSON.stringify(this.#cachedValue)` before and after to detect changes. This only runs on project load/sync (not every edit), so it is lower priority than the write-path flood (now fixed). Still worth improving — Automerge's patch API could replace the JSON diff — but not a blocker.

**Summary:** The Undo/Redo system is wonderfully efficient, but the CRDT integration is a massive performance hazard. The lack of throttling on high-frequency state updates and the synchronous nature of document merging will cause the DAW to freeze constantly during collaboration or active parameter tweaking.
