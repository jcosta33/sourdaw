import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

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
