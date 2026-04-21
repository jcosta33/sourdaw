import { type DrumEngineType } from '../../models/ToasterKit';
import { toasterStore } from '../../stores/toasterStore';

export function setSoundLock(padIndex: number, stepIndex: number, engineType: DrumEngineType | null): void {
    const state = toasterStore.value;
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

    const newTracks = pattern.tracks.map((time) => (time.padIndex === padIndex ? { ...time, steps: newSteps } : time));
    const newPatterns = state.kit.patterns.map((param) => (param.id === pattern.id ? { ...param, tracks: newTracks } : param));
    toasterStore.set({ ...state, kit: { ...state.kit, patterns: newPatterns } });
}
