import { getYeastRuntimeError, getYeastRuntimeStatus } from '../engine/yeastRuntime';
import { yeastStore } from '../stores/yeastStore';

export function publishYeastRuntimeStatus(): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const runtimeStatus = getYeastRuntimeStatus();
    const runtimeError = getYeastRuntimeError();
    if (state.runtimeStatus === runtimeStatus && state.runtimeError === runtimeError) {
        return;
    }

    const nextState = { ...state, runtimeStatus };
    if (runtimeError) {
        nextState.runtimeError = runtimeError;
    } else {
        delete nextState.runtimeError;
    }
    yeastStore.set(nextState);
}
