import { markerStore } from '../../stores/markerStore';
import { createMarker } from '../../models/Marker';

export function addMarker(beat: number, name: string): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({ ...state, markers: [...state.markers, createMarker(beat, name)] });
}

export function removeMarker(markerId: string): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({ ...state, markers: state.markers.filter((m) => m.id !== markerId) });
}

export function renameMarker(markerId: string, name: string): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({ ...state, markers: state.markers.map((m) => (m.id === markerId ? { ...m, name } : m)) });
}

export function setMarkerColor(markerId: string, color: string): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({ ...state, markers: state.markers.map((m) => (m.id === markerId ? { ...m, color } : m)) });
}

export function moveMarker(markerId: string, newBeat: number): void {
    const state = markerStore.value;
    if (!state) { return; }
    const beat = Math.max(0, Math.round(newBeat));
    markerStore.set({ ...state, markers: state.markers.map((m) => (m.id === markerId ? { ...m, beat } : m)) });
}
