import { markerStore } from '../../../stores/markerStore';

export function removeMarker(markerId: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({ ...state, markers: state.markers.filter((m) => m.id !== markerId) });
}
