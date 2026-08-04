import { markerStore } from '../../../stores/markerStore';

export function renameSection(sectionId: string, name: string): boolean {
    const state = markerStore.value;
    if (!state) {
        return false;
    }
    const section = state.sections.find((candidate) => candidate.id === sectionId);
    if (!section || section.name === name) {
        return false;
    }
    markerStore.set({
        ...state,
        sections: state.sections.map((state1) => (state1.id === sectionId ? { ...state1, name } : state1)),
    });
    return true;
}
