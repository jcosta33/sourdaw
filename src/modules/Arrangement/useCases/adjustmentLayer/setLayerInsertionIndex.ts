import { adjustmentLayerStore } from '../../stores/adjustmentLayer';

export function setLayerInsertionIndex(layerId: string, insertionIndex: number): void {
    const state = adjustmentLayerStore.value;
    if (!state) {
        return;
    }

    const safeIndex = Math.max(0, Math.floor(insertionIndex));

    adjustmentLayerStore.set({
        layers: state.layers.map((l) => (l.id === layerId ? { ...l, insertionIndex: safeIndex } : l)),
    });
}
