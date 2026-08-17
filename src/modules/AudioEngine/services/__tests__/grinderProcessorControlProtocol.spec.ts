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
            parameterId: 'sag',
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

        processor.port.onmessage?.({ data: { type: 'param', name: 'sag', value: 0.5 } });
        processor.port.onmessage?.({ data: { schemaVersion: 1, command: 'set-fallback-param' } });

        expect(grinderSetParamCalls).toEqual([]);
        expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('applies one current control and drops generation-mismatched, expired, duplicate, and out-of-order controls', async () => {
        const processor = await createReadyGrinderProcessor();
        initializeControlGeneration(processor);

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

        expect(grinderSetParamCalls).toEqual([{ name: 'sag', value: 0.5 }]);
        expect(processor.port.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
});
