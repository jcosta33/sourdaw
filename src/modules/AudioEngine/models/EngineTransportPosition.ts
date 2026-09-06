/**
 * Mirror of the `engine_transport_position` and `engine_transport_set_maps`
 * native command payloads
 * (`crates/sourdaw-native/src/commands/engine_transport.rs`).
 *
 * Hand-maintained on both sides — no binding generator runs, so a change to the
 * Rust payload must land here in the same change. The Rust wire-shape test pins
 * every key below.
 */

/** Where the native engine's transport stands, as of its last rendered block. */
export type EngineTransportPosition = {
    /**
     * False when no native engine has been started. Every number reads zero in
     * that case too, so this flag is the only thing distinguishing a stopped
     * engine from one parked at the song start.
     */
    running: boolean;
    playing: boolean;
    /** The engine's playhead, in seconds on its own device clock. */
    positionSeconds: number;
    playheadFrame: number;
    /**
     * How many times the playhead crossed the loop end since the engine
     * started. A consumer that sees this change knows the position went
     * backwards deliberately rather than jumping.
     */
    loopWraps: number;
    /**
     * How many fenced command batches the engine has drained since it started.
     *
     * The only field that dates this reading against a command the renderer
     * sent. A native apply resolves once its batch is fenced onto the command
     * ring, not once the audio thread has drained it, so the next position may
     * still be the one from before a locate — and no position, wrap count or
     * timestamp on this reading can say which side of that locate it fell on.
     * A reading whose count has reached the `admittedBatch` an apply reported
     * was taken after that batch reached the audio thread.
     */
    batchesApplied: number;
    tempo: number;
    timeSigNum: number;
    timeSigDenom: number;
    /**
     * The engine's held master peak, linear and never negative.
     *
     * Alone on this reading in making no claim about *when* it was taken: the
     * engine publishes it on its own channel, and it rides this reply only
     * because the renderer already polls this command once a frame. Reading it
     * beside a position is bridge-wakeup economy, not evidence that the two
     * came from one callback.
     *
     * It measures what the engine handed the device, so a shadowed monitor
     * reads zero however loud the graph behind it is.
     */
    masterPeak: number;
};

/** The shape a stopped engine reports, and the shape the browser build reports. */
export const stoppedEngineTransportPosition: EngineTransportPosition = {
    running: false,
    playing: false,
    positionSeconds: 0,
    playheadFrame: 0,
    loopWraps: 0,
    batchesApplied: 0,
    tempo: 0,
    timeSigNum: 0,
    timeSigDenom: 0,
    masterPeak: 0,
};

/**
 * One tempo segment, in seconds on the engine clock.
 *
 * Seconds rather than frames because the renderer does not know which sample
 * rate the engine's device actually opened; the native side derives frames
 * against the rate it is running at.
 */
export type EngineTempoSegment = {
    startSeconds: number;
    beatsPerMinute: number;
};

export type EngineTimeSignatureSegment = {
    startSeconds: number;
    numerator: number;
    denominator: number;
};

export type EngineLoopRegion = {
    enabled: boolean;
    startSeconds: number;
    endSeconds: number;
};

/** Everything the engine's transport follows, as one replacing write. */
export type EngineTransportMaps = {
    tempo: EngineTempoSegment[];
    timeSignature: EngineTimeSignatureSegment[];
    loopRegion: EngineLoopRegion | null;
};

/** What the engine reports it did with a maps write. */
export type EngineTransportMapsApplied = {
    /** The rate the engine derived its frames against. */
    sampleRate: number;
    tempoSegments: number;
    timeSignatureSegments: number;
    /**
     * The fence number {@link EngineTransportPosition.batchesApplied} reaches
     * once this install has drained. Numbered from the same counter the graph
     * batches are numbered from, because the engine counts one stream of
     * fences whichever command published them.
     */
    admittedBatch: number;
    /**
     * Whether the engine will actually wrap. A region shorter than the engine's
     * floor is held but not honoured, so this is not an echo of the requested
     * `enabled`.
     */
    loopEnabled: boolean;
};
