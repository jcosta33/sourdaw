import { cvGateStore } from '../../stores/cvGate';

export function setVoltageStandard(standard: import('../../stores/cvGate').VoltageStandard): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({ ...state, voltageStandard: standard });
}
