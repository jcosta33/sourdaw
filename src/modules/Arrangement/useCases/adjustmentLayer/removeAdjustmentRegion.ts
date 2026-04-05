import { adjustmentLayerStore } from '#/modules/Arrangement/stores/adjustmentLayer';

export function removeAdjustmentRegion(layerIdVal: string, regionIdVal: string): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((l) =>
            l.id === layerIdVal ? { ...l, regions: l.regions.filter((r) => r.id !== regionIdVal) } : l
        ),
    });
}
