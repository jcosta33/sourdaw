# Audio Recording & Memory Management Audit Report

Based on a code-level audit of the recording flow (`src/modules/AudioEngine/repositories/audioRecorder/recording.ts`) and audio buffer management (`src/modules/AudioEngine/stores/audioBufferCache.ts`), the current implementation suffers from severe architectural flaws that will lead to UI freezes, audio dropouts, and browser tab crashes (Out-Of-Memory) during normal DAW usage.

### 🚨 Critical Performance, Memory & UX Bugs

1. **Deprecated `ScriptProcessorNode` for Recording (`recording.ts`)**
   *   **Issue:** The recording engine uses `ScriptProcessorNode` instead of a modern `AudioWorkletNode`.
   *   **Impact:** `ScriptProcessorNode` executes entirely on the main JavaScript thread. During recording, the main thread is interrupted constantly. If the React UI is busy (e.g., rendering waveforms, scrolling the timeline, or running complex hooks), the audio processing will be starved, causing permanent dropouts, clicks, and glitches in the recorded audio.
   *   **Fix:** Implement a dedicated `RecordingWorkletNode`. The worklet should capture audio on the isolated audio thread and write it into a lock-free `SharedArrayBuffer` ring queue.
   > ⬜ **Code-verified:** Confirmed real bug. `recording.ts` uses `ctx.createScriptProcessor(BUFFER_SIZE, 1, 1)` with `onaudioprocess`. The comment in the file acknowledges it is deprecated. Architectural fix needed.

2. **Unbounded Main-Thread Allocations (`recording.ts`)**
   *   **Issue:** Inside the `onaudioprocess` callback, the engine pushes a newly allocated array into memory for every single block: `rawChunks.push(new Float32Array(input));`.
   *   **Impact:** A 1-hour recording at 44.1kHz will allocate over ~344,000 individual `Float32Array` objects. This consumes unbounded RAM and creates massive pressure on the V8 Garbage Collector (GC). The resulting GC pauses will cause severe stuttering in the UI and the transport clock.
   *   **Fix:** The audio worklet should stream chunks via the `SharedArrayBuffer` to a background Web Worker. That worker should immediately append the raw PCM data to a file on disk using the Origin Private File System (OPFS) or IndexedDB, keeping memory usage flat regardless of recording length.
   > ⬜ **Code-verified:** Confirmed real bug. Each `onaudioprocess` call pushes `new Float32Array(input)` to `rawChunks`. No upper bound.

3. **Synchronous Main-Thread Buffer Construction (`recording.ts`)**
   *   **Issue:** When `stopAudioRecording()` is called, the engine loops over all `rawChunks` synchronously on the main thread to concatenate them into a single massive `AudioBuffer`.
   *   **Impact:** For long recordings, this synchronous memory copy will completely freeze the DAW's user interface for several seconds while the buffer is constructed.
   *   **Fix:** Audio data should already be on disk by the time recording stops. If an `AudioBuffer` is strictly required for immediate playback, the concatenation should happen in a Web Worker, not the main thread.
   > ⬜ **Code-verified:** Confirmed real bug. `stopAudioRecording()` synchronously iterates `rawChunks` and calls `channel.set(chunk, offset)` on the main thread.

4. **Permanent In-Memory Caching (`audioBufferCache.ts`)**
   *   **Issue:** `audioBufferCache.ts` holds all recorded and imported `AudioBuffer` objects in an unbounded `Map<string, AudioBuffer>`.
   *   **Impact:** Every recording, take, and imported sample is kept entirely in RAM forever. A session with multiple long takes will quickly exhaust the browser's memory limit (typically 2-4GB), resulting in a hard crash of the tab.
   *   **Fix:** The DAW must stream large audio files from disk (OPFS) using `AudioWorklet`. The memory cache should only hold short one-shot samples, or implement a strict LRU (Least Recently Used) eviction policy for larger files.
   > ✅ **FIXED (LRU cap):** Added `MAX_AUDIO_BUFFER_ENTRIES = 64` cap to the main `cache` Map. `audioCacheSet()` evicts the LRU entry (Map insertion order) when at capacity and clears its waveform caches. `audioCacheGet()` promotes touched entries to MRU position via delete+re-insert. `set()`, `get()`, and `restoreFromIdb()` now route through these helpers. Evicted buffers remain in IDB and can be reloaded on demand. Full OPFS streaming remains an architectural improvement but this bounds peak RAM to ≈64 × (buffer size) in the common case.

