import { markerStore } from '../../../stores/markerStore';

export function reorderSection(sectionId: string, direction: 'left' | 'right'): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    const sections = [...state.sections];
    const index = sections.findIndex((s) => s.id === sectionId);
    if (index < 0) {
        return;
    }
    const targetIndex = direction === 'left' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sections.length) {
        return;
    }

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