import { timeSignatureMapStore } from '../stores/timeSignatureMapStore';
import { createTimeSignatureChange } from '../models/TimeSignatureMap';

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

export function removeTimeSignatureChange(beat: number): void {
    const state = timeSignatureMapStore.value;
    if (!state) {
        return;
    }

    timeSignatureMapStore.set({
        ...state,
        changes: state.changes.filter((c) => c.beat !== beat),
    });
}

export function getTimeSignatureChanges(): readonly import('../models/TimeSignatureMap').TimeSignatureChange[] {
    return timeSignatureMapStore.value?.changes ?? [];
}
