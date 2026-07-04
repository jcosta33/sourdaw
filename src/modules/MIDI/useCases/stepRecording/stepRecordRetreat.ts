import { stepRecordStore } from '../../stores/stepRecordStore';

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
