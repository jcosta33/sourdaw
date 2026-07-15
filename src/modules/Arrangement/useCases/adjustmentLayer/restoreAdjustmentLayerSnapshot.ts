import { adjustmentLayerStore, type AdjustmentLayer, type AdjustmentLayerState } from '../../stores/adjustmentLayer';

function cloneAdjustmentLayer(layer: AdjustmentLayer): AdjustmentLayer {
    return {
        id: layer.id,
        name: layer.name,
        effectType: layer.effectType,
        parameters: layer.parameters.map((parameter) => ({
            name: parameter.name,
            value: parameter.value,
            min: parameter.min,
            max: parameter.max,
            unit: parameter.unit,
        })),
        affectedTrackIds: [...layer.affectedTrackIds],
        insertionIndex: layer.insertionIndex,
        regions: layer.regions.map((region) => ({
            id: region.id,
            startBeat: region.startBeat,
            endBeat: region.endBeat,
            blend: region.blend,
            fadeInBeats: region.fadeInBeats,
            fadeOutBeats: region.fadeOutBeats,
        })),
        enabled: layer.enabled,
        mix: layer.mix,
        color: layer.color,
    };
}

export function restoreAdjustmentLayerSnapshot(snapshot: AdjustmentLayerState | undefined): void {
    adjustmentLayerStore.set({
        layers: snapshot?.layers.map(cloneAdjustmentLayer) ?? [],
    });
}
