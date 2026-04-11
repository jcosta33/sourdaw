// Transport/useCases — public contract surface for cross-module use-case access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { ensureTrackStrips } from './ensureTrackStrips';

export { toggleRecord } from './loopStation/toggleRecord';
export { triggerScene } from './loopStation/triggerScene';

export { togglePunchRecording } from './punchRecording/togglePunchRecording';

export { disableLooping } from './setLooping';

export { setMasterGain } from './setMasterGain';
export { setTempo } from './setTempo';
export { setTimeSignature } from './setTimeSignature';

export { nextItem } from './setlist/nextItem';
export { previousItem } from './setlist/previousItem';

export { addTempoChange, removeTempoChange, updateTempoChange } from './tempoMap';

export {
    detectTempoFromOnsets,
    estimateOnsetsFromClips,
    applyTempoMap,
    detectProjectTempo,
    adjustTempoPoint,
} from './tempoMapping/operations';

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

export { addTimeSignatureChange, removeTimeSignatureChange } from './timeSignatureChanges';

export { getTransportHandlers } from './getTransportHandlers';

export type { TransportState, TempoChange, TimeSignatureChange } from './transportQueries';
export {
    defaultTransportState,
    getTransportState,
    getTransportStoreValue,
    getTempoMapState,
    getTempoAtBeat,
    updateTransportState,
} from './transportQueries';
