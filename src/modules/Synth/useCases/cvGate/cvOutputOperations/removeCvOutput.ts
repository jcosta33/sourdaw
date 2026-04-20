import { cvGateStore } from '../../../stores/cvGate';

export function removeCvOutput(id: string): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({ ...state, outputs: state.outputs.filter((o) => o.id !== id) });
}
