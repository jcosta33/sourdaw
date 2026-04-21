import { createTempoChange, type TempoChange } from '../../models/TempoMap';
import { tempoMapStore } from '../../stores/tempoMapStore';

export function addTempoChange(beat: number, tempo: number, curve: TempoChange['curve'] = 'instant'): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }

    const existing = state.changes.findIndex((context) => context.beat === beat);
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
