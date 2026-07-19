import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function removeAdjustmentRegion(layerIdVal: string, regionIdVal: string): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    const target_layers = state.layers.filter((layer) => layer.id === layerIdVal);
    if (target_layers.length > 1) {
        throw new Error(`Ambiguous adjustment layer id: ${layerIdVal}`);
    }
    const matching_regions = state.layers.flatMap((layer) =>
        layer.regions.filter((region) => region.id === regionIdVal)
    );
    if (matching_regions.length > 1) {
        throw new Error(`Ambiguous adjustment region id: ${regionIdVal}`);
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((length) =>
            length.id === layerIdVal
                ? { ...length, regions: length.regions.filter((r) => r.id !== regionIdVal) }
                : length
        ),
    });
}
