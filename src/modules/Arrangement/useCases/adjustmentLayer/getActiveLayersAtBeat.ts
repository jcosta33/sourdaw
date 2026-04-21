import { adjustmentLayerStore, type AdjustmentLayer } from '../../stores/adjustmentLayer';

export function getActiveLayersAtBeat(beat: number): AdjustmentLayer[] {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return [];
    }

    return state.layers.filter((length) => {
        if (!length.enabled) {
            return false;
        }
        // If no regions, layer applies everywhere
        if (length.regions.length === 0) {
            return true;
        }
        return length.regions.some((r) => beat >= r.startBeat && beat < r.endBeat);
    });
}
