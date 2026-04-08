// Transport module public API

// stores
export { playheadPositionRef } from './stores/playheadPositionRef';

export type { TempoMapStoreState } from './stores/tempoMapStore';
export { tempoMapStore } from './stores/tempoMapStore';

export type { TimeSignatureMapStoreState } from './stores/timeSignatureMapStore';
export { timeSignatureMapStore } from './stores/timeSignatureMapStore';

export { transportStore } from './stores/transportStore';

// useCases
export { ensureTrackStrips } from './useCases/ensureTrackStrips';

export { toggleRecord } from './useCases/loopStation/toggleRecord';
export { triggerScene } from './useCases/loopStation/triggerScene';

export { togglePunchRecording } from './useCases/punchRecording/togglePunchRecording';

export { disableLooping } from './useCases/setLooping';

export { setMasterGain } from './useCases/setMasterGain';
export { setTempo } from './useCases/setTempo';
export { setTimeSignature } from './useCases/setTimeSignature';

export { nextItem } from './useCases/setlist/nextItem';
export { previousItem } from './useCases/setlist/previousItem';

export { addTempoChange, removeTempoChange, updateTempoChange } from './useCases/tempoMap';

export {
    detectTempoFromOnsets,
    estimateOnsetsFromClips,
    applyTempoMap,
    detectProjectTempo,
    adjustTempoPoint,
} from './useCases/tempoMapping/operations';

export { seekPlayhead } from './useCases/transportControls/seekPlayhead';
export { setCountInBars } from './useCases/transportControls/setCountInBars';
export { setLoopRegion } from './useCases/transportControls/setLoopRegion';
export { setMetronomeVolume } from './useCases/transportControls/setMetronomeVolume';
export { stopPlayback } from './useCases/transportControls/stopPlayback';
export { toggleCountIn } from './useCases/transportControls/toggleCountIn';
export { toggleLoop } from './useCases/transportControls/toggleLoop';
export { toggleMetronome } from './useCases/transportControls/toggleMetronome';
export { toggleOverdub } from './useCases/transportControls/toggleOverdub';
export { togglePlayback } from './useCases/transportControls/togglePlayback';
export { togglePunchEnabled } from './useCases/transportControls/togglePunchEnabled';
export { toggleRecording } from './useCases/transportControls/toggleRecording';

export { transportHandlers } from './useCases/transportHandlers';

export type { TransportState, TempoChange, TimeSignatureChange } from './useCases/transportQueries';
export {
    defaultTransportState,
    getTransportState,
    getTransportStoreValue,
    getTempoMapState,
    getTempoAtBeat,
    updateTransportState,
} from './useCases/transportQueries';
