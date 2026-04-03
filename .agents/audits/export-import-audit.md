# Export & Import Flow Architecture Audit Report

Based on a code-level audit of the audio/MIDI import (`src/modules/MIDI/useCases/importMidiFile.ts`, `src/modules/Arrangement/useCases/importAudioFile.ts`) and audio export flows (`src/modules/Project/presentations/views/ExportDialog.tsx`), here is the comprehensive audit report:

### 🚨 Critical Performance & UX Bugs

1. **Missing Undo/Redo Support for File Imports (`importMidiFile.ts` & `importAudioFile.ts`)**:
   *   **Issue:** Both the MIDI and Audio import functions bypass the DAW's central `AppAction` Command Pattern. They manually construct tracks and clips, then directly mutate the global `trackStore` and `midiStore` via `setTrackState()`.
   *   **Impact:** When a user drags and drops a MIDI or Audio file into the DAW, they cannot press `Cmd+Z` to undo it. The newly created tracks and clips are permanently baked into the project. The user must manually find and delete the imported tracks/clips.
   *   **Fix:** File imports must be wrapped in a `pushUndoEntry()` closure, or preferably mapped to an `AppAction` (e.g., `{ type: 'importMedia' }`) to ensure the entire insertion can be reverted in a single undo step.

2. **O(N) CRDT Flood on Multi-Track MIDI Import (`importMidiFile.ts`)**:
   *   **Issue:** When importing a Type 1 MIDI file containing multiple tracks, the code loops through the parsed tracks and calls `addClip()` for each one, followed by a separate `midiStore.set(...)` mutation.
   *   **Impact:** Because each `addClip` call mutates the global `trackStore`, importing a 16-track MIDI file will trigger 16 synchronous Automerge CRDT serializations and network syncs in a row on the main thread, causing a noticeable UI freeze.
   *   **Fix:** The imported tracks, clips, and MIDI notes must be constructed in memory and applied to the stores in a single, batched mutation.

3. **Synchronous Main-Thread File Parsing (`importMidiFile.ts`)**:
   *   **Issue:** The custom `MidiReader` parser is executed synchronously on the main JavaScript thread via `parseMidiFile(buffer)`.
   *   **Impact:** While small MIDI files parse quickly, dropping a massive, complex MIDI arrangement into the DAW will block the main UI thread during parsing, causing audio dropouts and UI lockups.
   *   **Fix:** File parsing (especially binary decoding) should be offloaded to a background Web Worker.

4. **Synchronous IDB Mass-Loading Blocks Export (`ExportDialog.tsx`)**:
   *   **Issue:** When the user clicks "Start Baking" to export audio, the dialog explicitly calls `await audioBufferCache.restoreFromIdb(ctx)` before beginning the render.
   *   **Impact:** As noted in the memory audit, `restoreFromIdb` pulls *every single saved buffer* from IndexedDB into RAM. If the project contains gigabytes of audio takes, the export process will freeze the browser tab for several seconds (or crash it via OOM) before the rendering even begins.
   *   **Fix:** Audio buffers should be streamed from disk (OPFS) during the offline render process, rather than mass-loading the entire database into memory beforehand.

5. **Main-Thread Audio Encoding Freezes (`ExportDialog.tsx`)**:
   *   **Issue:** After the offline render completes, the `serializeAudio` loop encodes the resulting `AudioBuffer` to WAV/MP3/FLAC. 
   *   **Impact:** If these encoding functions (`encodeWav`, `encodeMp3`) are executing their `Float32Array` iteration loops on the main thread, exporting a 5-minute song will completely freeze the UI. The progress bar will not update smoothly; it will jump and stutter because the rendering/encoding blocks the React render cycle.
   *   **Fix:** The audio encoding step must be offloaded to a Web Worker, allowing the main thread to remain responsive and smoothly animate the export progress bar.

### 🌟 Architectural Positives

1. **Native File System Integration (`ExportDialog.tsx`)**:
   *   **Implementation:** The export dialog excellently handles the split between the Web and Desktop environments. It natively hooks into Tauri's `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs` for desktop builds, while correctly falling back to the Web `showSaveFilePicker` API (or `<a download>` blobs) for browser users.
   *   **Impact:** This ensures a professional, native feeling save/export experience across all platforms.
