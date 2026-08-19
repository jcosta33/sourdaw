import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createReadyGrinderProcessor,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
} from './grinderProcessorTestHarness';

function initializeControlGeneration(processor: Awaited<ReturnType<typeof createReadyGrinderProcessor>>): void {
    processor.port.onmessage?.({
        data: {
            schemaVersion: 1,
            command: 'initialize-fallback-control',
            target: {
                trackId: 'track-1',
                deviceId: 'grinder-1',
                deviceType: 'grinder',
                parameterIds: ['sag', 'bypass'],
            },
            correlation: { workletGeneration: 7 },
        },
    });
}

function neuralPatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        schemaVersion: 1,
        command: 'apply-grinder-neural-patch',
        target: { trackId: 'track-1', deviceId: 'grinder-1', deviceType: 'grinder' },
        patch: { neuralModelMode: 'builtin' },
        correlation: { workletGeneration: 7, controlSequence: 1 },
        scheduling: { targetFrame: null, deadlineFrame: null },
        ...overrides,
    };
}

function fallbackControl(controlSequence: number): Record<string, unknown> {
    return {
        schemaVersion: 1,
        command: 'set-fallback-param',
        target: { trackId: 'track-1', deviceId: 'grinder-1', deviceType: 'grinder', parameterId: 'sag' },
        value: 0.5,
        correlation: { workletGeneration: 7, controlSequence },
        scheduling: { targetFrame: null, deadlineFrame: null },
    };
}

describe('GrinderProcessor neural-patch protocol', () => {
    beforeEach(() => {
        resetGrinderProcessorCalls();
    });

    it('drops legacy raw patch messages without mutating WASM or faulting', async () => {
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);
        vi.mocked(processor.port.postMessage).mockClear();

        processor.port.onmessage?.({ data: { type: 'patch', patch: { neuralModelMode: 'builtin' } } });

        expect(grinderSetParamCalls).toEqual([]);
        expect(processor.port.postMessage).not.toHaveBeenCalled();
    });

    it('drops wrong target/generation, duplicate, out-of-order, malformed, and scheduled patches', async () => {
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);
        vi.mocked(processor.port.postMessage).mockClear();

        processor.port.onmessage?.({
            data: neuralPatch({ target: { trackId: 'other', deviceId: 'grinder-1', deviceType: 'grinder' } }),
        });
        processor.port.onmessage?.({
            data: neuralPatch({ correlation: { workletGeneration: 8, controlSequence: 1 } }),
        });
        processor.port.onmessage?.({
            data: neuralPatch({ patch: { neuralModelMode: 'imported', profile: { convWeights: [[0.1, 0.2]] } } }),
        });
        processor.port.onmessage?.({ data: neuralPatch({ scheduling: { targetFrame: 1, deadlineFrame: 2 } }) });
        processor.port.onmessage?.({ data: neuralPatch() });
        processor.port.onmessage?.({ data: neuralPatch() });
        processor.port.onmessage?.({
            data: neuralPatch({ correlation: { workletGeneration: 7, controlSequence: 0 } }),
        });

        expect(grinderSetParamCalls).toEqual([{ name: 'neuralModelMode', value: 0 }]);
        expect(processor.port.postMessage).not.toHaveBeenCalled();
    });

    it('shares one monotonic sequence with fallback parameter controls', async () => {
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);
        vi.mocked(processor.port.postMessage).mockClear();

        processor.port.onmessage?.({ data: fallbackControl(1) });
        processor.port.onmessage?.({
            data: neuralPatch({ correlation: { workletGeneration: 7, controlSequence: 1 } }),
        });
        processor.port.onmessage?.({
            data: neuralPatch({ correlation: { workletGeneration: 7, controlSequence: 2 } }),
        });
        processor.port.onmessage?.({ data: fallbackControl(3) });

        expect(grinderSetParamCalls).toEqual([
            { name: 'sag', value: 0.5 },
            { name: 'neuralModelMode', value: 0 },
            { name: 'sag', value: 0.5 },
        ]);
    });
});
