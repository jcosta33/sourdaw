import { cvGateStore } from '../../../stores/cvGate';

export function setCvValue(outputIdVal: string, value: number): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({
        ...state,
        outputs: state.outputs.map((o) =>
            o.id === outputIdVal ? { ...o, value: Math.max(0, Math.min(1, value)) } : o
        ),
    });
}
