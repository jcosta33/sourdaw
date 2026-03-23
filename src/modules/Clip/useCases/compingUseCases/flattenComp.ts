import { takeLaneStore } from '#/modules/Clip/stores/takeLaneStore';

export function flattenComp(trackId: string): void {
    const state = takeLaneStore.value;
    if (!state) {
        return;
    }

    takeLaneStore.set({
        lanes: state.lanes.filter((l) => l.trackId !== trackId),
    });
}
