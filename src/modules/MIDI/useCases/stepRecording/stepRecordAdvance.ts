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
