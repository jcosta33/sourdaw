import { adjustmentLayerStore, getNextRegionId, type AdjustmentRegion } from '../../stores/adjustmentLayer';

/**
 * Fade a new adjustment region gets at each edge when the caller names none —
 * long enough to hide the seam, short enough not to eat audible material. The
 * batch handler's replay fallback reads this same constant.
 */
export const DEFAULT_REGION_FADE_BEATS = 0.25;

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
        fadeInBeats: input.fadeInBeats ?? DEFAULT_REGION_FADE_BEATS,
        fadeOutBeats: input.fadeOutBeats ?? DEFAULT_REGION_FADE_BEATS,
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
