import { cvGateStore, getNextOutputId, VOLTAGE_RANGES, type CvOutputChannel } from '#/modules/Synth/stores/cvGate';

export function addCvOutput(name: string, outputChannel: number, type: CvOutputChannel['type']): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    const [minV, maxV] = VOLTAGE_RANGES[type];
    const output: CvOutputChannel = {
        id: getNextOutputId(),
        name,
        outputChannel,
        type,
        minVoltage: minV,
        maxVoltage: maxV,
        value: 0,
        active: true,
    };
    cvGateStore.set({ ...state, outputs: [...state.outputs, output] });
}