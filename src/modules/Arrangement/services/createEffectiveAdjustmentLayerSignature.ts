type EffectiveAdjustmentLayer = {
    enabled: boolean;
    affectedTrackIds: readonly string[];
    insertionIndex: number;
    effectType: string;
    parameters: readonly unknown[];
    regions: readonly unknown[];
    mix: number;
};

type CreateEffectiveAdjustmentLayerSignatureInput = {
    layers: readonly EffectiveAdjustmentLayer[];
    orderedTrackIds: readonly string[];
    trackId: string;
};

export function createEffectiveAdjustmentLayerSignature(input: CreateEffectiveAdjustmentLayerSignatureInput): string {
    const trackIndex = input.orderedTrackIds.indexOf(input.trackId);
    if (trackIndex < 0) {
        return '[]';
    }

    const effectiveLayers = input.layers
        .filter((layer) => {
            if (!layer.enabled) {
                return false;
            }
            if (layer.affectedTrackIds.length > 0) {
                return layer.affectedTrackIds.includes(input.trackId);
            }
            return trackIndex >= layer.insertionIndex;
        })
        .map((layer) => ({
            effectType: layer.effectType,
            parameters: layer.parameters,
            regions: layer.regions,
            mix: layer.mix,
        }));
    return JSON.stringify(effectiveLayers);
}
