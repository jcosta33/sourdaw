import { markerStore } from '../../../stores/markerStore';

export function removeSection(sectionId: string): boolean {
    const state = markerStore.value;
    if (!state) {
        return false;
    }
    if (!state.sections.some((section) => section.id === sectionId)) {
        return false;
    }
    markerStore.set({ ...state, sections: state.sections.filter((state1) => state1.id !== sectionId) });
    return true;
}
