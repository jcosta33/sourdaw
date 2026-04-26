import { markerStore } from '../../../stores/markerStore';

export function setSectionColor(sectionId: string, color: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({
        ...state,
        sections: state.sections.map((state1) => (state1.id === sectionId ? { ...state1, color } : state1)),
    });
}
