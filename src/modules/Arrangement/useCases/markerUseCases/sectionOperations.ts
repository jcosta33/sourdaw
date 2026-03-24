import { markerStore } from '../../stores/markerStore';
import { createSection } from '../../models/Marker';

export function addSection(startBeat: number, endBeat: number, name: string): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({ ...state, sections: [...state.sections, createSection(startBeat, endBeat, name)] });
}

export function removeSection(sectionId: string): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({ ...state, sections: state.sections.filter((s) => s.id !== sectionId) });
}

export function renameSection(sectionId: string, name: string): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({ ...state, sections: state.sections.map((s) => (s.id === sectionId ? { ...s, name } : s)) });
}

export function setSectionColor(sectionId: string, color: string): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({ ...state, sections: state.sections.map((s) => (s.id === sectionId ? { ...s, color } : s)) });
}

export function moveSection(sectionId: string, newStartBeat: number): void {
    const state = markerStore.value;
    if (!state) { return; }
    markerStore.set({
        ...state,
        sections: state.sections.map((s) => {
            if (s.id !== sectionId) { return s; }
            const duration = s.endBeat - s.startBeat;
            const startBeat = Math.max(0, Math.round(newStartBeat));
            return { ...s, startBeat, endBeat: startBeat + duration };
        }),
    });
}

export function resizeSection(sectionId: string, newStartBeat: number, newEndBeat: number): void {
    const state = markerStore.value;
    if (!state) { return; }
    const MIN_DURATION = 4;
    markerStore.set({
        ...state,
        sections: state.sections.map((s) => {
            if (s.id !== sectionId) { return s; }
            const startBeat = Math.max(0, Math.round(newStartBeat));
            const endBeat = Math.max(startBeat + MIN_DURATION, Math.round(newEndBeat));
            return { ...s, startBeat, endBeat };
        }),
    });
}

export function reorderSection(sectionId: string, direction: 'left' | 'right'): void {
    const state = markerStore.value;
    if (!state) { return; }
    const sections = [...state.sections];
    const index = sections.findIndex((s) => s.id === sectionId);
    if (index < 0) { return; }
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) { return; }

    const current = sections[index]!;
    const neighbor = sections[targetIndex]!;
    const currentDuration = current.endBeat - current.startBeat;
    const neighborDuration = neighbor.endBeat - neighbor.startBeat;

    if (direction === 'left') {
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
}
