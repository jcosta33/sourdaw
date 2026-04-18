import { stepRecordStore } from '../../stores/stepRecordStore';
import { projectStore } from '#/modules/Project';
import { SCALE_PATTERNS } from '#/utils/Music/MusicalScale';

export function stepRecordAdvance(): void {
    const state = stepRecordStore.value;
    if (!state.active) return;
    
    stepRecordStore.set({
        ...state,
        currentBeat: state.currentBeat + state.stepSize
    });
}

export function stepRecordRetreat(): void {
    const state = stepRecordStore.value;
    if (!state.active) return;
    
    stepRecordStore.set({
        ...state,
        currentBeat: Math.max(0, state.currentBeat - state.stepSize)
    });
}

export function stepRecordStepUp(semitones = 1): void {
    const state = stepRecordStore.value;
    if (!state.active) return;

    const project = projectStore.value;
    const pattern = SCALE_PATTERNS[project.scaleName] || SCALE_PATTERNS.chromatic;
    const root = project.keyRoot;

    let nextPitch = state.currentPitch;
    if (pattern.length > 0 && pattern.length < 12) {
        // Move to next scale degree
        const currentPc = (((state.currentPitch - root) % 12) + 12) % 12;
        let degree = pattern.indexOf(currentPc);
        if (degree === -1) {
            // If not in scale, find next higher degree
            degree = pattern.findIndex((p) => p > currentPc);
            if (degree === -1) {
                // Wrap to next octave
                nextPitch = Math.floor((state.currentPitch - root) / 12) * 12 + 12 + root + pattern[0]!;
            } else {
                nextPitch = Math.floor((state.currentPitch - root) / 12) * 12 + root + pattern[degree]!;
            }
        } else {
            degree = (degree + 1) % pattern.length;
            const octaveShift = degree === 0 ? 12 : 0;
            nextPitch = state.currentPitch - currentPc + pattern[degree]! + octaveShift;
        }
    } else {
        nextPitch += semitones;
    }

    stepRecordStore.set({
        ...state,
        currentPitch: Math.min(127, nextPitch)
    });
}

export function stepRecordStepDown(semitones = 1): void {
    const state = stepRecordStore.value;
    if (!state.active) return;

    const project = projectStore.value;
    const pattern = SCALE_PATTERNS[project.scaleName] || SCALE_PATTERNS.chromatic;
    const root = project.keyRoot;

    let nextPitch = state.currentPitch;
    if (pattern.length > 0 && pattern.length < 12) {
        // Move to previous scale degree
        const currentPc = (((state.currentPitch - root) % 12) + 12) % 12;
        let degree = pattern.indexOf(currentPc);
        if (degree === -1) {
            // If not in scale, find next lower degree
            degree = [...pattern].reverse().findIndex((p) => p < currentPc);
            if (degree === -1) {
                // Wrap to previous octave
                nextPitch = Math.floor((state.currentPitch - root) / 12) * 12 - 12 + root + pattern[pattern.length - 1]!;
            } else {
                degree = pattern.length - 1 - degree;
                nextPitch = Math.floor((state.currentPitch - root) / 12) * 12 + root + pattern[degree]!;
            }
        } else {
            degree = (degree - 1 + pattern.length) % pattern.length;
            const octaveShift = degree === pattern.length - 1 ? -12 : 0;
            nextPitch = state.currentPitch - currentPc + pattern[degree]! + octaveShift;
        }
    } else {
        nextPitch -= semitones;
    }

    stepRecordStore.set({
        ...state,
        currentPitch: Math.max(0, nextPitch)
    });
}
