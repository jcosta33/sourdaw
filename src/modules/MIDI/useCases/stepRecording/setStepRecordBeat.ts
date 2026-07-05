import { stepRecordStore } from '../../stores/stepRecordStore';

type SetStepRecordBeatInput = number | ((currentBeat: number) => number);

export function setStepRecordBeat(input: SetStepRecordBeatInput): void {
    const state = stepRecordStore.value;
    if (!state) {
        return;
    }

    const currentBeat = typeof input === 'function' ? input(state.currentBeat) : input;

    stepRecordStore.set({ ...state, currentBeat });
}
