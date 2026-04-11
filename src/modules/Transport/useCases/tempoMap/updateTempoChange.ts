import { tempoMapStore } from '../../stores/tempoMapStore';

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