import { createTimeSignatureChange } from '../../models/TimeSignatureMap';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

export function addTimeSignatureChange(beat: number, numerator: number, denominator: number): void {
    const state = timeSignatureMapStore.value;
    if (!state) {
        return;
    }

    const existing = state.changes.find((c) => c.beat === beat);
    if (existing) {
        timeSignatureMapStore.set({
            ...state,
            changes: state.changes.map((c) => (c.beat === beat ? { ...c, numerator, denominator } : c)),
        });
        return;
    }

    const change = createTimeSignatureChange(beat, numerator, denominator);
    timeSignatureMapStore.set({
        ...state,
        changes: [...state.changes, change].sort((a, b) => a.beat - b.beat),
    });
}
