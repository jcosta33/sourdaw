import { type DrumEngineType } from '../../models/ToasterKit';
import { toasterStore } from '../../stores/toasterStore';

export function setSoundLock(
    deviceId: string,
    padIndex: number,
    stepIndex: number,
    engineType: DrumEngineType | null
): void {
    const state = toasterStore.value?.[deviceId];
    if (!state) {
        return;
    }

    const pattern = state.kit.patterns.find((param) => param.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }

    const track = pattern.tracks.find((time) => time.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return;
    }

    const newSteps = [...track.steps];
    const step = { ...newSteps[stepIndex]! };

    if (engineType) {
        step.soundLock = engineType;
    } else {
        delete step.soundLock;
    }

    newSteps[stepIndex] = step;

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({ ...toasterStore.value, [deviceId]: { ...state, kit: { ...state.kit, patterns: newPatterns } } });
}
