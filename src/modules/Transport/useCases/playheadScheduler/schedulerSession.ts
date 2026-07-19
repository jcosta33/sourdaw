export type SourceWithFade = AudioBufferSourceNode & { fadeGainNode?: GainNode };

export function stopActiveSources(sources: AudioBufferSourceNode[], ctx: BaseAudioContext): void {
    const now = ctx.currentTime;
    for (const src of sources as SourceWithFade[]) {
        try {
            if (src.fadeGainNode) {
                src.fadeGainNode.gain.cancelScheduledValues(now);
                src.fadeGainNode.gain.setValueAtTime(src.fadeGainNode.gain.value, now);
                src.fadeGainNode.gain.linearRampToValueAtTime(0, now + 0.005);
                src.stop(now + 0.005);
            } else {
                src.stop(now + 0.005);
            }
        } catch {
            /* already stopped */
        }
    }
    sources.length = 0;
}

// §28.1 / §107.1 — Coalesce scheduler mutables into a single holder so
// the active playback session lives behind one handle. Mutation is still
// only done from within the playheadScheduler lifecycle files; the holder
// object prevents importers from rebinding any of these via `export let`.
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
    // Semantic timeline identity is deliberately independent of async work
    // cancellation. Loop wraps and jumps advance this without cancelling the
    // live scheduler generation; restarts/replacements advance both.
    discontinuityEpoch: 0,
    // Last-seen tempo-map identity and loop-region signature. A mid-playback edit
    // to either changes the beat→time alignment of already-scheduled clips, but
    // the dedup Set would keep them suppressed; we detect the change and invalidate.
    lastTempoMapChanges: null as unknown[] | null,
    lastLoopSignature: '',
};
