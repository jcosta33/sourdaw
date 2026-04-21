import { projectStore } from '#/modules/Project/stores';
import { SCALE_PATTERNS } from '#/utils/Music/MusicalScale';

import { stepRecordStore } from '../../stores/stepRecordStore';

export function stepRecordAdvance(): void {
    const state = stepRecordStore.value;
    if (!state || !state.active) {
        return;
    }

    stepRecordStore.set({
        ...state,
        currentBeat: state.currentBeat + state.stepSize,
    });
}

export function stepRecordRetreat(): void {
    const state = stepRecordStore.value;
    if (!state || !state.active) {
        return;
    }

    stepRecordStore.set({
        ...state,
        currentBeat: Math.max(0, state.currentBeat - state.stepSize),
    });
}

export function stepRecordStepUp(): void {
    const state = stepRecordStore.value;
    const project = projectStore.value;
    if (!state || !state.active || !project) {
        return;
    }

    const pattern = SCALE_PATTERNS[project.scaleName] ?? SCALE_PATTERNS.chromatic!;
    const root = project.keyRoot;

    let nextPitch: number;
    if (pattern.length > 0 && pattern.length < 12) {
        // Simple diatonic step
        const currentPc = (((state.currentPitch - root) % 12) + 12) % 12;
        let degree = pattern.indexOf(currentPc);

        if (degree === -1) {
            // Force to nearest scale degree
            degree = pattern.findIndex((param) => param > currentPc);
            if (degree === -1) {
                degree = 0;
            }
        }

        const nextDegree = (degree + 1) % pattern.length;
        const octShift = nextDegree === 0 ? 12 : 0;
        nextPitch = state.currentPitch - currentPc + pattern[nextDegree]! + octShift;
    } else {
        nextPitch = state.currentPitch + 1;
    }

    stepRecordStore.set({ ...state, currentPitch: Math.min(127, nextPitch) });
}

export function stepRecordStepDown(): void {
    const state = stepRecordStore.value;
    const project = projectStore.value;
    if (!state || !state.active || !project) {
        return;
    }

    const pattern = SCALE_PATTERNS[project.scaleName] ?? SCALE_PATTERNS.chromatic!;
    const root = project.keyRoot;

    let nextPitch: number;
    if (pattern.length > 0 && pattern.length < 12) {
        const currentPc = (((state.currentPitch - root) % 12) + 12) % 12;
        let degree = pattern.indexOf(currentPc);

        if (degree === -1) {
            degree = pattern.findIndex((param) => param > currentPc);
            if (degree === -1) {
                degree = pattern.length - 1;
            } else {
                degree = Math.max(0, degree - 1);
            }
        }

        const nextDegree = (degree - 1 + pattern.length) % pattern.length;
        const octShift = nextDegree === pattern.length - 1 ? -12 : 0;
        nextPitch = state.currentPitch - currentPc + pattern[nextDegree]! + octShift;
    } else {
        nextPitch = state.currentPitch - 1;
    }

    stepRecordStore.set({ ...state, currentPitch: Math.max(0, nextPitch) });
}
