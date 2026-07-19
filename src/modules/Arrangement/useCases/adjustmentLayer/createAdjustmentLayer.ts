import {
    adjustmentLayerStore,
    getNextLayerId,
    EFFECT_PRESETS,
    LAYER_COLORS,
    type AdjustmentEffectType,
    type AdjustmentLayer,
} from '../../stores/adjustmentLayer';

export type CreateAdjustmentLayerInput = {
    name: string;
    effectType: AdjustmentEffectType;
    insertionIndex?: number;
    layerId?: string;
};

export function createAdjustmentLayer(input: CreateAdjustmentLayerInput): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }

    const layer: AdjustmentLayer = {
        id: input.layerId ?? getNextLayerId(),
        name: input.name,
        effectType: input.effectType,
        parameters: [...EFFECT_PRESETS[input.effectType]],
        affectedTrackIds: [],
        insertionIndex: input.insertionIndex ?? 0,
        regions: [],
        enabled: true,
        mix: 1,
        color: LAYER_COLORS[state.layers.length % LAYER_COLORS.length]!,
    };

    adjustmentLayerStore.set({ layers: [...state.layers, layer] });
}
