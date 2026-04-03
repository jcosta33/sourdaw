# Export & Import Flow Architecture Audit Report

Based on a code-level audit of the audio/MIDI import (`src/modules/MIDI/useCases/importMidiFile.ts`, `src/modules/Arrangement/useCases/importAudioFile.ts`) and audio export flows (`src/modules/Project/presentations/views/ExportDialog.tsx`), here is the comprehensive audit report:

### 🚨 Critical Performance & UX Bugs

1. **Missing Undo/Redo Support for File Imports (`importMidiFile.ts` & `importAudioFile.ts`)**:
    - **Issue:** Both the MIDI and Audio import functions bypass the DAW's central `AppAction` Command Pattern. They manually construct tracks and clips, then directly mutate the global `trackStore` and `midiStore` via `setTrackState()`.
    - **Impact:** When a user drags and drops a MIDI or Audio file into the DAW, they cannot press `Cmd+Z` to undo it. The newly created tracks and clips are permanently baked into the project. The user must manually find and delete the imported tracks/clips.
    - **Fix:** File imports must be wrapped in a `pushUndoEntry()` closure, or preferably mapped to an `AppAction` (e.g., `{ type: 'importMedia' }`) to ensure the entire insertion can be reverted in a single undo step.
        > ✅ **FIXED:** Both `importAudioFile.ts` and `importMidiFile.ts` now snapshot `trackStore.value` (and `midiStore.value` for MIDI) before and after the import, then register a `createCallbackUndoEntry` via `pushUndo`. The entire import (tracks + clips + MIDI notes) can now be reverted with a single Cmd+Z. Additionally, `importAudioFile.ts` had a subtle ordering bug — `addClip` was called before the track was added to the store (so clips were silently lost). Fixed by inserting the track via `setTrackState` first, then calling `addClip`.

2. **O(N) CRDT Flood on Multi-Track MIDI Import (`importMidiFile.ts`)**:
    - **Issue:** When importing a Type 1 MIDI file containing multiple tracks, the code loops through the parsed tracks and calls `addClip()` for each one, followed by a separate `midiStore.set(...)` mutation.
    - **Impact:** Because each `addClip` call mutates the global `trackStore`, importing a 16-track MIDI file will trigger 16 synchronous Automerge CRDT serializations and network syncs in a row on the main thread, causing a noticeable UI freeze.
    - **Fix:** The imported tracks, clips, and MIDI notes must be constructed in memory and applied to the stores in a single, batched mutation.
        > ✅ **FIXED:** `importMidiFile.ts` now builds all tracks and their clips entirely in-memory (using `getNextClipId()` directly and constructing `Clip` objects inline), then commits everything in a single `setTrackState()` call. The `addClip()` loop (which previously called `updateTrack()` → `trackStore.set()` once per imported MIDI track) has been eliminated. Importing a 16-track MIDI file now triggers exactly 1 `trackStore.set()` + 1 `midiStore.set()` instead of 18.

3. **Synchronous Main-Thread File Parsing (`importMidiFile.ts`)**:
    - **Issue:** The custom `MidiReader` parser is executed synchronously on the main JavaScript thread via `parseMidiFile(buffer)`.
    - **Impact:** While small MIDI files parse quickly, dropping a massive, complex MIDI arrangement into the DAW will block the main UI thread during parsing, causing audio dropouts and UI lockups.
    - **Fix:** File parsing (especially binary decoding) should be offloaded to a background Web Worker.
        > ✅ **PARTIALLY FIXED:** `importMidiFile` now yields to the event loop (`await new Promise(r => setTimeout(r, 0))`) before calling `parseMidiFile`, so any pending UI work (e.g. drag-and-drop visual feedback) completes first. The parse itself still runs synchronously on the main thread — a dedicated Web Worker remains the full fix for pathological files, but is deferred until the Worker infrastructure is established.

4. **Synchronous IDB Mass-Loading Blocks Export (`ExportDialog.tsx`)**:
    - **Issue:** When the user clicks "Start Baking" to export audio, the dialog explicitly calls `await audioBufferCache.restoreFromIdb(ctx)` before beginning the render.
    - **Impact:** As noted in the memory audit, `restoreFromIdb` pulls _every single saved buffer_ from IndexedDB into RAM. If the project contains gigabytes of audio takes, the export process will freeze the browser tab for several seconds (or crash it via OOM) before the rendering even begins.
    - **Fix:** Audio buffers should be streamed from disk (OPFS) during the offline render process, rather than mass-loading the entire database into memory beforehand.
        > ✅ **FIXED (scoped load):** `restoreFromIdb` now accepts an optional `ids?: string[]` parameter. `ExportDialog.tsx` collects the `audioBufferId` values of all clips in the current project and passes them as the ID list. Only the buffers actually needed for the render are fetched from IDB — unrelated takes and imported samples from previous sessions are not loaded. Full OPFS streaming remains the architectural end-state but is no longer blocking for typical projects.

5. **Main-Thread Audio Encoding Freezes (`ExportDialog.tsx`)**:
    - **Issue:** After the offline render completes, the `serializeAudio` loop encodes the resulting `AudioBuffer` to WAV/MP3/FLAC.
    - **Impact:** If these encoding functions (`encodeWav`, `encodeMp3`) are executing their `Float32Array` iteration loops on the main thread, exporting a 5-minute song will completely freeze the UI. The progress bar will not update smoothly; it will jump and stutter because the rendering/encoding blocks the React render cycle.
    - **Fix:** The audio encoding step must be offloaded to a Web Worker, allowing the main thread to remain responsive and smoothly animate the export progress bar.
        > ✅ **RE-EVALUATED — less severe than audited.** Both `audioBufferToWav` and `audioBufferToMp3` already yield to the event loop during encoding: WAV encoder yields every 32 768 samples (`await new Promise(r => setTimeout(r, 0))`); MP3 encoder yields every 64 LAME blocks (~73 728 samples). The progress bar can update between yields. The remaining issue is that each chunk can block for ~50–100 ms on a long 24-bit stereo mix — causing stutter within chunks, not a full freeze. A Web Worker or WebCodecs `AudioEncoder` remains the production-grade fix, but the current chunked approach is tolerable for a one-time export path.

### 🌟 Architectural Positives

1. **Native File System Integration (`ExportDialog.tsx`)**:
    - **Implementation:** The export dialog excellently handles the split between the Web and Desktop environments. It natively hooks into Tauri's `@tauri-apps/plugin-dialog` and `@tauri-apps/plugin-fs` for desktop builds, while correctly falling back to the Web `showSaveFilePicker` API (or `<a download>` blobs) for browser users.
    - **Impact:** This ensures a professional, native feeling save/export experience across all platforms.
