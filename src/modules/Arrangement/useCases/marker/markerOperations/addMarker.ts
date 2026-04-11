import { markerStore } from '../../../stores/markerStore';
import { createMarker } from '../../../models/Marker';

export function addMarker(beat: number, name: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({ ...state, markers: [...state.markers, createMarker(beat, name)] });
}