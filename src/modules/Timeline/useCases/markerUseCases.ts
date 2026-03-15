import { markerStore } from "../stores/markerStore";
import { createMarker, createSection } from "../models/Marker";

export const addMarker = (beat: number, name: string): void => {
    const state = markerStore.value;
    if (!state) return;
    markerStore.set({
        ...state,
        markers: [...state.markers, createMarker(beat, name)],
    });
};

export const removeMarker = (markerId: string): void => {
    const state = markerStore.value;
    if (!state) return;
    markerStore.set({
        ...state,
        markers: state.markers.filter((m) => m.id !== markerId),
    });
};

export const renameMarker = (markerId: string, name: string): void => {
    const state = markerStore.value;
    if (!state) return;
    markerStore.set({
        ...state,
        markers: state.markers.map((m) => m.id === markerId ? { ...m, name } : m),
    });
};

export const addSection = (startBeat: number, endBeat: number, name: string): void => {
    const state = markerStore.value;
    if (!state) return;
    markerStore.set({
        ...state,
        sections: [...state.sections, createSection(startBeat, endBeat, name)],
    });
};

export const removeSection = (sectionId: string): void => {
    const state = markerStore.value;
    if (!state) return;
    markerStore.set({
        ...state,
        sections: state.sections.filter((s) => s.id !== sectionId),
    });
};
