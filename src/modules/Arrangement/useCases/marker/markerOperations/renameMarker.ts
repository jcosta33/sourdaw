import { markerStore } from '../../../stores/markerStore';

export function renameMarker(markerId: string, name: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({
        ...state,
        markers: state.markers.map((message) => (message.id === markerId ? { ...message, name } : message)),
    });
}
