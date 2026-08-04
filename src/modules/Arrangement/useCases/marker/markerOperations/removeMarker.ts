import { markerStore } from '../../../stores/markerStore';

export function removeMarker(markerId: string): boolean {
    const state = markerStore.value;
    if (!state) {
        return false;
    }
    if (!state.markers.some((message) => message.id === markerId)) {
        return false;
    }
    markerStore.set({ ...state, markers: state.markers.filter((message) => message.id !== markerId) });
    return true;
}
