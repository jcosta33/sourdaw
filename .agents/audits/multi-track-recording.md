---
name: multi-track-recording
description: Audio recording uses a single session — arming multiple tracks only records the last one.
type: audit
status: open
last_verified: '2026-04-20'
---

# Multi-Track Audio Recording

## Scope

The full recording lifecycle: arm → record → stop → clip creation. Covers S-03 and I-29 from the original consolidated audit.

## Goal

Arming N audio tracks and pressing record should capture N independent audio streams, one per track.

## Relevant code paths

- `src/modules/AudioEngine/repositories/audioRecorder/recording.ts` — single `RecordingSession`
- `src/modules/AudioEngine/services/recordingProcessor.ts` — AudioWorklet ring buffer writer
- `src/modules/Transport/useCases/transportControls/toggleRecording.ts` — loops over armed tracks
- `src/modules/Arrangement/useCases/recording/startRecording.ts` — creates clips for armed tracks
- `src/modules/Arrangement/stores/trackStore.ts` — `track.armed` flag

## Current behavior

1. **Arm multiple tracks** — each track's `armed` flag set in `trackStore`.
2. **Press record** — `toggleRecording()` calls `beginActualRecording()`.
3. **`beginActualRecording()`** calls `startRecording()` which creates one clip per armed track (correct).
4. **Loop over armed audio tracks** (`toggleRecording.ts:26`) — for each, calls `startAudioRecording(trackId, onComplete)`.
5. **`startAudioRecording`** (`recording.ts:87-173`) **overwrites** the single global `recordingSession`:
    - Line 105: `recordingSession.mediaStream = await navigator.mediaDevices.getUserMedia(...)`
    - Line 108: `recordingSession.sourceNode = ctx.createMediaStreamSource(...)`
    - Line 114: `recordingSession.onRecordingComplete = onComplete`
    - Line 121: `recordingSession.recordingNode = new AudioWorkletNode(...)`
    - Line 132: `recordingSession.recordingWorker = new Worker(...)`
6. **Each subsequent call replaces the previous session.** Only the last armed track's callback survives (line 114 overwrites).
7. **Stop** — worker posts WAV buffer → only one `onComplete` fires (line 192 clears it after first completion) → only one clip gets audio.

**Result:** All clips are created, but only the last-armed track gets audio. Other tracks' clips remain empty.

## Findings

- `recording.ts:36-63` holds a single `RecordingSession` via `createHmrPersistentState`. There is exactly one `mediaStream`, one `sourceNode`, one `recordingNode`, and one `onRecordingComplete`.
- The `recordingProcessor.ts` worklet writes to a single SAB ring buffer (`_ring` created from one SharedArrayBuffer at init). All connected input gets merged into one mono channel.
- `recording.ts:124` — `channelCount: 1, channelInterpretation: 'discrete'`. Even a single-track stereo recording is downmixed.
- `startRecording.ts:13-93` correctly creates clips for ALL armed tracks. The clip creation is not the problem.
- Recording and track selection (S-02) are genuinely independent — recording depends on the `armed` flag, not `selectedTrackId`.

## Open issues

### 1. Single recording session (S-03)

**Problem:** `recording.ts` global session model. Each `startAudioRecording()` call overwrites the previous.

**Needed:**

1. Replace `recordingSession` with `recordingSessions: Map<string, RecordingSession>`.
2. Each armed track gets its own `MediaStreamSource` → `AudioWorkletNode` → `Worker` → OPFS pipeline.
3. `stopAudioRecording()` stops all sessions; `stopAudioRecording(trackId)` stops one.
4. Each session's `onRecordingComplete` fires independently with its own buffer.
5. Input routing: each track may need its own input device selection (currently all share one mic).

### 2. Mono-only recording (I-29)

**Problem:** `recording.ts:124` — `channelCount: 1, channelInterpretation: 'discrete'`.

**Needed:** Parameterize by track input config (mono/stereo). Allocate SAB ring accordingly. Add a UI toggle for input channel selection per track.

## Risks

- **Browser input limits:** `getUserMedia()` returns a single stereo stream from one input device. Multi-track recording from different physical inputs requires multiple `getUserMedia()` calls or a multi-channel interface API.
- **Performance:** N parallel `AudioWorkletNode` instances + N SAB rings + N workers writing to OPFS simultaneously. Needs benchmarking on target hardware.

## Suggested approaches

1. **Session map:** `Map<trackId, RecordingSession>` in `recording.ts`. Each entry owns its full pipeline. Independent lifecycle.
2. **Shared input, separate sinks:** If all tracks record from the same mic, share one `MediaStreamSource` but create separate `AudioWorkletNode` sinks per track. Each sink writes to its own ring buffer.
3. **Stereo support:** Change `channelCount` to 2 (or track-configurable). Update ring buffer size calculation: `bufferSize * channelCount`.
4. **Ship recording fix before selection refactor.** S-03 is independent of S-02 (multi-track selection). Recording can ship first.

## Recommendation

Start with the session map (item 1). Keep mono for now; stereo is a follow-up (I-29). The recording fix is self-contained in `recording.ts` + `toggleRecording.ts`.
