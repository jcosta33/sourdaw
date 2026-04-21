import { takeLaneStore } from '../../stores/takeLaneStore';

export function flattenComp(trackId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.filter((length) => length.trackId !== trackId),
    });
}
