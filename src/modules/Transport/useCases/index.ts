// Transport/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { ensureTrackStrips } from './ensureTrackStrips';
export { setStopPlaybackCallback } from './playheadScheduler';

export { toggleRecord } from './loopStation/toggleRecord';
export { triggerPad } from './loopStation/triggerPad';
export { triggerScene } from './loopStation/triggerScene';
export { triggerSlot } from './loopStation/triggerSlot';
export { stopAllSlots } from './loopStation/stopAllSlots';

export { togglePunchRecording } from './punchRecording/togglePunchRecording';

export { disableLooping } from './setLooping';

export { setMasterGain } from './setMasterGain';
export { setTempo } from './setTempo';
export { setTimeSignature } from './setTimeSignature';

export { addSetlistItem } from './setlist/addSetlistItem';
export { getCurrentItem } from './setlist/getCurrentItem';
export { getRemainingDuration } from './setlist/getRemainingDuration';
export { getSetlistProgress } from './setlist/getSetlistProgress';
export { goToItem } from './setlist/goToItem';
export { nextItem } from './setlist/nextItem';
export { previousItem } from './setlist/previousItem';
export { removeSetlistItem } from './setlist/removeSetlistItem';
export { renameSetlist } from './setlist/renameSetlist';
export { reorderSetlistItems } from './setlist/reorderSetlistItems';
export { setCountIn } from './setlist/setCountIn';
export { toggleAutoAdvance } from './setlist/toggleAutoAdvance';
export { updateSetlistItem } from './setlist/updateSetlistItem';

export { addTempoChange } from './tempoMap/addTempoChange';
export { removeTempoChange } from './tempoMap/removeTempoChange';
export { updateTempoChange } from './tempoMap/updateTempoChange';

export {
    detectTempoFromOnsets,
    estimateOnsetsFromClips,
    applyTempoMap,
    detectProjectTempo,
} from './tempoMapping/operations/detectProjectTempo';
export { adjustTempoPoint } from './tempoMapping/operations/adjustTempoPoint';

export { seekPlayhead } from './transportControls/seekPlayhead';
export { setCountInBars } from './transportControls/setCountInBars';
export { setLoopRegion } from './transportControls/setLoopRegion';
export { setMetronomeVolume } from './transportControls/setMetronomeVolume';
export { setPreRollBars } from './transportControls/setPreRollBars';
export { setPunchIn } from './transportControls/setPunchIn';
export { setPunchOut } from './transportControls/setPunchOut';
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

export { getTransportHandlers } from './getTransportHandlers';

export type { TransportState, TempoChange, TimeSignatureChange } from './transportQueries/helpers';
export { defaultTransportState } from './transportQueries/helpers';
export { getTransportState } from './transportQueries/getTransportState';
export { getTransportStoreValue } from './transportQueries/getTransportStoreValue';
export { getTempoMapState } from './transportQueries/getTempoMapState';
export { getTempoAtBeat } from './transportQueries/getTempoAtBeat';
export { getTimeSignatureAtBeat } from './transportQueries/getTimeSignatureAtBeat';
export { updateTransportState } from './transportQueries/updateTransportState';
