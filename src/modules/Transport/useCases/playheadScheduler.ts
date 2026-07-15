export type SourceWithFade = AudioBufferSourceNode & { fadeGainNode?: GainNode };

// §28.1 / §107.1 — Coalesce scheduler mutables into a single holder so
// the active playback session lives behind one handle. Mutation is still
// only done from within the scheduler owners; the holder object prevents
// importers from rebinding any of these via `export let`.
export const schedulerSession = {
    worker: null as Worker | null,
    lastTickTime: 0,
    accumulatedPosition: 0,
    lastScheduledBeat: -1,
    scheduledAudioClips: new Set<string>(),
    scheduledFrozenTracks: new Set<string>(),
    activeAudioSources: [] as AudioBufferSourceNode[],
    punchRecordingActive: false,
    onStopRequested: null as (() => void) | null,
    // Re-entrancy guard. `tick` is async and awaits the Yeast Worker round-trip
    // (scheduleMidiNotes); if that awaited work outruns the fixed worker interval
    // (`scheduleGrainMs`, default 10ms), the next worker message would start a
    // second `tick` while the first is still suspended, and both would mutate the
    // shared session mutables (accumulatedPosition, lastScheduledBeat, the dedup
    // Sets, playheadPositionRef) concurrently. The flag makes overlapping worker
    // ticks no-op until the in-flight tick resolves.
    tickInFlight: false,
    // Every start/stop/dispose creates a new scheduler generation. A suspended
    // async tick may still resume after its worker is terminated, so post-await
    // work must prove it belongs to the live generation before it schedules.
    generation: 0,
    // Last-seen tempo-map identity and loop-region signature. A mid-playback edit
    // to either changes the beat→time alignment of already-scheduled clips, but
    // the dedup Set would keep them suppressed; we detect the change and invalidate.
    lastTempoMapChanges: null as unknown[] | null,
    lastLoopSignature: '',
};

export const SCHEDULE_AHEAD_SECONDS = 0.1;
export const MAX_DELTA_SECONDS = SCHEDULE_AHEAD_SECONDS;
