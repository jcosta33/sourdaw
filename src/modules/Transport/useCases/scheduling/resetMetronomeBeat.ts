import { metronomeSchedulingState } from './metronomeSchedulingState';

export function resetMetronomeBeat(position: number): void {
    metronomeSchedulingState.lastBeat = Math.floor(position) - 1;
    // NB: `firedClickTimes` is deliberately NOT cleared here. The loop-wrap and
    // follow-action-jump paths call this while still inside the look-ahead window
    // of the click we are guarding against, so wiping it would re-enable the very
    // double-fire we suppress. The time-based pruning in scheduleMetronome keeps
    // the map bounded; entries always lie in the future of getCurrentTime() until
    // played, after which they are dropped.
}
