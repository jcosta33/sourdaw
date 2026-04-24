import { type DrumEngineType } from '../../models/ToasterKit';
import { toasterStore } from '../../stores/toasterStore';

export function getSoundLock(deviceId: string, padIndex: number, stepIndex: number): DrumEngineType | null {
    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return null;
    }

    const pattern = state.kit.patterns.find((param) => param.id === state.kit.activePatternId);
    if (!pattern) {
        return null;
    }

    const track = pattern.tracks.find((time) => time.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return null;
    }

    return track.steps[stepIndex].soundLock ?? null;
}
