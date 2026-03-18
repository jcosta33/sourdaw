import { tempoMapStore } from '../stores/tempoMapStore';
import { createTempoChange, type TempoChange } from '../models/TempoMap';

export function addTempoChange(beat: number, tempo: number, curve: TempoChange['curve'] = 'instant'): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }

    const existing = state.changes.findIndex((c) => c.beat === beat);
    if (existing >= 0) {
        tempoMapStore.set({
            changes: state.changes.map((c, i) => (i === existing ? { ...c, tempo, curve } : c)),
        });
        return;
    }

    tempoMapStore.set({
        changes: [...state.changes, createTempoChange(beat, tempo, curve)].sort((a, b) => a.beat - b.beat),
    });
}

export function removeTempoChange(changeId: string): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }
    tempoMapStore.set({
        changes: state.changes.filter((c) => c.id !== changeId),
    });
}

export function updateTempoChange(changeId: string, tempo: number): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }
    tempoMapStore.set({
        changes: state.changes.map((c) =>
            c.id === changeId ? { ...c, tempo: Math.max(20, Math.min(999, tempo)) } : c
        ),
    });
}
