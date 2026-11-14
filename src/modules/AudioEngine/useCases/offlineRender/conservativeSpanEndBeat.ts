/**
 * The render's beat span, widened conservatively: the last tempo change's beat
 * plus the whole duration walked at the slowest tempo in the map. The mixdown
 * classifies its compositions over this span — a wider span can only answer
 * "moves" more often, which costs the seed fold and schedules the identical
 * curve, never bakes a wrong level.
 */
export function conservativeSpanEndBeat(
    durationSeconds: number,
    defaultTempo: number,
    changes: readonly { beat: number; tempo: number }[]
): number {
    const slowestTempo = Math.min(defaultTempo, ...changes.map((change) => change.tempo));
    const lastChangeBeat = changes.reduce((beat, change) => Math.max(beat, change.beat), 0);
    return lastChangeBeat + (durationSeconds / 60) * slowestTempo;
}
