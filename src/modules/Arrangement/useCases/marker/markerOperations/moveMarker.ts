import { markerStore } from '../../../stores/markerStore';

export function moveMarker(markerId: string, newBeat: number): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    const beat = Math.max(0, Math.round(newBeat));
    markerStore.set({ ...state, markers: state.markers.map((m) => (m.id === markerId ? { ...m, beat } : m)) });
}
