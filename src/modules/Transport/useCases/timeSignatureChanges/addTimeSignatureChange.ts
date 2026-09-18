import { BEAT_EPSILON } from '../../models/TempoMap';
import { createTimeSignatureChange } from '../../models/TimeSignatureMap';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

export function addTimeSignatureChange(beat: number, numerator: number, denominator: number): void {
    const state = timeSignatureMapStore.value;
    if (!state) {
        return;
    }

    const existing = state.changes.find((context) => Math.abs(context.beat - beat) <= BEAT_EPSILON);
    if (existing) {
        timeSignatureMapStore.set({
            ...state,
            changes: state.changes.map((context) =>
                Math.abs(context.beat - beat) <= BEAT_EPSILON ? { ...context, numerator, denominator } : context
            ),
        });
        return;
    }

    const change = createTimeSignatureChange(beat, numerator, denominator);
    timeSignatureMapStore.set({
        ...state,
        changes: [...state.changes, change].sort((alpha, b) => alpha.beat - b.beat),
    });
}
