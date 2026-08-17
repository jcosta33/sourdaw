// Transport/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { ensureTrackStrips } from './ensureTrackStrips';
export { getSchedulerTimingDiagnostics } from './getSchedulerTimingDiagnostics';
export { reconcileVcaGroupRuntimeGain } from './scheduling/applyAutomation/reconcileVcaGroupRuntimeGain';
export { reconcileVcaRuntimeGain } from './scheduling/applyAutomation/reconcileVcaRuntimeGain';
export { setStopPlaybackCallback } from './playheadScheduler/setStopPlaybackCallback';

export { disableLooping } from './setLooping';

export { setMasterGain } from './setMasterGain';
export { replaceMasterGain } from './replaceMasterGain';
export { setTempo } from './setTempo';
export { setTimeSignature } from './setTimeSignature';
export { restoreTransportSnapshot } from './restoreTransportSnapshot';
export { restoreTimelineMapSnapshot } from './restoreTimelineMapSnapshot';
export { projectPpqEndpoints } from './projectPpqEndpoints';
export { createMusicalPositionProjector } from './createMusicalPositionProjector';
export { createSamplePositionProjector } from './createSamplePositionProjector';

export { addTempoChange } from './tempoMap/addTempoChange';
export { deleteTimelineMapsTimeRange } from './tempoMap/deleteTimelineMapsTimeRange';
export { prepareTimelineMapStateRestore } from './tempoMap/prepareTimelineMapStateRestore';
export { prepareTimelineMapTimeOperation } from './tempoMap/prepareTimelineMapTimeOperation';
export { removeTempoChange } from './tempoMap/removeTempoChange';
export { replaceTempoMap } from './tempoMap/replaceTempoMap';
export { shiftTimelineMapsAfterBeat } from './tempoMap/shiftTimelineMapsAfterBeat';
export { updateTempoChange } from './tempoMap/updateTempoChange';

export { detectProjectTempo } from './tempoMapping/operations/detectProjectTempo';
export { adjustTempoPoint } from './tempoMapping/operations/adjustTempoPoint';

export { panicAllNotes } from './transportControls/panicAllNotes';
export { seekPlayhead } from './transportControls/seekPlayhead';
export { setCountInBars } from './transportControls/setCountInBars';
export { setLoopRegion } from './transportControls/setLoopRegion';
export { setMetronomeVolume } from './transportControls/setMetronomeVolume';
export { setPreRollBars } from './transportControls/setPreRollBars';
export { setPunchIn } from './transportControls/setPunchIn';
export { createPunchRegionPatch } from './transportControls/punchRegion';
export { setPunchOut } from './transportControls/setPunchOut';
export { setPlayback } from './transportControls/setPlayback';
export { stopPlayback } from './transportControls/stopPlayback';
export { toggleCountIn } from './transportControls/toggleCountIn';
export { toggleLoop } from './transportControls/toggleLoop';
export { toggleMetronome } from './transportControls/toggleMetronome';
export { toggleOverdub } from './transportControls/toggleOverdub';
export { togglePlayback } from './transportControls/togglePlayback';
export { togglePunchEnabled } from './transportControls/togglePunchEnabled';
export { togglePreRoll } from './transportControls/togglePreRoll';
export { toggleRecording } from './transportControls/toggleRecording';

export { addTimeSignatureChange } from './timeSignatureChanges/addTimeSignatureChange';
export { removeTimeSignatureChange } from './timeSignatureChanges/removeTimeSignatureChange';
export { replaceTimeSignatureMap } from './timeSignatureChanges/replaceTimeSignatureMap';

export { getTransportHandlers } from './getTransportHandlers';

export { defaultTransportState } from './transportQueries/helpers';
export { getTransportState } from './transportQueries/getTransportState';
export { getTempoMapState } from './transportQueries/getTempoMapState';
export { resolveTempoFieldState } from './transportQueries/resolveTempoFieldState';
export { getTimeSignatureAtBeat } from './transportQueries/getTimeSignatureAtBeat';
export { updateTransportState } from './transportQueries/updateTransportState';
