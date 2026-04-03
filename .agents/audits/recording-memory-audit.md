# Audio Recording & Memory Management Audit Report

Based on a code-level audit of the recording flow (`src/modules/AudioEngine/repositories/audioRecorder/recording.ts`) and audio buffer management (`src/modules/AudioEngine/stores/audioBufferCache.ts`), the current implementation suffers from severe architectural flaws that will lead to UI freezes, audio dropouts, and browser tab crashes (Out-Of-Memory) during normal DAW usage.

### 🚨 Critical Performance & Memory Bugs

1. **Deprecated `ScriptProcessorNode` for Recording (`recording.ts`)**
   *   **Issue:** The recording engine uses `ScriptProcessorNode` instead of a modern `AudioWorkletNode`.
   *   **Impact:** `ScriptProcessorNode` executes entirely on the main JavaScript thread. During recording, the main thread is interrupted constantly. If the React UI is busy (e.g., rendering waveforms, scrolling the timeline, or running complex hooks), the audio processing will be starved, causing permanent dropouts, clicks, and glitches in the recorded audio.
   *   **Fix:** Implement a dedicated `RecordingWorkletNode`. The worklet should capture audio on the isolated audio thread and write it into a lock-free `SharedArrayBuffer` ring queue.

2. **Unbounded Main-Thread Allocations (`recording.ts`)**
   *   **Issue:** Inside the `onaudioprocess` callback, the engine pushes a newly allocated array into memory for every single block: `rawChunks.push(new Float32Array(input));`.
   *   **Impact:** A 1-hour recording at 44.1kHz will allocate over ~344,000 individual `Float32Array` objects. This consumes unbounded RAM and creates massive pressure on the V8 Garbage Collector (GC). The resulting GC pauses will cause severe stuttering in the UI and the transport clock.
   *   **Fix:** The audio worklet should stream chunks via the `SharedArrayBuffer` to a background Web Worker. That worker should immediately append the raw PCM data to a file on disk using the Origin Private File System (OPFS) or IndexedDB, keeping memory usage flat regardless of recording length.

3. **Synchronous Main-Thread Buffer Construction (`recording.ts`)**
   *   **Issue:** When `stopAudioRecording()` is called, the engine loops over all `rawChunks` synchronously on the main thread to concatenate them into a single massive `AudioBuffer`.
   *   **Impact:** For long recordings, this synchronous memory copy will completely freeze the DAW's user interface for several seconds while the buffer is constructed.
   *   **Fix:** Audio data should already be on disk by the time recording stops. If an `AudioBuffer` is strictly required for immediate playback, the concatenation should happen in a Web Worker, not the main thread.

4. **Permanent In-Memory Caching (`audioBufferCache.ts`)**
   *   **Issue:** `audioBufferCache.ts` holds all recorded and imported `AudioBuffer` objects in an unbounded `Map<string, AudioBuffer>`.
   *   **Impact:** Every recording, take, and imported sample is kept entirely in RAM forever. A session with multiple long takes will quickly exhaust the browser's memory limit (typically 2-4GB), resulting in a hard crash of the tab.
   *   **Fix:** The DAW must stream large audio files from disk (OPFS) using `AudioWorklet`. The memory cache should only hold short one-shot samples, or implement a strict LRU (Least Recently Used) eviction policy for larger files.

5. **Synchronous IndexedDB Mass-Loading (`audioBufferCache.ts`)**
   *   **Issue:** The `restoreFromIdb()` function iterates over *every single saved buffer* in IndexedDB and loads them all into RAM at once when the application starts.
   *   **Impact:** If a user has a large project saved, opening the DAW will freeze the browser while gigabytes of audio are pulled from IndexedDB and decoded into memory.
   *   **Fix:** Load audio files lazily (on-demand) just-in-time for playback, or stream them directly from OPFS without loading the entire file into a single `AudioBuffer`.

### 🌟 Positives
*   **Voice Recording (`useVoiceRecording.ts`):** The voice command infrastructure correctly delegates heavy Whisper model inference to Tauri IPC (`start_dictation`), keeping the browser main thread free of AI processing overhead.
*   **Automation Recording (`recordAutomationValue.ts`):** Automation recording correctly uses simple array pushes for vector points, which is lightweight and memory-efficient.