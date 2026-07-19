import {
    adjustmentLayerStore,
    computeAdjustmentLayerBlendAtBeat,
    type AdjustmentLayer,
} from '../../stores/adjustmentLayer';

export function getActiveLayersAtBeat(beat: number): AdjustmentLayer[] {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return [];
    }

    return state.layers.filter((layer) => computeAdjustmentLayerBlendAtBeat(layer, beat) > 0);
}
