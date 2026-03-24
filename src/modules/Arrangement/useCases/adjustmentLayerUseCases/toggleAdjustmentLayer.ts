import { adjustmentLayerStore } from '#/modules/Arrangement/stores/adjustmentLayer';

export function toggleAdjustmentLayer(id: string): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((l) =>
            l.id === id ? { ...l, enabled: !l.enabled } : l
        ),
    });
}
