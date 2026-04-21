import { createTimeSignatureChange } from '../../models/TimeSignatureMap';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

export function addTimeSignatureChange(beat: number, numerator: number, denominator: number): void {
    const state = timeSignatureMapStore.value;
    if (!state) {
        return;
    }

    const existing = state.changes.find((context) => context.beat === beat);
    if (existing) {
        timeSignatureMapStore.set({
            ...state,
            changes: state.changes.map((context) => (context.beat === beat ? { ...context, numerator, denominator } : context)),
        });
        return;
    }

    const change = createTimeSignatureChange(beat, numerator, denominator);
    timeSignatureMapStore.set({
        ...state,
        changes: [...state.changes, change].sort((alpha, b) => alpha.beat - b.beat),
    });
}
