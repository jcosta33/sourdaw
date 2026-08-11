import { adjustmentLayerStore, getNextRegionId, type AdjustmentRegion } from '../../stores/adjustmentLayer';

export type AddAdjustmentRegionInput = {
    layerId: string;
    startBeat: number;
    endBeat: number;
    blend?: number;
    fadeInBeats?: number;
    fadeOutBeats?: number;
    regionId?: string;
};

export function addAdjustmentRegion(input: AddAdjustmentRegionInput): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }

    const region: AdjustmentRegion = {
        id: input.regionId ?? getNextRegionId(),
        startBeat: input.startBeat,
        endBeat: input.endBeat,
        blend: input.blend ?? 1,
        fadeInBeats: input.fadeInBeats ?? 0.25,
        fadeOutBeats: input.fadeOutBeats ?? 0.25,
    };

    adjustmentLayerStore.set({
        layers: state.layers.map((length) =>
            length.id === input.layerId
                ? {
                      ...length,
                      regions: [...length.regions, region].sort((alpha, buffer) => alpha.startBeat - buffer.startBeat),
                  }
                : length
        ),
    });
}
