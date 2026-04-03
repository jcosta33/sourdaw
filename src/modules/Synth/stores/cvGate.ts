/**
 * CV/Gate output store — modular synth control via DC-coupled audio interfaces.
 *
 * Extracted from cvGateUseCases.ts
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';
import { DOC_PREFIX_ROOT } from '#/modules/CrdtDocument/models/CrdtDocumentTypes';

const logger = Container.getInstance().get(Logger);

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

export const cvGateStore = new Store<CvGateState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'cvGate'),
    initialData: {
        outputs: [],
        voltageStandard: '1v-per-octave',
        clockDivision: 1,
        triggerPulseMs: 5,
        gateThreshold: 1,
    },
});

let outputId = 1;

export function getNextOutputId(): string {
    return `cv-${outputId++}`;
}

export const VOLTAGE_RANGES: Record<CvOutputChannel['type'], [number, number]> = {
    'cv-pitch': [-2, 8],
    'cv-velocity': [0, 5],
    'cv-modulation': [0, 5],
    'gate': [0, 5],
    'trigger': [0, 5],
    'clock': [0, 5],
};
