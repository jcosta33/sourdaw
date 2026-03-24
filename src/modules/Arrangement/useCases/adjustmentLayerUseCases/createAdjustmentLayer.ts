import { adjustmentLayerStore, getNextLayerId, EFFECT_PRESETS, LAYER_COLORS, type AdjustmentEffectType, type AdjustmentLayer } from '#/modules/Arrangement/stores/adjustmentLayer';

export function createAdjustmentLayer(
    name: string,
    effectType: AdjustmentEffectType,
    insertionIndex: number = 0
): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }

    const layer: AdjustmentLayer = {
        id: getNextLayerId(),
        name,
        effectType,
        parameters: [...(EFFECT_PRESETS[effectType] ?? [])],
        affectedTrackIds: [],
        insertionIndex,
        regions: [],
        enabled: true,
        mix: 1,
        color: LAYER_COLORS[(state.layers.length) % LAYER_COLORS.length]!,
    };

    adjustmentLayerStore.set({ layers: [...state.layers, layer] });
}
