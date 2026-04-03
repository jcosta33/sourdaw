# Automation & Generative Panel Audit Report

Based on a code-level audit of the Automation drawing logic (`src/modules/Automation/useCases/`) and the AI Generative Panel (`src/modules/AiGeneration/useCases/actions/handleGenerateMidiPrompt.ts`), here is the comprehensive audit report:

### 🚨 Critical Performance & Architectural Bugs

1. **The "O(N) CRDT Loop" Freeze (Generative AI)**:
   *   **Issue:** When the AI generates a new MIDI sequence (e.g., in `handleGenerateMidiPrompt.ts`), the code loops through the generated note array and calls `addMidiNote()` individually for every single note:
       ```typescript
       for (const n of finalNotes) {
           addMidiNote(clip.id, n.pitch, n.start_beat, n.duration_beats, n.velocity);
       }
       ```
   *   **Impact:** Because `addMidiNote` directly mutates the global `midiStore`, and because the global store is bound synchronously to the Automerge CRDT document, generating a 128-note melody will trigger **128 separate synchronous CRDT document mutations, JSON serializations, and React Virtual DOM reconciliations in a row.** This will completely lock up the browser and freeze the DAW for several seconds after the AI finishes "thinking."
   *   **Fix:** MIDI generation must use a batch-insertion function (e.g., `batchAddMidiNotes`) that mutates the store exactly *once* with the entire array of new notes.
   > ✅ **FIXED:** Created `src/modules/MIDI/useCases/midiNoteCrud/batchAddMidiNotes.ts` which performs a single `midiStore.set()` with all notes. `handleGenerateMidiPrompt.ts` now calls `batchAddMidiNotes(clip.id, finalNotes.map(...))` instead of the per-note loop.

2. **Missing Undo/Redo Support for Generative AI**:
   *   **Issue:** `handleGenerateMidiPrompt` bypasses the DAW's Command Pattern entirely. It does not wrap the creation of the new clip and the insertion of the notes in a `pushUndoEntry()`.
   *   **Impact:** If the AI generates a pattern the user doesn't like, the user cannot press `Cmd+Z` to undo it. The newly created clip and notes are permanently baked into the project history. The user must manually find the generated clip on the timeline and delete it.
   *   **Fix:** The generation workflow must gather the generated data and dispatch an `AppAction` (or use a `CallbackUndoEntry`) so that the entire generation event can be reverted in a single undo step.
   > ✅ **FIXED:** `handleGenerateMidiPrompt.ts` now snapshots `trackStore` and `midiStore` before and after generation, then registers a `createCallbackUndoEntry` via `pushUndo` so the entire generation (track + clip + notes) can be reverted with Cmd+Z.

3. **Unthrottled Automation Drawing (CRDT Flood)**:
   *   **Issue:** Inside `automationDrawMode.ts`, the `paintDrawPoint` function is called continuously as the user drags the mouse to draw an automation curve. For every pixel the mouse moves, it calls `automationStore.set(...)` to insert a new `AutomationPoint`.
   *   **Impact:** Exactly like the Piano Roll, this triggers an unthrottled, synchronous Automerge CRDT mutation on every `mousemove` event (60-120 times a second). Drawing a simple filter sweep will instantly choke the main thread with JSON serialization overhead, causing UI lag and audio dropouts.
   *   **Fix:** During an active draw session, automation points should only be drawn to an ephemeral canvas layer or local ref. The actual `automationStore` mutation (and CRDT sync) should only occur once in `endDrawSession()` when the user releases the mouse button (`mouseup`).
   > ✅ **FIXED:** `automationDrawMode.ts` now accumulates painted points in `activeSession.pendingState` and schedules a single `requestAnimationFrame` flush per frame instead of calling `automationStore.set()` on every `mousemove`. During a fast drag, the CRDT store is written at most 60 times/second (once per frame) regardless of mouse event rate. `endDrawSession` cancels any pending rAF and flushes the final state synchronously before registering the undo entry.

**Summary:** Both the Automation and Generative AI systems suffer from the same architectural blind spot: they interact with the global, network-synced CRDT stores as if they were cheap, local variables. Looping over individual store mutations or firing them on `mousemove` guarantees severe main-thread lockups in a web-based DAW.
