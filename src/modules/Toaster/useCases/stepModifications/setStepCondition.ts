import { type StepCondition } from '../../models/ToasterKit';
import { toasterStore } from '../../stores/toasterStore';

export function setStepCondition(
    deviceId: string,
    padIndex: number,
    stepIndex: number,
    condition: StepCondition
): void {
    const instances = toasterStore.value ?? {};
    const state = instances[deviceId];
    if (!state) {
        return;
    }

    const pattern = state.kit.patterns.find((p) => p.id === state.kit.activePatternId);
    if (!pattern) {
        return;
    }

    const track = pattern.tracks.find((t) => t.padIndex === padIndex);
    if (!track || !track.steps[stepIndex]) {
        return;
    }

    const newSteps = [...track.steps];
    newSteps[stepIndex] = {
        ...newSteps[stepIndex]!,
        condition,
    };

    const newTracks = pattern.tracks.map((t) => (t.padIndex === padIndex ? { ...t, steps: newSteps } : t));
    const newPatterns = state.kit.patterns.map((p) => (p.id === pattern.id ? { ...p, tracks: newTracks } : p));
    toasterStore.set({
        ...instances,
        [deviceId]: {
            ...state,
            kit: {
                ...state.kit,
                patterns: newPatterns,
            },
        },
    });
}
