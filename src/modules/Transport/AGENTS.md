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
- A bar number becomes a beat only through `getBarStartBeat`, the exact inverse of `getBarBeatAtPosition` at bar starts. Bars are counted the way that function counts them, so a bar a mid-bar meter change shortens shares its number with the bar the change opens and opens on its shortened piece. A flat `numerator * 4 / denominator` per bar is wrong as soon as the meter changes.

## Verification

```bash
pnpm vitest run src/modules/Transport
```