5. **Synchronous IndexedDB Mass-Loading (`audioBufferCache.ts`)**
   *   **Issue:** The `restoreFromIdb()` function iterates over *every single saved buffer* in IndexedDB and loads them all into RAM at once when the application starts.
   *   **Impact:** If a user has a large project saved, opening the DAW will freeze the browser while gigabytes of audio are pulled from IndexedDB and decoded into memory.
   *   **Fix:** Load audio files lazily (on-demand) just-in-time for playback, or stream them directly from OPFS without loading the entire file into a single `AudioBuffer`.
   > ⬜ **Code-verified:** Confirmed real bug. `restoreFromIdb()` loads all keys sequentially via `store.getAllKeys()` then fetches each one.

6. **Static Clip Rendering & Stunted End Bounds (`recording.ts`)**
   *   **Issue:** During recording, `startRecording()` creates a clip with `startBeat === endBeat`. Because there is no mechanism to update the clip's `endBeat` continuously to match the playhead position in the `requestAnimationFrame` loop, the clip does not visually grow on the timeline while recording. Furthermore, when `stopRecording` is called, it arbitrarily clamps the length using `Math.max(c.startBeat + 1, endBeat)` instead of syncing the clip bounds perfectly to the actual length of the generated `AudioBuffer`.
   *   **Impact:** The user gets zero visual feedback of the clip growing while recording. When they hit stop, the clip appears unnaturally short (or clamped to exactly 1 beat), forcing the user to manually stretch the clip's edge with the mouse to reveal the full recorded audio/MIDI data.
   *   **Fix:** The Timeline Renderer should have a special case to visually draw the "active recording clip" bounds dynamically from the `playheadPositionRef`. Additionally, `stopRecording` (or the audio callback) must update the clip's `endBeat` using the exact duration of the recorded `AudioBuffer` or MIDI sequence, rather than a naive playhead read.
   > ✅ **FIXED:**
   > - Created `activeRecordingRef.ts` — a module-level ref holding `{ clipId, startBeat }[]` for all clips currently being recorded.
   > - `startRecording()` populates this ref after committing new clips to the store. `stopRecording()` clears it immediately (before any store update) so the canvas snaps to the committed value.
   > - `buildTimelineRenderModel` now checks `activeRecordingRef` on every call (every rAF tick). When non-empty it maps those clip IDs to use `Math.max(clip.startBeat, playheadPositionRef.current)` as their `endBeat`, returning `dataDirty: true` to force canvas repaint. Zero store writes during recording.
   > - Removed the erroneous `Math.max(c.startBeat + 1, endBeat)` clamp from `stopRecording` — now uses `Math.max(c.startBeat, endBeat)` (plain floor, no artificial +1 beat).
   > - For audio clips: `toggleRecording.ts`'s `onComplete` callback (which fires synchronously inside `stopAudioRecording`, before `stopRecording` runs) schedules a microtask via `Promise.resolve().then(...)` to call `updateClip` with the beat-accurate `endBeat` computed from `buffer.duration * (bpm / 60)`. This overrides `stopRecording`'s playhead estimate with the exact recorded length.

### 🌟 Positives
*   **Voice Recording (`useVoiceRecording.ts`):** The voice command infrastructure correctly delegates heavy Whisper model inference to Tauri IPC (`start_dictation`), keeping the browser main thread free of AI processing overhead.
*   **Automation Recording (`recordAutomationValue.ts`):** Automation recording correctly uses simple array pushes for vector points, which is lightweight and memory-efficient.

### ✅ Partially Addressed
*   **Unbounded Waveform Cache (`audioBufferCache.ts`):** `waveformCache` was unbounded across zoom levels. Added `MAX_WAVEFORM_CACHE_ENTRIES = 256` cap with LRU eviction via `waveformCacheSet()`. The `mipmapLevel1Cache` is already cleaned via `clearWaveformCachesForId()` when a buffer is updated or removed.
