/**
 * A buffer source the scheduler tracks, with the handle its fade rides and —
 * for sources scheduled on the compensated clock (#4784) — the compensation it
 * was scheduled with, so a loop-seam fence can spare the tail it is still due.
 */
export type SourceWithFade = AudioBufferSourceNode & { fadeGainNode?: GainNode; compensationSeconds?: number };

/**
 * Stop every source in the pool through its optional fade, and drop the
 * references.
 *
 * Without `stopAtTime` the sources stop one 5 ms ramp after the current clock —
 * the teardown semantic, applied to every source whatever its compensation,
 * because a teardown owes nothing past the clock. With it, the sources are
 * fenced at that audio instant with the ramp ending there: the scheduled loop
 * wrap (#4656) fires before the playhead reaches loopEnd, so the sources that
 * must not sound past the seam (the whole-arrangement frozen-track buffers) are
 * cut sample-accurately at the seam instead of a grain after it. A time already
 * behind the clock degrades to an immediate stop. An already-stopped node is
 * skipped silently.
 *
 * Each source's fence is the seam plus that source's own compensation
 * (#4784): loop-end material on a compensated track is scheduled its
 * compensation late, so it is still due for that long past the seam — cutting
 * every source at the seam itself silences the last `compensation` seconds of
 * the loop. A source without a recorded compensation — MIDI, metronome, or
 * anything scheduled on the plain clock — fences at the seam unchanged.
 */
export function stopActiveSources(sources: AudioBufferSourceNode[], ctx: BaseAudioContext, stopAtTime?: number): void {
    const now = ctx.currentTime;
    for (const src of sources as SourceWithFade[]) {
        const stopAt =
            stopAtTime === undefined ? now + 0.005 : Math.max(stopAtTime + (src.compensationSeconds ?? 0), now);
        const fadeStart = Math.max(stopAt - 0.005, now);
        try {
            if (src.fadeGainNode) {
                src.fadeGainNode.gain.cancelScheduledValues(now);
                src.fadeGainNode.gain.setValueAtTime(src.fadeGainNode.gain.value, fadeStart);
                src.fadeGainNode.gain.linearRampToValueAtTime(0, stopAt);
            }
            src.stop(stopAt);
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
    // The loop seam the scheduler has scheduled but the playhead has not
    // reached yet (#4656): the audio instant both passes pivot on, plus where
    // the dying pass — the one still audible — stood when the seam tick ran.
    // While set and `seamAudioTime` is still ahead of the clock, the published
    // position integrates the dying pass forward from that anchor instead of
    // showing the incoming pass's negative-phase integration (see
    // startPlayheadScheduler).
    pendingSeam: null as {
        seamAudioTime: number;
        anchorAudioTime: number;
        anchorPosition: number;
    } | null,
    // The audio-clock instant the most recent loop wrap pivoted on (#4784), or
    // `null` when no wrap has happened in this session. For one compensation
    // window after it, the audio a compensated track is fed is still the dying
    // pass's tail — the compensated device read maps back across the region
    // onto it (applyAutomation). Cleared by a tempo-map or loop-region edit
    // (whose teardown cuts the tail) and by every new scheduler session.
    lastLoopSeamAudioTime: null as number | null,
};
