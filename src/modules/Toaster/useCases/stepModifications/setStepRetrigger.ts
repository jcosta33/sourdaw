import { toasterStore } from '../../stores/toasterStore';

export function setStepRetrigger(deviceId: string, padIndex: number, stepIndex: number, retriggerCount: number): void {
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

    const clampedCount = Math.max(0, Math.min(16, Math.round(retriggerCount)));

    const newSteps = [...track.steps];
    newSteps[stepIndex] = {
        ...newSteps[stepIndex]!,
        retriggerCount: clampedCount,
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
