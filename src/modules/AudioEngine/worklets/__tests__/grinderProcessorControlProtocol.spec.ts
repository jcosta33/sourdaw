import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createReadyGrinderProcessor,
    grinderCallCounts,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
    setGrinderLatencySamplesAfterSetParam,
} from '../../testing/grinderProcessorTestHarness';

function initializeControlGeneration(processor: Awaited<ReturnType<typeof createReadyGrinderProcessor>>): void {
    processor.port.onmessage?.({
        data: {
            schemaVersion: 1,
            command: 'initialize-fallback-control',
            target: {
                trackId: 'track-1',
                deviceId: 'grinder-1',
                deviceType: 'grinder',
                parameterIds: ['sagAmount', 'bypass'],
                allowUncapturedImmediate: false,
            },
            correlation: { workletGeneration: 7 },
        },
    });
}

function fallbackControl(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        command: 'set-fallback-param',
        target: {
            trackId: 'track-1',
            deviceId: 'grinder-1',
            deviceType: 'grinder',
            parameterId: 'sagAmount',
        },
        value: 0.5,
        correlation: { workletGeneration: 7, controlSequence: 1 },
        scheduling: { targetFrame: null, deadlineFrame: null },
        ...overrides,
    };
}

describe('GrinderProcessor fallback-control protocol', () => {
    beforeEach(() => {
        resetGrinderProcessorCalls();
        vi.stubGlobal('currentFrame', 1_000);
    });

    it('drops legacy and malformed messages without mutating WASM or faulting the processor', async () => {
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);
        vi.mocked(processor.port.postMessage).mockClear();

        processor.port.onmessage?.({ data: { type: 'param', name: 'sagAmount', value: 0.5 } });
        processor.port.onmessage?.({ data: { type: 'param', name: 'bypass', value: 1 } });
        processor.port.onmessage?.({ data: { schemaVersion: 1, command: 'set-fallback-param' } });

        expect(grinderSetParamCalls).toEqual([]);
        expect(processor.port.postMessage).not.toHaveBeenCalled();
    });

    it('rejects forged unknown ids even when an initialization declares them', async () => {
        const processor = await createReadyGrinderProcessor();
        processor.port.onmessage?.({
            data: {
                schemaVersion: 1,
                command: 'initialize-fallback-control',
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterIds: ['sagAmount', 'metadata'],
                    allowUncapturedImmediate: true,
                },
                correlation: { workletGeneration: 7 },
            },
        });
        processor.port.onmessage?.({ data: fallbackControl() });
        expect(grinderSetParamCalls).toEqual([]);
        initializeControlGeneration(processor);
        processor.port.onmessage?.({
            data: fallbackControl({
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterId: 'metadata',
                },
            }),
        });
        processor.port.onmessage?.({ data: fallbackControl() });
        expect(grinderSetParamCalls).toEqual([{ name: 'sagAmount', value: 0.5 }]);
    });

    it('allows an uncaptured known control only immediately in a live initialization', async () => {
        const processor = await createReadyGrinderProcessor();
        processor.port.onmessage?.({
            data: {
                schemaVersion: 1,
                command: 'initialize-fallback-control',
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterIds: ['bypass'],
                    allowUncapturedImmediate: true,
                },
                correlation: { workletGeneration: 7 },
            },
        });
        const target = { trackId: 'track-1', deviceId: 'grinder-1', deviceType: 'grinder', parameterId: 'ampModel' };
        processor.port.onmessage?.({
            data: fallbackControl({ target, scheduling: { targetFrame: 1001, deadlineFrame: 1100 } }),
        });
        processor.port.onmessage?.({ data: fallbackControl({ target }) });
        processor.port.onmessage?.({
            data: fallbackControl({
                target: { ...target, parameterId: 'neuralModelSlot' },
                correlation: { workletGeneration: 7, controlSequence: 2 },
            }),
        });
        expect(grinderSetParamCalls).toEqual([{ name: 'ampModel', value: 0.5 }]);
    });

    it('resets the ready WASM instance on a reset message', async () => {
        const processor = await createReadyGrinderProcessor();

        processor.port.onmessage?.({ data: { type: 'reset' } });

        expect(grinderCallCounts.reset).toBe(1);
    });

    it('drops arbitrary parameters and target identities outside the initialized control schema', async () => {
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);
        vi.mocked(processor.port.postMessage).mockClear();

        processor.port.onmessage?.({
            data: fallbackControl({
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterId: 'unregistered-parameter',
                },
            }),
        });
        processor.port.onmessage?.({
            data: fallbackControl({
                target: {
                    trackId: 'other-track',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterId: 'sagAmount',
                },
                correlation: { workletGeneration: 7, controlSequence: 2 },
            }),
        });

        expect(grinderSetParamCalls).toEqual([]);
        expect(processor.port.postMessage).not.toHaveBeenCalled();
    });

    it('applies typed v1 bypass controls only after the initialized schema allows bypass', async () => {
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);
        vi.mocked(processor.port.postMessage).mockClear();

        processor.port.onmessage?.({
            data: fallbackControl({
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterId: 'bypass',
                },
                value: 1,
            }),
        });

        expect(grinderSetParamCalls).toEqual([{ name: 'bypass', value: 1 }]);
        expect(processor.port.postMessage).not.toHaveBeenCalled();
    });

    it('applies one current control and drops generation-mismatched, expired, duplicate, and out-of-order controls', async () => {
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);
        vi.mocked(processor.port.postMessage).mockClear();

        processor.port.onmessage?.({ data: fallbackControl() });
        processor.port.onmessage?.({
            data: fallbackControl({ correlation: { workletGeneration: 8, controlSequence: 2 } }),
        });
        processor.port.onmessage?.({
            data: fallbackControl({
                scheduling: { targetFrame: 900, deadlineFrame: 999 },
                correlation: { workletGeneration: 7, controlSequence: 2 },
            }),
        });
        processor.port.onmessage?.({ data: fallbackControl() });
        processor.port.onmessage?.({
            data: fallbackControl({ correlation: { workletGeneration: 7, controlSequence: 0 } }),
        });

        expect(grinderSetParamCalls).toEqual([{ name: 'sagAmount', value: 0.5 }]);
        expect(processor.port.postMessage).not.toHaveBeenCalled();
    });

    it('applies a due latency-changing fallback control without posting from process()', async () => {
        setGrinderLatencySamplesAfterSetParam(96);
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);
        vi.mocked(processor.port.postMessage).mockClear();

        processor.port.onmessage?.({
            data: fallbackControl({
                scheduling: { targetFrame: 1_001, deadlineFrame: 2_000 },
            }),
        });
        expect(grinderSetParamCalls).toEqual([]);
        expect(processor.port.postMessage).not.toHaveBeenCalled();

        vi.stubGlobal('currentFrame', 1_001);
        const input = [new Float32Array(4), new Float32Array(4)];
        const output = [new Float32Array(4), new Float32Array(4)];
        processor.process([input], [output], {});

        expect(grinderSetParamCalls).toEqual([{ name: 'sagAmount', value: 0.5 }]);
        expect(processor.port.postMessage).not.toHaveBeenCalled();
    });
});
