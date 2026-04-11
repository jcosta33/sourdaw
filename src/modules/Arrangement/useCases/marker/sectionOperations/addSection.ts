import { markerStore } from '../../../stores/markerStore';
import { createSection } from '../../../models/Marker';

export function addSection(startBeat: number, endBeat: number, name: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({ ...state, sections: [...state.sections, createSection(startBeat, endBeat, name)] });
}