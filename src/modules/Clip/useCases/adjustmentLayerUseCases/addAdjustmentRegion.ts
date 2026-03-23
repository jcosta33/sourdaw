import { adjustmentLayerStore, getNextRegionId, type AdjustmentRegion } from '#/modules/Clip/stores/adjustmentLayer';

export function addAdjustmentRegion(
    layerIdVal: string,
    startBeat: number,
    endBeat: number,
    blend: number = 1
): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }

    const region: AdjustmentRegion = {
        id: getNextRegionId(),
        startBeat,
        endBeat,
        blend,
        fadeInBeats: 0.25,
        fadeOutBeats: 0.25,
    };

    adjustmentLayerStore.set({
        layers: state.layers.map((l) =>
            l.id === layerIdVal
                ? { ...l, regions: [...l.regions, region].sort((a, b) => a.startBeat - b.startBeat) }
                : l
        ),
    });
}
