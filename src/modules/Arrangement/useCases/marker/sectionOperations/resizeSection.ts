import { markerStore } from '../../../stores/markerStore';

export function resizeSection(sectionId: string, newStartBeat: number, newEndBeat: number): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    const MIN_DURATION = 4;
    markerStore.set({
        ...state,
        sections: state.sections.map((state1) => {
            if (state1.id !== sectionId) {
                return state1;
            }
            const startBeat = Math.max(0, Math.round(newStartBeat));
            const endBeat = Math.max(startBeat + MIN_DURATION, Math.round(newEndBeat));
            return { ...state1, startBeat, endBeat };
        }),
    });
}
