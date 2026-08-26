# Transport module — Agent Guidelines

Playback lifecycle and control (play, stop, seek, record, overdub), playhead positioning & high-frequency scheduler, tempo maps and ramps, time signature maps, metronome, loop/punch regions, master gain headroom, and PPQ/sample position projections; does not own the WebAudio graph (AudioEngine) or arrangement track/clip items (Arrangement).

## Public Contract Surface

- `useCases`:
    - **Playback & Transport Controls**: `setPlayback`, `stopPlayback`, `togglePlayback`, `seekPlayhead`, `panicAllNotes`, `toggleRecording`, `toggleOverdub`, `setLoopRegion`, `toggleLoop`, `disableLooping`, `toggleMetronome`, `setMetronomeVolume`, `setCountInBars`, `toggleCountIn`, `setPreRollBars`, `togglePreRoll`, `setPunchIn`, `setPunchOut`, `togglePunchEnabled`, `createPunchRegionPatch`.
    - **Tempo & Time Signature Mapping**: `setTempo`, `setTimeSignature`, `addTempoChange`, `removeTempoChange`, `updateTempoChange`, `replaceTempoMap`, `resolveTempoAtBeat`, `shiftTimelineMapsAfterBeat`, `deleteTimelineMapsTimeRange`, `prepareTimelineMapStateRestore`, `prepareTimelineMapTimeOperation`, `detectProjectTempo`, `adjustTempoPoint`, `addTimeSignatureChange`, `removeTimeSignatureChange`, `replaceTimeSignatureMap`, `getTimeSignatureAtBeat`.
    - **Projections & Master Level**: `createMusicalPositionProjector`, `createSamplePositionProjector`, `projectPpqEndpoints`, `secondsBetweenBeats`, `setMasterGain`, `replaceMasterGain`, `ensureTrackStrips`, `getSchedulerTimingDiagnostics`, `reconcileVcaGroupRuntimeGain`, `reconcileVcaRuntimeGain`, `setStopPlaybackCallback`, `restoreTransportSnapshot`, `restoreTimelineMapSnapshot`, `getTransportHandlers`, `getTransportState`, `getTempoMapState`, `resolveTempoFieldState`, `updateTransportState`, `defaultTransportState`.
- `stores`: `transportStore` (`TransportState`, `MIN_TEMPO`, `MAX_TEMPO`), `tempoMapStore` (`TempoMapStoreState`, `MIN_TEMPO_MAP_TEMPO`), `timeSignatureMapStore` (`TimeSignatureMapStoreState`), `playheadPositionRef`.
- Handlers: `getTransportHandlers`.

## Key Subsystems

- **Playhead Scheduler**: Precise audio-clock scheduling loop backed by `playheadPositionRef` for zero-allocation, high-frequency position polling by UI canvas renderers.
- **Tempo Map Engine**: Resolves dynamic tempo changes, linear ramps, and metric beat conversions across project timelines (`useCases/tempoMap/*`).
- **Master Gain & VCA Reconciliation**: Controls master fader gain with headroom constraints, undo integration, and VCA group gain summing.

## Invariants & Traps

- High-frequency playhead updates during live playback MUST read from `playheadPositionRef` — NEVER push per-frame playhead positions into `transportStore` or React component state.
- Tempo values must strictly stay within `MIN_TEMPO` (20 BPM) and `MAX_TEMPO` (999 BPM).
- All timeline edits that insert or delete time ranges must invoke `shiftTimelineMapsAfterBeat` / `deleteTimelineMapsTimeRange` to keep tempo and time signature markers synchronized with track content.

## Verification

```bash
pnpm vitest run src/modules/Transport
```
