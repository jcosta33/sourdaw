import { BEAT_EPSILON } from '../../models/TempoMap';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

export function removeTimeSignatureChange(beat: number): void {
    const state = timeSignatureMapStore.value;
    if (!state) {
        return;
    }

    timeSignatureMapStore.set({
        ...state,
        changes: state.changes.filter((context) => Math.abs(context.beat - beat) > BEAT_EPSILON),
    });
}
