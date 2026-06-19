import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

// Beats are stored as floats and survive a save/load round-trip that can perturb
// them by a sub-tick amount. Matching with strict `!==` would then never match,
// turning a remove into a silent no-op. Compare with a tolerance well below one
// tick (1/480 of a quarter note) so an intended target is still removed.
const BEAT_EPSILON = 1e-6;

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
