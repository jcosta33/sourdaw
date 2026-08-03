import { metronomeSchedulingState } from './metronomeSchedulingState';

export function resetMetronomeBeat(position: number): void {
    metronomeSchedulingState.lastBeat = Math.floor(position) - 1;
    // NB: `firedClickTimes` is deliberately NOT cleared here. The loop-wrap and
    // follow-action-jump paths call this while still inside the look-ahead window
    // of the click we are guarding against, so wiping it would re-enable the very
    // double-fire we suppress. The time-based pruning in scheduleMetronome keeps
    // the map bounded; an entry outlives its own click time by
    // CLICK_DEDUP_RETENTION_SECONDS, which is what carries it across a loop wrap —
    // the wrap is only detected once the playhead has already crossed the seam, so
    // the entry the wrapped downbeat has to match is by then in the past.
}
