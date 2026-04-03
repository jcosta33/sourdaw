# AI Runtime & LLM Action Bridge Audit Report

Based on a code-level audit of the AI Runtime (`src/modules/AiRuntime/`), the LLM inference wrappers, and the DSO (Domain-Specific Operations) Action Bridge, here is the comprehensive audit report:

### 🌟 Architectural Positives

1. **Off-Main-Thread LLM Inference (`llmWorker.ts` & `nativeEngine`)**:
   *   **Implementation:** The browser-based WebLLM engine is correctly instantiated inside a dedicated Web Worker (`WebWorkerMLCEngineHandler`). The native desktop engine (Tauri/mistral.rs) executes in a separate Rust process and streams tokens back via an asynchronous IPC channel.
   *   **Impact:** This ensures that heavy matrix multiplications and AI model inference completely bypass the JavaScript main thread. Audio scheduling and UI rendering will not drop frames or freeze while the LLM is "thinking."

2. **Schema-Constrained Generation (`executeDsoEdit.ts`)**:
   *   **Implementation:** When the AI is asked to edit the DAW (the DSO editor), it does not rely on fragile string parsing. It strictly enforces a JSON Schema via WebLLM's `response_format` or mistral.rs's grammar-constrained generator.
   *   **Impact:** This guarantees that the LLM emits strongly-typed operational intents (e.g., `add_track`, `set_track_volume`) that the DAW can safely parse without crashing due to hallucinations.

### 🚨 Critical Performance & Architecture Bugs

1. **Catastrophic Memory Leaks in AI Undo System (`executeDsoEdit.ts`)**:
   *   **Issue:** To provide Undo/Redo support for AI edits, the `commitDsos` function takes a complete, deep snapshot of the entire project state *before* and *after* the AI executes its actions:
       ```typescript
       const trackSnapshot = structuredClone(trackStore.value);
       const transportSnapshot = structuredClone(transportStore.value);
       // ... execute AI changes ...
       const trackAfter = structuredClone(trackStore.value);
       ```
       These massive clones are then saved forever inside the closure of a `CallbackUndoEntry`.
   *   **Impact:** While the rest of the DAW uses lightweight, delta-based `AppAction` events for Undo/Redo to save memory, the AI bridge does the exact opposite. Every time the AI performs an action, it duplicates the entire project state into RAM. In a large project with thousands of clips and notes, using the AI just 5 or 10 times will rapidly exhaust the browser's memory and cause a hard crash (Out-Of-Memory).
   *   **Fix:** The DSO Compiler (`compileDso.ts`) must stop directly mutating `trackStore.set(...)` and taking global snapshots. Instead, it must map the LLM's `Dso` intents to standard, delta-based `AppAction` objects (e.g., `{ type: 'addTrack' }`) and dispatch them through `executeAppAction()`. This will piggyback on the DAW's existing, memory-safe command infrastructure.

2. **Bypassing the Central Command Registry (`compileDso.ts`)**:
   *   **Issue:** `compileDso.ts` executes changes by directly calling raw store mutations (e.g., `trackStore.set(...)` or `addClip(...)`). 
   *   **Impact:** By bypassing the central `executeAppAction` pipeline, AI actions fail to trigger standard side-effects (like notifying external control surfaces, triggering visual flashes, or routing through standard validation). 
   *   **Fix:** As stated above, all AI intents must be translated into `AppAction` payloads and routed through `executeAppAction`. The LLM should not be given direct, unmediated write access to the global CRDT stores.

**Summary:** The AI inference layer is beautifully isolated from the main thread, ensuring smooth audio performance. However, the mechanism used to translate AI decisions into DAW state changes is critically flawed. The AI bridge relies on massive global memory snapshots for Undo/Redo, which will inevitably crash the application on larger projects.
