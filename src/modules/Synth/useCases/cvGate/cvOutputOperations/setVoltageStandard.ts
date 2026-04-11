import { cvGateStore } from '#/modules/Synth/stores/cvGate';

export function setVoltageStandard(standard: import('#/modules/Synth/stores/cvGate').VoltageStandard): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({ ...state, voltageStandard: standard });
}