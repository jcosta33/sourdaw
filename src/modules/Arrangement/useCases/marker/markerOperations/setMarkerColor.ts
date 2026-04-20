import { markerStore } from '../../../stores/markerStore';

export function setMarkerColor(markerId: string, color: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({ ...state, markers: state.markers.map((m) => (m.id === markerId ? { ...m, color } : m)) });
}
