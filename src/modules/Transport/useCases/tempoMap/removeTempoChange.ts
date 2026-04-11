import { tempoMapStore } from '../../stores/tempoMapStore';

export function removeTempoChange(changeId: string): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }
    tempoMapStore.set({
        changes: state.changes.filter((c) => c.id !== changeId),
    });
}