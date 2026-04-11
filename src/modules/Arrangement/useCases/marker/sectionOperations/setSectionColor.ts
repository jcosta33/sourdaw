import { markerStore } from '../../../stores/markerStore';

export function setSectionColor(sectionId: string, color: string): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({ ...state, sections: state.sections.map((s) => (s.id === sectionId ? { ...s, color } : s)) });
}