import { adjustmentLayerStore, type AdjustmentLayer } from '#/modules/Arrangement/stores';

import { getSharedAdjustmentLayerApplier } from './sharedAdjustmentLayerApplier';

function readActiveLayersAtBeat(beat: number): AdjustmentLayer[] {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return [];
    }
    return state.layers.filter((layer) => {
        if (!layer.enabled) {
            return false;
        }
        if (layer.regions.length === 0) {
            return true;
        }
        return layer.regions.some((region) => beat >= region.startBeat && beat < region.endBeat);
    });
}

/**
 * Called from the playhead scheduler tick. Resolves the active layers at the
 * given beat and applies them via the shared applier. Returns the applied
 * records so callers (and tests) can inspect what was scheduled.
 */
export function scheduleAdjustmentLayers(beat: number) {
    const activeLayers = readActiveLayersAtBeat(beat);
    const applier = getSharedAdjustmentLayerApplier();
    return applier.applyLayers({ activeLayers, beat });
}
