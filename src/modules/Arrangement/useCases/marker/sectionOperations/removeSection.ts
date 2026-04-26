import { markerStore } from '../../../stores/markerStore';

export function removeSection(sectionId: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({ ...state, sections: state.sections.filter((state1) => state1.id !== sectionId) });
}
