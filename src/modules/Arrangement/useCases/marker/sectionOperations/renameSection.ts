import { markerStore } from '../../../stores/markerStore';

export function renameSection(sectionId: string, name: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({
        ...state,
        sections: state.sections.map((state1) => (state1.id === sectionId ? { ...state1, name } : state1)),
    });
}
