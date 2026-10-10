import { BEAT_EPSILON, createTempoChange, type TempoChange } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';

export function addTempoChange(beat: number, tempo: number, curve: TempoChange['curve'] = 'instant'): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }

    // Changes sharing a beat arrive at the first and govern from the last, so
    // the last one is the change an edit at this beat rewrites.
    const existing = state.changes.findLastIndex((context) => Math.abs(context.beat - beat) <= BEAT_EPSILON);
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
