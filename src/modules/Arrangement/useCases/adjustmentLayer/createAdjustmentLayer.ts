import {
    adjustmentLayerStore,
    getNextLayerId,
    EFFECT_PRESETS,
    LAYER_COLORS,
    type AdjustmentEffectType,
    type AdjustmentLayer,
} from '../../stores/adjustmentLayer';

export function createAdjustmentLayer(
    name: string,
    effectType: AdjustmentEffectType,
    insertionIndex: number = 0,
    layerId: string = getNextLayerId()
): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    if (state.layers.some((layer) => layer.id === layerId)) {
        throw new Error(`Adjustment layer id collision: ${layerId}`);
    }

    const layer: AdjustmentLayer = {
        id: layerId,
        name,
        effectType,
        parameters: [...EFFECT_PRESETS[effectType]],
        affectedTrackIds: [],
        insertionIndex,
        regions: [],
        enabled: true,
        mix: 1,
        color: LAYER_COLORS[state.layers.length % LAYER_COLORS.length]!,
    };

    adjustmentLayerStore.set({ layers: [...state.layers, layer] });
}
