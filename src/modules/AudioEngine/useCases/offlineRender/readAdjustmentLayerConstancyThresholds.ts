import { type AdjustmentLayer } from '#/modules/Arrangement/stores';

/**
 * The span ends past which each layer stops being constant across `[0, end]`, by the rule
 * `resolveTrackAdjustmentComposition` classifies each layer by: a region with no fades starting at or before beat 0
 * keeps its layer constant while the span ends at or before the region's end; any other region moves
 * its layer once the span reaches past the region's start. A layer is constant while the span ends
 * at or before its smallest threshold. A layer with no regions, or none past beat 0, never moves.
 *
 * A render's decisions about a layer — fold or schedule its level, apply or skip its DSP — follow
 * from this classification alone, so two render ends with the same thresholds below them render the
 * windows they share alike. Disabled layers are skipped, as the composition skips them; reach is not
 * narrowed per track, so the set can only hold more thresholds than a render needs.
 */
export function readAdjustmentLayerConstancyThresholds(layers: readonly AdjustmentLayer[]): number[] {
    const thresholds: number[] = [];
    for (const layer of layers) {
        if (!layer.enabled) {
            continue;
        }
        let threshold = Number.POSITIVE_INFINITY;
        for (const region of layer.regions) {
            const firstBeat = Math.max(region.startBeat, 0);
            if (region.endBeat <= firstBeat) {
                continue;
            }
            const steady = region.startBeat <= 0 && region.fadeInBeats === 0 && region.fadeOutBeats === 0;
            threshold = Math.min(threshold, steady ? region.endBeat : firstBeat);
        }
        if (Number.isFinite(threshold)) {
            thresholds.push(threshold);
        }
    }
    return thresholds;
}
