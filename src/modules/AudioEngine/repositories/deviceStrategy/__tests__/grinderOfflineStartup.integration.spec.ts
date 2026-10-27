import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGrinderNode } from '../../../engine/GrinderNode';
import {
    loadGrinderProcessorConstructor,
    grinderSetParamCalls,
    resetGrinderProcessorCalls,
    type GrinderProcessorLike,
} from '../../../services/__tests__/grinderProcessorTestHarness';
import { createNativeDspStrategy } from '../NativeDspDeviceStrategy';

vi.mock('#/infra/audioWorklet/workletInitShared', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/audioWorklet/workletInitShared')>()),
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue({
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        commit: vi.fn(),
        release: vi.fn(),
    }),
}));

vi.mock('../../../engine/telemetryAllocator', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../engine/telemetryAllocator')>()),
    telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() },
}));

class OfflineContext {
    currentTime = 0;
    sampleRate = 48_000;
}

const target = {
    trackId: 'offline-grinder-track',
    deviceId: 'grinder-1',
    deviceType: 'grinder',
    parameterIds: ['neuralCustomOutputTrim'],
};

describe('offline Grinder startup consumption', () => {
    let queued: unknown[];
    let processor: GrinderProcessorLike;
    let worklet: {
        port: { onmessage: ((event: MessageEvent<unknown>) => void) | null; close: ReturnType<typeof vi.fn> };
        disconnect: ReturnType<typeof vi.fn>;
        onprocessorerror: (() => void) | null;
    };

    beforeEach(async () => {
        resetGrinderProcessorCalls();
        vi.stubGlobal('sampleRate', 48_000);
        vi.stubGlobal('currentFrame', 0);
        vi.stubGlobal('AudioContext', class {});
        vi.stubGlobal('OfflineAudioContext', OfflineContext);
        queued = [];
        const Processor = await loadGrinderProcessorConstructor();
        class WorkletNode {
            parameters = new Map<string, AudioParam>();
            disconnect = vi.fn();
            onprocessorerror: (() => void) | null = null;
            port = {
                onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
                close: vi.fn(),
                postMessage: (data: unknown) => {
                    if (
                        typeof data === 'object' &&
                        data !== null &&
                        'command' in data &&
                        data.command !== 'initialize-fallback-control'
                    ) {
                        queued.push(data);
                        return;
                    }
                    processor.port.onmessage?.({ data });
                },
            };
            constructor(_context: BaseAudioContext, _name: string, options: unknown) {
                worklet = this;
                processor = new Processor(options);
                processor.port.postMessage = vi.fn((data: unknown) => {
                    this.port.onmessage?.(new MessageEvent('message', { data }));
                });
            }
        }
        vi.stubGlobal('AudioWorkletNode', WorkletNode);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    function consumeNext(): void {
        const data = queued.shift();
        expect(data).toBeDefined();
        processor.port.onmessage?.({ data });
    }

    function buildStrategy() {
        return createNativeDspStrategy(new OfflineContext() as unknown as BaseAudioContext, {
            id: 'grinder-1',
            name: 'Grinder',
            type: 'grinder',
            bypassed: false,
            parameterValues: { neuralCustomOutputTrim: 0.2 },
        });
    }

    it('keeps construction and render admission pending until the real receiver consumes setup', async () => {
        let renderStarted = false;
        const building = buildStrategy().then((strategy) => {
            renderStarted = true;
            return strategy;
        });
        await vi.waitFor(() => expect(queued.length).toBeGreaterThan(0));

        expect(grinderSetParamCalls).toEqual([]);
        expect(renderStarted).toBe(false);

        consumeNext();
        expect(grinderSetParamCalls).toEqual([{ name: 'neuralCustomOutputTrim', value: 0.2 }]);
        expect(renderStarted).toBe(false);
        consumeNext();
        const strategy = await building;
        expect(renderStarted).toBe(true);
        strategy.destroy();
    });
});
