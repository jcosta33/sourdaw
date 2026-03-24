import { adjustmentLayerStore } from '#/modules/Arrangement/stores/adjustmentLayer';

export function setLayerMix(id: string, mix: number): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((l) =>
            l.id === id ? { ...l, mix: Math.max(0, Math.min(1, mix)) } : l
        ),
    });
}
