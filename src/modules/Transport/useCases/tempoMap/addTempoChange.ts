import { createTempoChange, type TempoChange } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';

// Beats are floats that drift by a sub-tick amount across a save/load round-trip.
// Strict float `===` keying can then miss an existing change at the "same" beat,
// inserting a duplicate instead of updating it. Match within a tolerance well
// below one tick (1/480 of a quarter note).
const BEAT_EPSILON = 1e-6;

export function addTempoChange(beat: number, tempo: number, curve: TempoChange['curve'] = 'instant'): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }

    const existing = state.changes.findIndex((context) => Math.abs(context.beat - beat) <= BEAT_EPSILON);
    if (existing >= 0) {
        tempoMapStore.set({
            changes: state.changes.map((context, index) =>
                index === existing ? { ...context, tempo, curve } : context
            ),
        });
        return;
    }

    tempoMapStore.set({
        changes: [...state.changes, createTempoChange(beat, tempo, curve)].sort((alpha, b) => alpha.beat - b.beat),
    });
}
