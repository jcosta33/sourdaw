import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function removeAdjustmentRegion(layerIdVal: string, regionIdVal: string): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((length) =>
            length.id === layerIdVal ? { ...length, regions: length.regions.filter((r) => r.id !== regionIdVal) } : length
        ),
    });
}
