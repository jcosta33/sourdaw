// AudioEngine/stores — public contract surface for cross-module store access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export type { ExportedAudioBuffer } from './audioBufferCache';
export { audioBufferCache } from './audioBufferCache';

export type { AudioGraphState } from './audioGraphStore';
export { audioGraphStore, defaultAudioGraphState } from './audioGraphStore';

export type { AudioRecordingState } from './audioRecordingStore';
export { audioRecordingStore } from './audioRecordingStore';

export type {
    EngineEvent,
    EngineRtDiagnostics,
    EngineRtDiagnosticsState,
    EngineStreamErrorKind,
} from './engineRtDiagnosticsStore';
export { defaultEngineRtDiagnosticsState, engineRtDiagnosticsStore } from './engineRtDiagnosticsStore';

export type { AdjustmentApplicationState } from './adjustmentApplicationStore';
export { adjustmentApplicationStore } from './adjustmentApplicationStore';

// elasticAudio + audioWarp stores moved to ElasticAudio (ADR 0011 W4).
