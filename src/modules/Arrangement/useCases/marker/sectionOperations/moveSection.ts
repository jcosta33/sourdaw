import { markerStore } from '../../../stores/markerStore';

export function moveSection(sectionId: string, newStartBeat: number): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({
        ...state,
        sections: state.sections.map((s) => {
            if (s.id !== sectionId) {
                return s;
            }
            const duration = s.endBeat - s.startBeat;
            const startBeat = Math.max(0, Math.round(newStartBeat));
            return { ...s, startBeat, endBeat: startBeat + duration };
        }),
    });
}