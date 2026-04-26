import { markerStore } from '../../../stores/markerStore';

export function moveSection(sectionId: string, newStartBeat: number): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    markerStore.set({
        ...state,
        sections: state.sections.map((state1) => {
            if (state1.id !== sectionId) {
                return state1;
            }
            const duration = state1.endBeat - state1.startBeat;
            const startBeat = Math.max(0, Math.round(newStartBeat));
            return { ...state1, startBeat, endBeat: startBeat + duration };
        }),
    });
}
