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
     * The rate the output stream actually opened at. Zero for the not-running
     * shape, the same reading rule every other counter here follows.
     */
    sampleRate: number;
    /**
     * Frames the output device's most recent callback asked for. Zero before
     * the stream has rendered its first callback, the same reading rule
     * `inputLatencyFrames` documents.
     */
    outputBufferFrames: number;
    /**
     * The backend's whole output-path figure, as of the most recent pair of
     * agreeing callbacks. Zero means no figure, not no delay — see
     * `daw_engine::EngineHandle::output_path_frames` (`crates/daw-engine`)
     * for the same rule on the Rust side.
     */
    outputPathFrames: number;
    /**
     * The kind of the last non-xrun error the output stream reported, or
     * `null` if it has not reported one. Detail beside `running`, not a
     * substitute for it: a `deviceChanged` reroute or a recovered WASAPI
     * invalidation can leave this non-null while `running` is still `true`,
     * because the render callback kept being called through it.
     * `running: false` with this non-null is a different condition than
     * `running: false` with no engine ever started: an engine object exists
     * and its other counters are real readings, but no render callback is
     * running and nothing renders until the engine is restarted.
     */
    outputStreamFault: EngineStreamErrorKind | null;
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
    captureConsumerRefusals: 0,
    captureBlocksDropped: 0,
    captureInputUnderruns: 0,
    inputLatencyFrames: 0,
    sampleRate: 0,
    outputBufferFrames: 0,
    outputPathFrames: 0,
    outputStreamFault: null,
    events: [],
};
