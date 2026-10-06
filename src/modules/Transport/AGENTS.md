# Transport module — Agent Guidelines

Playback lifecycle and control (play, stop, seek, record, overdub), playhead positioning & high-frequency scheduler, tempo maps and ramps, time signature maps, metronome, loop/punch regions, master gain headroom, and PPQ/sample position projections; does not own the WebAudio graph (AudioEngine) or arrangement track/clip items (Arrangement).

## Public Contract Surface

- `useCases`:
    - **Playback & Transport Controls**: `setPlayback`, `stopPlayback`, `togglePlayback`, `seekPlayhead`, `panicAllNotes`, `toggleRecording`, `toggleOverdub`, `setLoopRegion`, `toggleLoop`, `disableLooping`, `toggleMetronome`, `setMetronomeVolume`, `setCountInBars`, `toggleCountIn`, `setPreRollBars`, `togglePreRoll`, `setPunchIn`, `setPunchOut`, `togglePunchEnabled`, `createPunchRegionPatch`.
    - **Tempo & Time Signature Mapping**: `setTempo`, `setTimeSignature`, `addTempoChange`, `removeTempoChange`, `updateTempoChange`, `replaceTempoMap`, `resolveTempoAtBeat`, `shiftTimelineMapsAfterBeat`, `deleteTimelineMapsTimeRange`, `prepareTimelineMapStateRestore`, `prepareTimelineMapTimeOperation`, `detectProjectTempo`, `adjustTempoPoint`, `addTimeSignatureChange`, `removeTimeSignatureChange`, `replaceTimeSignatureMap`, `getTimeSignatureAtBeat`, `getBarStartBeat`.
    - **Projections & Master Level**: `createMusicalPositionProjector`, `createSamplePositionProjector`, `projectPpqEndpoints`, `secondsBetweenBeats`, `setMasterGain`, `replaceMasterGain`, `ensureTrackStrips`, `getSchedulerTimingDiagnostics`, `reconcileVcaGroupRuntimeGain`, `reconcileVcaRuntimeGain`, `setStopPlaybackCallback`, `restoreTransportSnapshot`, `restoreTimelineMapSnapshot`, `getTransportHandlers`, `getTransportState`, `getTempoMapState`, `resolveTempoFieldState`, `updateTransportState`, `defaultTransportState`.
- `stores`: `transportStore` (`TransportState`, `MIN_TEMPO`, `MAX_TEMPO`), `tempoMapStore` (`TempoMapStoreState`), `timeSignatureMapStore` (`TimeSignatureMapStoreState`), `playheadPositionRef`, and the map readers `readTempoAtBeat`, `readSecondsAtBeat`, `readBeatAtSamples`, `readBarStartBeat` for handlers that cannot reach the use-case barrel.
- Handlers: `getTransportHandlers`.

## Key Subsystems

- **Playhead Scheduler**: Precise audio-clock scheduling loop backed by `playheadPositionRef` for zero-allocation, high-frequency position polling by UI canvas renderers.
- **Tempo Map Engine**: Resolves dynamic tempo changes, linear ramps, and metric beat conversions across project timelines (`useCases/tempoMap/*`).
- **Master Gain & VCA Reconciliation**: Controls master fader gain with headroom constraints, undo integration, and VCA group gain summing.

## Invariants & Traps

- High-frequency playhead updates during live playback MUST read from `playheadPositionRef` — NEVER push per-frame playhead positions into `transportStore` or React component state.
- Tempo values must stay within the range their own validator enforces: the transport's base tempo within `MIN_TEMPO` (20 BPM) and `MAX_TEMPO` (300 BPM) owned by `stores/transportStore`, and a tempo-map change within `MIN_TEMPO_MAP_TEMPO` (20 BPM) and `MAX_TEMPO_MAP_TEMPO` (999 BPM) owned by `models/TempoMap`. The two ranges deliberately differ.
- All timeline edits that insert or delete time ranges must invoke `shiftTimelineMapsAfterBeat` / `deleteTimelineMapsTimeRange` to keep tempo and time signature markers synchronized with track content.
- Stored clip controllers (Grand Boule pedals, Levain controllers) are placed by `projectClipControllerEvents` — the one projection live scheduling and the offline render share — over the same half-open `[fromBeat, toBeat)` window as notes, at the sample frame a note on that beat gets. At one frame the instrument receives releases, then controllers, then note-ons, then note expression (`SAME_FRAME_EVENT_ORDER`), in live playback (`sameFramePostQueue` posts a track's window in that order, so it cannot depend on which window a note started in or which clip came first) and in the offline render (`comparePendingWorkletEvents`) alike, with a note's release at its own start frame kept behind its note-on. The reason: a pedal must catch a note struck at its frame, and sostenuto, una corda and Levain dynamics must apply to the note struck there, but a pedal must not catch a note released at its frame; the engine queues keep posting order within a frame (live MIDI input stamps several performer events on one frame), so the order is made before the post, never inside the queue. A pedal stored playback leaves down is released frameless by `stopPlayheadScheduler` (stop, pause and locate all pass through it), only on devices the scheduler itself engaged, so a pedal the user holds live is never touched. Sending the value in force when playback starts mid-clip is the transport's chase, not this projection's.
- A bar number becomes a beat only through `getBarStartBeat`, the exact inverse of `getBarBeatAtPosition` at bar starts. Bars are counted the way that function counts them, so a bar a mid-bar meter change shortens shares its number with the bar the change opens and opens on its shortened piece. A flat `numerator * 4 / denominator` per bar is wrong as soon as the meter changes.

## Verification

```bash
pnpm vitest run src/modules/Transport
```
