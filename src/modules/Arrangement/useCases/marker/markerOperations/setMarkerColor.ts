import { markerStore } from '../../../stores/markerStore';

export function setMarkerColor(markerId: string, color: string): boolean {
    const state = markerStore.value;
    if (!state) {
        return false;
    }
    const marker = state.markers.find((candidate) => candidate.id === markerId);
    if (!marker || marker.color === color) {
        return false;
    }
    markerStore.set({
        ...state,
        markers: state.markers.map((message) => (message.id === markerId ? { ...message, color } : message)),
    });
    return true;
}
