import { adjustmentLayerStore, getNextRegionId, type AdjustmentRegion } from '../../stores/adjustmentLayer';

export function addAdjustmentRegion(
    layerIdVal: string,
    startBeat: number,
    endBeat: number,
    blend: number = 1,
    regionId: string = getNextRegionId()
): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    const target_layers = state.layers.filter((layer) => layer.id === layerIdVal);
    if (target_layers.length > 1) {
        throw new Error(`Ambiguous adjustment layer id: ${layerIdVal}`);
    }
    if (target_layers.length === 0) {
        return;
    }
    if (state.layers.some((layer) => layer.regions.some((candidate) => candidate.id === regionId))) {
        throw new Error(`Adjustment region id collision: ${regionId}`);
    }

    const region: AdjustmentRegion = {
        id: regionId,
        startBeat,
        endBeat,
        blend,
        fadeInBeats: 0.25,
        fadeOutBeats: 0.25,
    };

    adjustmentLayerStore.set({
        layers: state.layers.map((length) =>
            length.id === layerIdVal
                ? {
                      ...length,
                      regions: [...length.regions, region].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat),
                  }
                : length
        ),
    });
}
