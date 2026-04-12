import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function removeAdjustmentLayer(id: string): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({ layers: state.layers.filter((l) => l.id !== id) });
}
