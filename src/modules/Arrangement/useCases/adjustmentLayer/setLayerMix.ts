import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function setLayerMix(id: string, mix: number): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }
    adjustmentLayerStore.set({
        layers: state.layers.map((length) => (length.id === id ? { ...length, mix: Math.max(0, Math.min(1, mix)) } : length)),
    });
}
