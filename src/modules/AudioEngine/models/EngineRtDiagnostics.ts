/**
 * Mirror of the `engine_rt_diagnostics` native command payload
 * (`crates/sourdaw-native/src/commands/engine_diagnostics.rs`).
 *
 * Hand-maintained on both sides — no binding generator runs, so a change to the
 * Rust payload must land here in the same change. The Rust wire-shape test pins
 * every key and every enum spelling below.
 */

/** Why the audio backend reported a stream error. */
export type EngineStreamErrorKind =
    'deviceNotAvailable' | 'deviceBusy' | 'deviceChanged' | 'streamInvalidated' | 'xrun' | 'backendSpecific';

/**
 * Which of the engine's device streams a report came from. A failing capture
 * stream costs the take being recorded; a failing playback stream costs
 * monitoring outright, and nothing downstream can tell them apart without
 * this.
 */
export type EngineStreamSide = 'output' | 'input';

/** One drained engine event, discriminated on `type`. */
export type EngineEvent = {
    type: 'streamError';
    side: EngineStreamSide;
    kind: EngineStreamErrorKind;
};

export type EngineRtDiagnostics = {
    /**
     * False when no native engine has been started. Every counter reads zero in
     * that case too, so this flag is the only thing distinguishing a stopped
     * engine from a healthy one.
     */
    running: boolean;
    schedulerEventBufferOverflows: number;
    arpeggiatorActiveNoteExhaustions: number;
    effectIdCollisions: number;
    unsupportedEffectAdditions: number;
    unmappedSetParamCalls: number;
    bridgeOutputBlocksDropped: number;
    unmatchedBridgeBlocks: number;
    bridgeBacklogBlocksShed: number;
    callbackFramesOverBridgeReach: number;
    bridgeInputBlocksRefused: number;
    captureConsumerRefusals: number;
    captureBlocksDropped: number;
    captureInputUnderruns: number;
    /**
     * Frames of latency the capture path is currently adding, or zero while
     * capture is not serving. Zero means no figure, not no delay: it reads
     * zero when capture was refused, when no input device is open, and while
     * the ring has not yet settled on a cadence — see
     * `audio_thread::new_input_latency_slot` (`crates/daw-engine`).
     */
    inputLatencyFrames: number;
    /**
     * Events drained by this read. The engine hands each event out exactly
     * once, so a reader that discards them loses them.
     */
    events: EngineEvent[];
};

/** The shape a stopped engine reports, and the shape the browser build reports. */
export const notRunningEngineRtDiagnostics: EngineRtDiagnostics = {
    running: false,
    schedulerEventBufferOverflows: 0,
    arpeggiatorActiveNoteExhaustions: 0,
    effectIdCollisions: 0,
    unsupportedEffectAdditions: 0,
    unmappedSetParamCalls: 0,
    bridgeOutputBlocksDropped: 0,
    unmatchedBridgeBlocks: 0,
    bridgeBacklogBlocksShed: 0,
    callbackFramesOverBridgeReach: 0,
    bridgeInputBlocksRefused: 0,
    captureConsumerRefusals: 0,
    captureBlocksDropped: 0,
    captureInputUnderruns: 0,
    inputLatencyFrames: 0,
    events: [],
};
