import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function toggleAdjustmentLayer(id: string): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((length) => (length.id === id ? { ...length, enabled: !length.enabled } : length)),
    });
}
