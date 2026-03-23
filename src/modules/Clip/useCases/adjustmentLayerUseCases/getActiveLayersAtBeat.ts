import { adjustmentLayerStore, type AdjustmentLayer } from '#/modules/Clip/stores/adjustmentLayer';

export function getActiveLayersAtBeat(beat: number): AdjustmentLayer[] {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return [];
    }

    return state.layers.filter((l) => {
        if (!l.enabled) {
            return false;
        }
        // If no regions, layer applies everywhere
        if (l.regions.length === 0) {
            return true;
        }
        return l.regions.some((r) => beat >= r.startBeat && beat < r.endBeat);
    });
}
