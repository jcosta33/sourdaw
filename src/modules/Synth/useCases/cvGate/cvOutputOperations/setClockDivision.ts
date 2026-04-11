import { cvGateStore } from '#/modules/Synth/stores/cvGate';

export function setClockDivision(division: number): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    cvGateStore.set({ ...state, clockDivision: division });
}