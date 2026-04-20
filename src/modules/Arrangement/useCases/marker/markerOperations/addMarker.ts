import { createMarker } from '../../../models/Marker';
import { markerStore } from '../../../stores/markerStore';

export function addMarker(beat: number, name: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({ ...state, markers: [...state.markers, createMarker(beat, name)] });
}
