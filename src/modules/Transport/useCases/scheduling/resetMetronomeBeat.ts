import { metronomeSchedulingState } from './metronomeSchedulingState';

export function resetMetronomeBeat(position: number): void {
    metronomeSchedulingState.lastBeat = Math.floor(position) - 1;
    // NB: `firedClickTimes` is deliberately NOT cleared here. The relocation and
    // edit paths call this while clicks they already scheduled are still ahead of
    // the clock, so wiping it would let a re-opened window schedule those instants
    // a second time. The time-based pruning in scheduleMetronome keeps the map
    // bounded; an entry outlives its own click time by CLICK_DEDUP_RETENTION_SECONDS.
}
