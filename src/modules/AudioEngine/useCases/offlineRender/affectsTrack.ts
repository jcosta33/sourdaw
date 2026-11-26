import { type AdjustmentLayer } from '#/modules/Arrangement/stores';

/** The tracks a layer reaches: its explicit list, or every track below its stack position (live `resolveAffectedTrackIds`). */
export function affectsTrack(layer: AdjustmentLayer, trackId: string, allTrackIds: readonly string[]): boolean {
    if (layer.affectedTrackIds.length > 0) {
        return layer.affectedTrackIds.includes(trackId);
    }
    return allTrackIds.slice(layer.insertionIndex).includes(trackId);
}
