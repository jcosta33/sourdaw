import { toasterStore } from '../../stores/toasterStore';
import { type DrumEngineType } from '../../models/ToasterKit';

export function getSoundLock(padIndex: number, stepIndex: number): DrumEngineType | null {
    const state = toasterStore.value;
    if (!state) {
        return null;
    }

    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return null;
    }

    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return null;
    }

    return track.steps[stepIndex]!.soundLock ?? null;
}