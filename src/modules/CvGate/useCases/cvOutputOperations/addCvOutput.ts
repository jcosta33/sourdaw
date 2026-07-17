import { cvGateStore, getNextOutputId, VOLTAGE_RANGES, type CvOutputChannel } from '../../stores/cvGate';

export function addCvOutput(name: string, outputChannel: number, type: CvOutputChannel['type']): void {
    const state = cvGateStore.value;
    if (!state) {
        return;
    }
    // `type` is declared as the literal union, but it arrives at runtime as a
    // bare `string` from the action payload (cast in handleAddCvOutput). Reject
    // anything outside the known voltage ranges before destructuring — otherwise
    // `VOLTAGE_RANGES[type]` is `undefined` and `const [minV, maxV] = …` throws a
    // TypeError. `Object.hasOwn` is the runtime membership check the static type
    // can't perform.
    if (!Object.hasOwn(VOLTAGE_RANGES, type)) {
        return;
    }
    // Reject a duplicate physical output channel — two outputs on one channel
    // would clobber each other's voltage.
    if (state.outputs.some((out) => out.outputChannel === outputChannel)) {
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
