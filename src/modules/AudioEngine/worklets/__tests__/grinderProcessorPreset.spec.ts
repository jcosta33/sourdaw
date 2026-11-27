import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GrinderTimedParameterControl, getGrinderTimedParameterName } from '../../models/GrinderTimedParameterControl';
import { type RuntimeGrinderPreset } from '../../models/RuntimeGrinderPreset';
import { compileRuntimeGrinderPreset } from '../../services/compileRuntimeGrinderPreset';
import {
    type GrinderProcessorLike,
    createReadyGrinderProcessor,
    getGrinderAutomationHeader,
    getGrinderAutomationValue,
    grinderDefaultRestoreCalls,
    grinderLoadModelCalls,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
    setGrinderLatencySamplesAfterSetParam,
    setGrinderModelRejection,
} from '../../testing/grinderProcessorTestHarness';

const TARGET = { trackId: 'guitar', deviceId: 'grinder-1', deviceType: 'grinder' };
const GENERATION = 7;
const FRAMES = 4;
const GAIN_TICKET = getGrinderTimedParameterName('gain');

function send(processor: GrinderProcessorLike, data: unknown): void {
    processor.port.onmessage?.({ data });
}

async function createLiveProcessor(tickets?: GrinderTimedParameterControl): Promise<GrinderProcessorLike> {
    const processor = await createReadyGrinderProcessor(tickets?.buffer);
    send(processor, {
        schemaVersion: 1,
        command: 'initialize-fallback-control',
        target: { ...TARGET, parameterIds: ['gain', 'neuralModelSlot'], allowUncapturedImmediate: true },
        correlation: { workletGeneration: GENERATION },
    });
    processor.port.postMessage.mockClear();
    return processor;
}

function preset(overrides: Record<string, unknown> = {}): RuntimeGrinderPreset {
    const result = compileRuntimeGrinderPreset({
        schemaVersion: 1,
        command: 'apply-grinder-preset',
        target: TARGET,
        correlation: { workletGeneration: GENERATION, controlSequence: 1 },
        scheduling: { targetFrame: null, deadlineFrame: null },
        parameters: [
            { parameterId: 'engineMode', value: 1 },
            { parameterId: 'neuralEnabled', value: 1 },
            { parameterId: 'cabIrSlot', value: 2 },
            { parameterId: 'gain', value: 9 },
        ],
        resetParameterIds: [],
        overrides: [{ parameterId: 'gain', value: 2.5 }],
        neural: { neuralModelMode: 'builtin' },
        ...overrides,
    });
    if (result.status !== 'compiled') {
        throw new Error(result.reason);
    }
    return result.patch;
}

function render(processor: GrinderProcessorLike, parameters: Record<string, Float32Array>): void {
    processor.process([[new Float32Array(FRAMES)]], [[new Float32Array(FRAMES)]], parameters);
}

function smoothing(start: number, target: number, samples: number): number {
    return target + (start - target) * Math.exp(-samples / 480);
}

function manualGain(value: number, controlSequence: number) {
    return {
        schemaVersion: 1,
        command: 'set-fallback-param',
        target: { ...TARGET, parameterId: 'gain' },
        value,
        correlation: { workletGeneration: GENERATION, controlSequence },
        scheduling: { targetFrame: null, deadlineFrame: null },
    };
}

