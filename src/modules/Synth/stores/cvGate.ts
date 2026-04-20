/**
 * CV/Gate output store — modular synth control via DC-coupled audio interfaces.
 *
 * Extracted from cvGateUseCases.ts
 */

import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type VoltageStandard = '1v-per-octave' | 'hz-per-volt';

export type CvOutputChannel = {
    id: string;
    name: string;
    outputChannel: number;
    type: 'cv-pitch' | 'cv-velocity' | 'cv-modulation' | 'gate' | 'trigger' | 'clock';
    minVoltage: number;
    maxVoltage: number;
    value: number;
    active: boolean;
};

export type CvGateState = {
    outputs: CvOutputChannel[];
    voltageStandard: VoltageStandard;
    clockDivision: number;
    triggerPulseMs: number;
    gateThreshold: number;
};

export const cvGateStore = createStore<CvGateState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'cvGate'),
    initialData: {
        outputs: [],
        voltageStandard: '1v-per-octave',
        clockDivision: 1,
        triggerPulseMs: 5,
        gateThreshold: 1,
    },
});

// §122.1 — UUID instead of module-level counter that reset on HMR.
export function getNextOutputId(): string {
    return `cv-${crypto.randomUUID()}`;
}

export const VOLTAGE_RANGES: Record<CvOutputChannel['type'], [number, number]> = {
    'cv-pitch': [-2, 8],
    'cv-velocity': [0, 5],
    'cv-modulation': [0, 5],
    gate: [0, 5],
    trigger: [0, 5],
    clock: [0, 5],
};
