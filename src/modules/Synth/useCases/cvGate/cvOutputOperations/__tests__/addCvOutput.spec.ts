import { describe, it, expect, beforeEach } from 'vitest';

import { cvGateStore, type CvGateState } from '../../../../stores/cvGate';
import { addCvOutput } from '../addCvOutput';

const baseState: CvGateState = {
    outputs: [],
    voltageStandard: '1v-per-octave',
    clockDivision: 1,
    triggerPulseMs: 5,
    gateThreshold: 1,
};

describe('addCvOutput', () => {
    beforeEach(() => {
        cvGateStore.set({ ...baseState, outputs: [] });
    });

    it('should export addCvOutput', () => {
        expect(addCvOutput).toBeDefined();
        expect(typeof addCvOutput).toBe('function');
    });

    it('appends a valid output with the voltage range for its type', () => {
        addCvOutput('Pitch CV', 0, 'cv-pitch');

        const outputs = cvGateStore.value?.outputs ?? [];
        expect(outputs).toHaveLength(1);
        expect(outputs[0]).toMatchObject({
            name: 'Pitch CV',
            outputChannel: 0,
            type: 'cv-pitch',
            minVoltage: -2,
            maxVoltage: 8,
        });
    });

    it('rejects an unknown type instead of throwing on the voltage-range destructure', () => {
        // The action payload types `type` as a bare `string`; an unknown value
        // makes `VOLTAGE_RANGES[type]` undefined. Before the guard this threw a
        // TypeError ("undefined is not iterable") on `const [minV, maxV] = ...`.
        expect(() => addCvOutput('Bogus', 0, 'not-a-real-type' as never)).not.toThrow();
        expect(cvGateStore.value?.outputs ?? []).toHaveLength(0);
    });

    it('rejects a duplicate output channel instead of clobbering the existing output', () => {
        addCvOutput('Gate 1', 2, 'gate');
        addCvOutput('Gate 2', 2, 'trigger');

        const outputs = cvGateStore.value?.outputs ?? [];
        expect(outputs).toHaveLength(1);
        expect(outputs[0]).toMatchObject({ name: 'Gate 1', outputChannel: 2, type: 'gate' });
    });
});