describe('GrinderProcessor grouped presets', () => {
    beforeEach(() => {
        resetGrinderProcessorCalls();
        vi.stubGlobal('currentFrame', 0);
    });

    it('lands discrete controls and effective continuous targets for the same next block', async () => {
        const processor = await createLiveProcessor();
        render(processor, { gain: new Float32Array([3.5]) });
        setGrinderLatencySamplesAfterSetParam(96);
        const transaction = preset();
        vi.stubGlobal('currentFrame', 4);
        send(processor, transaction);
        expect(processor.port.postMessage.mock.calls).toEqual([
            [
                {
                    type: 'grinder-preset-result',
                    schemaVersion: 1,
                    target: transaction.target,
                    correlation: transaction.correlation,
                    status: 'installed',
                    latency: 96,
                },
            ],
        ]);
        expect(grinderSetParamCalls).toEqual([
            { name: 'neuralEnabled', value: 1 },
            { name: 'engineMode', value: 1 },
            { name: 'cabIrSlot', value: 2 },
            { name: 'neuralModelMode', value: 0 },
        ]);

        render(processor, { gain: new Float32Array([9]), bass: new Float32Array([1, 2, 3, 4]) });
        expect(getGrinderAutomationHeader(0)).toBe(FRAMES);
        expect(getGrinderAutomationValue(0, 0)).toBe(3.5);
        expect(getGrinderAutomationValue(0, 3)).toBeCloseTo(smoothing(3.5, 2.5, 3), 6);
        expect(getGrinderAutomationValue(1, 3)).toBe(4);

        const callsBeforeManual = [...grinderSetParamCalls];
        send(processor, manualGain(8, 2));
        render(processor, { gain: new Float32Array([1]) });
        expect(getGrinderAutomationValue(0, 3)).toBeCloseTo(smoothing(smoothing(3.5, 2.5, 4), 8, 3), 6);
        expect(grinderSetParamCalls).toEqual(callsBeforeManual);
    });

    it('uses the descriptor default as the first unrendered sample and keeps an owned static target', async () => {
        const processor = await createLiveProcessor();
        send(processor, preset({ parameters: [{ parameterId: 'gain', value: 5 }], overrides: [] }));
        render(processor, { gain: new Float32Array([9]) });
        expect(getGrinderAutomationHeader(0)).toBe(1);
        expect(getGrinderAutomationValue(0, 0)).toBe(5);
    });

    it('retains a pre-preset timed event at the native sample, including a later event with the same value', async () => {
        const tickets = new GrinderTimedParameterControl();
        const processor = await createLiveProcessor(tickets);
        const earlier = tickets.reserve(0, 8, 5, 0);
        const later = tickets.reserve(0, 8, 9, 0);
        render(processor, { gain: new Float32Array([5]) });
        vi.stubGlobal('currentFrame', 4);
        send(processor, preset({ parameters: [{ parameterId: 'gain', value: 2 }], overrides: [] }));

        render(processor, {
            gain: new Float32Array([2]),
            [GAIN_TICKET]: new Float32Array([0, earlier, earlier, earlier]),
        });
        const beforeTimedWrite = smoothing(5, 2, 1);
        expect(getGrinderAutomationValue(0, 1)).toBeCloseTo(beforeTimedWrite, 6);
        expect(getGrinderAutomationValue(0, 2)).toBeCloseTo(smoothing(beforeTimedWrite, 8, 1), 6);

        vi.stubGlobal('currentFrame', 8);
        send(processor, manualGain(1, 2));
        render(processor, {
            gain: new Float32Array([9]),
            [GAIN_TICKET]: new Float32Array([earlier, later, later, later]),
        });
        const atSecondTimedWrite = smoothing(smoothing(beforeTimedWrite, 8, 3), 1, 1);
        expect(getGrinderAutomationValue(0, 1)).toBeCloseTo(atSecondTimedWrite, 6);
        expect(getGrinderAutomationValue(0, 2)).toBeCloseTo(smoothing(atSecondTimedWrite, 8, 1), 6);
    });

    it('refuses a corrupt suffix and ignores stale or foreign addresses without writing a scalar prefix', async () => {
        const processor = await createLiveProcessor();
        const transaction = preset();
        send(processor, { ...transaction, target: { ...TARGET, deviceId: 'replacement' } });
        send(processor, { ...transaction, correlation: { workletGeneration: 8, controlSequence: 1 } });
        send(processor, {
            ...transaction,
            parameters: [...transaction.parameters, { parameterId: 'mic1Type', value: 2 }],
        });
        send(processor, transaction);

        expect(grinderSetParamCalls).toEqual([]);
        expect(processor.port.postMessage.mock.calls).toEqual([
            [
                {
                    type: 'grinder-preset-result',
                    schemaVersion: 1,
                    target: transaction.target,
                    correlation: transaction.correlation,
                    status: 'refused',
                    reason: 'Grinder preset payload is invalid',
                },
            ],
        ]);
        send(processor, { ...transaction, correlation: { workletGeneration: GENERATION, controlSequence: 2 } });
        expect(grinderSetParamCalls).toContainEqual({ name: 'cabIrSlot', value: 2 });
    });

    it('leaves prior applied scalars and the processor live when a new NAM is refused', async () => {
        const processor = await createLiveProcessor();
        const modelJson = '{"architecture":"Linear"}';
        const transaction = preset({ neural: { neuralModelMode: 'imported', profile: {}, modelJson } });
        setGrinderModelRejection('Linear config requires receptive_field');
        send(processor, transaction);
        expect(grinderLoadModelCalls).toEqual([modelJson]);
        expect(grinderSetParamCalls).toEqual([]);
        expect(processor.port.postMessage.mock.calls).toEqual([
            [
                {
                    type: 'grinder-preset-result',
                    schemaVersion: 1,
                    target: transaction.target,
                    correlation: transaction.correlation,
                    status: 'refused',
                    reason: 'Linear config requires receptive_field',
                },
            ],
        ]);

        render(processor, { gain: new Float32Array([4]) });
        expect(getGrinderAutomationValue(0, 0)).toBe(4);
        send(processor, preset({ correlation: { workletGeneration: GENERATION, controlSequence: 2 } }));
        expect(grinderSetParamCalls).toContainEqual({ name: 'cabIrSlot', value: 2 });
    });

    it('restores a DSP default in the same task and lets an active override win over a reset', async () => {
        const processor = await createLiveProcessor();
        send(
            processor,
            preset({
                parameters: [
                    { parameterId: 'gateAttack', value: 2 },
                    { parameterId: 'gateRelease', value: 120 },
                ],
                resetParameterIds: ['gateAttack', 'gateRelease'],
                overrides: [{ parameterId: 'gateRelease', value: 320 }],
            })
        );

        expect(grinderDefaultRestoreCalls).toEqual(['gateAttack']);
        expect(grinderSetParamCalls).toContainEqual({ name: 'gateRelease', value: 320 });
        expect(grinderSetParamCalls).not.toContainEqual({ name: 'gateAttack', value: 2 });
    });

    it('keeps an active scalar override through the grouped imported profile replay', async () => {
        const processor = await createLiveProcessor();
        send(
            processor,
            preset({
                parameters: [{ parameterId: 'neuralCustomInputDrive', value: 1.1 }],
                overrides: [{ parameterId: 'neuralCustomInputDrive', value: 1.5 }],
                neural: { neuralModelMode: 'imported', profile: { inputDrive: 1.1 } },
            })
        );
        const writes = grinderSetParamCalls.filter(({ name }) => name === 'neuralCustomInputDrive');
        expect(writes.at(-1)?.value).toBe(1.5);
        expect(grinderSetParamCalls.at(-1)).toEqual({ name: 'neuralModelMode', value: 1 });
    });
});
