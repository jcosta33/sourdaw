import { markerStore } from '../../../stores/markerStore';

export function resizeSection(sectionId: string, newStartBeat: number, newEndBeat: number): void {
    const state = markerStore.value;
    if (!state) {
        return;
    }
    const MIN_DURATION = 4;
    markerStore.set({
        ...state,
        sections: state.sections.map((s) => {
            if (s.id !== sectionId) {
                return s;
            }
            const startBeat = Math.max(0, Math.round(newStartBeat));
            const endBeat = Math.max(startBeat + MIN_DURATION, Math.round(newEndBeat));
            return { ...s, startBeat, endBeat };
        }),
    });
}