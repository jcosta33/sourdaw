import { describe, it, expect, vi, beforeEach } from 'vitest';

const { setMock, mockStore } = vi.hoisted(() => {
    const ref = {
        value: {
            voltageStandard: '1v-per-octave' as const,
            clockDivision: 1,
            outputs: [] as {
                id: string;
                name: string;
                outputChannel: number;
                type: string;
                minVoltage: number;
                maxVoltage: number;
                value: number;
                active: boolean;
            }[],
        } as {
            voltageStandard: '1v-per-octave' | 'hz-per-volt';
            clockDivision: number;
            outputs: {
                id: string;
                name: string;
                outputChannel: number;
                type: string;
                minVoltage: number;
                maxVoltage: number;
                value: number;
                active: boolean;
            }[];
        } | null,
    };
    const setMock = vi.fn((next: typeof ref.value) => {
        ref.value = next;
    });
    return { setMock, mockStore: ref };
});

vi.mock('../../stores/cvGate', () => {
    let counter = 0;
    return {
        cvGateStore: {
            get value() {
                return mockStore.value;
            },
            set: setMock,
        },
        getNextOutputId: () => `out-${++counter}`,
        VOLTAGE_RANGES: {
            'cv-pitch': [0, 5] as [number, number],
            gate: [0, 5] as [number, number],
        },
    };
});

import { addCvOutput } from '../cvOutputOperations/addCvOutput';
import { removeCvOutput } from '../cvOutputOperations/removeCvOutput';
import { setClockDivision } from '../cvOutputOperations/setClockDivision';
import { setCvValue } from '../cvOutputOperations/setCvValue';
import { setVoltageStandard } from '../cvOutputOperations/setVoltageStandard';

describe('cvOutputOperations', () => {
    beforeEach(() => {
        mockStore.value = { voltageStandard: '1v-per-octave', clockDivision: 1, outputs: [] };
        setMock.mockClear();
    });

    it('addCvOutput appends a new channel with default range', () => {
        addCvOutput('Pitch', 0, 'cv-pitch');
        expect(setMock).toHaveBeenCalled();
        const next = setMock.mock.calls[0]![0]!;
        expect(next.outputs).toHaveLength(1);
        expect(next.outputs[0]!.name).toBe('Pitch');
        expect(next.outputs[0]!.minVoltage).toBe(0);
        expect(next.outputs[0]!.maxVoltage).toBe(5);
    });

    it('removeCvOutput filters by id', () => {
        mockStore.value = {
            voltageStandard: '1v-per-octave',
            clockDivision: 1,
            outputs: [
                {
                    id: 'a',
                    name: 'A',
                    outputChannel: 0,
                    type: 'cv-pitch',
                    minVoltage: 0,
                    maxVoltage: 5,
                    value: 0,
                    active: true,
                },
                {
                    id: 'b',
                    name: 'B',
                    outputChannel: 1,
                    type: 'gate',
                    minVoltage: 0,
                    maxVoltage: 5,
                    value: 0,
                    active: true,
                },
            ],
        };
        removeCvOutput('a');
        expect(setMock.mock.calls[0]![0]!.outputs).toHaveLength(1);
        expect(setMock.mock.calls[0]![0]!.outputs[0]!.id).toBe('b');
    });

    it('setCvValue clamps to [0, 1]', () => {
        mockStore.value = {
            voltageStandard: '1v-per-octave',
            clockDivision: 1,
            outputs: [
                {
                    id: 'a',
                    name: 'A',
                    outputChannel: 0,
                    type: 'cv-pitch',
                    minVoltage: 0,
                    maxVoltage: 5,
                    value: 0,
                    active: true,
                },
            ],
        };
        setCvValue('a', 2);
        expect(setMock.mock.calls[0]![0]!.outputs[0]!.value).toBe(1);
        setMock.mockClear();
        setCvValue('a', -3);
        expect(setMock.mock.calls[0]![0]!.outputs[0]!.value).toBe(0);
    });

    it('setVoltageStandard / setClockDivision update state', () => {
        setVoltageStandard('hz-per-volt');
        expect(setMock.mock.calls[0]![0]!.voltageStandard).toBe('hz-per-volt');
        setMock.mockClear();
        setClockDivision(4);
        expect(setMock.mock.calls[0]![0]!.clockDivision).toBe(4);
    });
});
