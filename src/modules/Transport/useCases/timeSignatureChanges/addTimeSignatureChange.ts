import { createTimeSignatureChange } from '../../models/TimeSignatureMap';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

// Beats are floats that drift by a sub-tick amount across a save/load round-trip.
// Strict float `===` keying can then miss an existing change at the "same" beat,
// inserting a duplicate instead of updating it. Match within a tolerance well
// below one tick (1/480 of a quarter note) — mirrors `addTempoChange` and
// `removeTimeSignatureChange`.
const BEAT_EPSILON = 1e-6;

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
