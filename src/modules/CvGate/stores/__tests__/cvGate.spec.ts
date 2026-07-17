import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';

import { cvGateStore, defaultCvGateState, sanitize_cv_gate_state, type CvGateState } from '../cvGate';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

type MutationRecord = {
    docId: string;
    message: string | undefined;
};

type CreateTestPortInput = {
    initialDoc?: TestDoc;
};

function create_test_port(input: CreateTestPortInput = {}): { mutations: MutationRecord[]; port: TestPort } {
    const doc = input.initialDoc ?? {};
    const mutations: MutationRecord[] = [];

    const port: TestPort = {
        getDoc: () => doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ docId, changeFn, message }) => {
            changeFn(doc);
            mutations.push({ docId, message });
        },
    };

    return { mutations, port };
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

describe('sanitize_cv_gate_state', () => {
    beforeEach(async () => {
        configureAutomergeStoragePort(null);
        cvGateStore.set(defaultCvGateState);
        await flush_pending_frame();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('should reset invalid top-level CRDT hydration to safe defaults', () => {
        expect(sanitize_cv_gate_state('corrupt')).toEqual(defaultCvGateState);
    });

    it('should preserve valid outputs and settings while dropping malformed output rows', () => {
        const valid_output = {
            id: 'cv-1',
            name: 'Pitch',
            outputChannel: 2,
            type: 'cv-pitch' as const,
            minVoltage: -2,
            maxVoltage: 8,
            value: 1.25,
            active: true,
        };

        expect(
            sanitize_cv_gate_state({
                outputs: [
                    valid_output,
                    {
                        id: 'bad-type',
                        name: 'Bad',
                        outputChannel: 3,
                        type: 'lfo',
                        minVoltage: 0,
                        maxVoltage: 5,
                        value: 1,
                        active: true,
                    },
                    {
                        id: 'bad-value',
                        name: 'Bad',
                        outputChannel: 4,
                        type: 'gate',
                        minVoltage: 0,
                        maxVoltage: 5,
                        value: Number.NaN,
                        active: true,
                    },
                ],
                voltageStandard: 'hz-per-volt',
                clockDivision: 4,
                triggerPulseMs: 12,
                gateThreshold: 2.5,
            })
        ).toEqual({
            outputs: [valid_output],
            voltageStandard: 'hz-per-volt',
            clockDivision: 4,
            triggerPulseMs: 12,
            gateThreshold: 2.5,
        });
    });

    it('should strip unknown fields from valid CRDT payloads', () => {
        expect(
            sanitize_cv_gate_state({
                outputs: [
                    {
                        id: 'cv-1',
                        name: 'Pitch',
                        outputChannel: 2,
                        type: 'cv-pitch',
                        minVoltage: -2,
                        maxVoltage: 8,
                        value: 1.25,
                        active: true,
                        stale: true,
                    },
                ],
                voltageStandard: '1v-per-octave',
                clockDivision: 1,
                triggerPulseMs: 5,
                gateThreshold: 1,
                stale: true,
            })
        ).toEqual({
            outputs: [
                {
                    id: 'cv-1',
                    name: 'Pitch',
                    outputChannel: 2,
                    type: 'cv-pitch',
                    minVoltage: -2,
                    maxVoltage: 8,
                    value: 1.25,
                    active: true,
                },
            ],
            voltageStandard: '1v-per-octave',
            clockDivision: 1,
            triggerPulseMs: 5,
            gateThreshold: 1,
        });
    });

    it('should default invalid scalar settings independently', () => {
        expect(
            sanitize_cv_gate_state({
                outputs: [],
                voltageStandard: 'eurorack',
                clockDivision: Number.POSITIVE_INFINITY,
                triggerPulseMs: 7,
                gateThreshold: null,
            })
        ).toEqual({
            outputs: [],
            voltageStandard: '1v-per-octave',
            clockDivision: 1,
            triggerPulseMs: 7,
            gateThreshold: 1,
        });
    });

    it('should not write back when CRDT hydration is already valid and exact', async () => {
        const valid_state: CvGateState = {
            outputs: [],
            voltageStandard: 'hz-per-volt',
            clockDivision: 2,
            triggerPulseMs: 8,
            gateThreshold: 1.5,
        };
        const { mutations, port } = create_test_port({ initialDoc: { cvGate: valid_state } });
        configureAutomergeStoragePort(port);

        cvGateStore.hydrate();
        await flush_pending_frame();

        expect(cvGateStore.value).toEqual(valid_state);
        expect(mutations).toEqual([]);
    });
});
