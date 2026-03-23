import { cvGateStore, getNextOutputId, VOLTAGE_RANGES, type CvOutputChannel } from '#/modules/Synth/stores/cvGate';

export function addCvOutput(name: string, outputChannel: number, type: CvOutputChannel['type']): void {
    const state = cvGateStore.value;
    if (!state) { return; }
    const [minV, maxV] = VOLTAGE_RANGES[type];
    const output: CvOutputChannel = {
        id: getNextOutputId(), name, outputChannel, type,
        minVoltage: minV, maxVoltage: maxV, value: 0, active: true,
    };
    cvGateStore.set({ ...state, outputs: [...state.outputs, output] });
}

export function removeCvOutput(id: string): void {
    const state = cvGateStore.value;
    if (!state) { return; }
    cvGateStore.set({ ...state, outputs: state.outputs.filter((o) => o.id !== id) });
}

export function setCvValue(outputIdVal: string, value: number): void {
    const state = cvGateStore.value;
    if (!state) { return; }
    cvGateStore.set({
        ...state,
        outputs: state.outputs.map((o) =>
            o.id === outputIdVal ? { ...o, value: Math.max(0, Math.min(1, value)) } : o
        ),
    });
}

export function setVoltageStandard(standard: import('#/modules/Synth/stores/cvGate').VoltageStandard): void {
    const state = cvGateStore.value;
    if (!state) { return; }
    cvGateStore.set({ ...state, voltageStandard: standard });
}

export function setClockDivision(division: number): void {
    const state = cvGateStore.value;
    if (!state) { return; }
    cvGateStore.set({ ...state, clockDivision: division });
}
