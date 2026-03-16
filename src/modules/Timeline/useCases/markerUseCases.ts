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

export const setMarkerColor = (markerId: string, color: string): void => {
    const state = markerStore.value;
    if (!state) return;
    markerStore.set({
        ...state,
        markers: state.markers.map((m) => m.id === markerId ? { ...m, color } : m),
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

export const renameSection = (sectionId: string, name: string): void => {
    const state = markerStore.value;
    if (!state) return;
    markerStore.set({
        ...state,
        sections: state.sections.map((s) => s.id === sectionId ? { ...s, name } : s),
    });
};

export const setSectionColor = (sectionId: string, color: string): void => {
    const state = markerStore.value;
    if (!state) return;
    markerStore.set({
        ...state,
        sections: state.sections.map((s) => s.id === sectionId ? { ...s, color } : s),
    });
};

export const reorderSection = (sectionId: string, direction: "left" | "right"): void => {
    const state = markerStore.value;
    if (!state) return;

    const sections = [...state.sections];
    const index = sections.findIndex((s) => s.id === sectionId);
    if (index < 0) return;

    const targetIndex = direction === "left" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) return;

    const current = sections[index]!;
    const neighbor = sections[targetIndex]!;

    const currentDuration = current.endBeat - current.startBeat;
    const neighborDuration = neighbor.endBeat - neighbor.startBeat;

    if (direction === "left") {
        const newCurrentStart = neighbor.startBeat;
        const newNeighborStart = newCurrentStart + currentDuration;
        sections[targetIndex] = { ...current, startBeat: newCurrentStart, endBeat: newCurrentStart + currentDuration };
        sections[index] = { ...neighbor, startBeat: newNeighborStart, endBeat: newNeighborStart + neighborDuration };
    } else {
        const newNeighborStart = current.startBeat;
        const newCurrentStart = newNeighborStart + neighborDuration;
        sections[index] = { ...neighbor, startBeat: newNeighborStart, endBeat: newNeighborStart + neighborDuration };
        sections[targetIndex] = { ...current, startBeat: newCurrentStart, endBeat: newCurrentStart + currentDuration };
    }

    markerStore.set({ ...state, sections });
};
