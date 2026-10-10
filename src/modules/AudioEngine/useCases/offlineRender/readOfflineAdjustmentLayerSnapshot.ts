import { adjustmentLayerStore } from '#/modules/Arrangement/stores';

/** The render snapshot of the live layer stack, so a long render reads one state. */
export function readOfflineAdjustmentLayerSnapshot() {
    return structuredClone(adjustmentLayerStore.value?.layers ?? []);
}
