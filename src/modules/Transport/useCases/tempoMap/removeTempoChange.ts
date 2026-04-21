import { tempoMapStore } from '../../stores/tempoMapStore';

export function removeTempoChange(changeId: string): void {
    const state = tempoMapStore.value;
    if (!state) {
        return;
    }
    tempoMapStore.set({
        changes: state.changes.filter((context) => context.id !== changeId),
    });
}
