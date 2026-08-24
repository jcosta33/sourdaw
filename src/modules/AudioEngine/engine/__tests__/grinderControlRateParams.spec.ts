import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGrinderNode } from '../GrinderNode';

vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue({
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        commit: vi.fn(),
        release: vi.fn(),
    }),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'other' as const,
    })),
}));

vi.mock('../pluginHostingErrors', () => ({
    requireSharedArrayBuffer: vi.fn(),
}));

vi.mock('../telemetryAllocator', () => ({
    telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() },
    GRINDER_IDX: {},
}));

vi.mock('../../services/grinderProcessor.ts?worker&url', () => ({ default: 'grinder-processor-url' }));

describe('grinderControlRateParams', () => {
    const postMessage = vi.fn();
    const setTargetAtTime = vi.fn();
    const rafCallbacks: FrameRequestCallback[] = [];
    let workletNodeCreations = 0;

    beforeEach(() => {
        postMessage.mockReset();
        setTargetAtTime.mockReset();
        rafCallbacks.length = 0;
        workletNodeCreations = 0;

        class FakeWorkletNode {
            port = { postMessage, onmessage: null, close: vi.fn() };
            parameters = new Map<string, unknown>([
                ['gain', { setTargetAtTime }],
                ['transformerDrive', { setTargetAtTime }],
                ['negFeedback', { setTargetAtTime }],
            ]);
            connect = vi.fn();
            disconnect = vi.fn();

            constructor() {
                workletNodeCreations++;
            }
        }

        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal(
            'SharedArrayBuffer',
            class extends ArrayBuffer {
                constructor(length: number) {
                    super(length);
                }
            }
        );
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('keeps non-continuous parameters on the validated message path without rebuilding the graph', async () => {
        const context = { currentTime: 2, state: 'running' } as unknown as BaseAudioContext;
        const grinder = await createGrinderNode(context, undefined, undefined, {
            trackId: 'track-1',
            deviceId: 'grinder-1',
            deviceType: 'grinder',
            parameterIds: ['transformerHysteresis', 'cabIrSlot', 'neuralCpuBudget'],
        });
        postMessage.mockClear();

        grinder.setParam('transformerHysteresis', 0.7);
        grinder.setParam('cabIrSlot', 3);
        grinder.setParam('neuralCpuBudget', Number.NaN);
        grinder.setParam('transformerDrive', 0.6);

        expect(workletNodeCreations).toBe(1);
        expect(setTargetAtTime).toHaveBeenCalledOnce();
        expect(setTargetAtTime).toHaveBeenCalledWith(0.6, 2, 0.01);
        expect(postMessage).not.toHaveBeenCalled();

        const callbacks = rafCallbacks.splice(0);
        for (const callback of callbacks) {
            callback(0);
        }

        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(postMessage).toHaveBeenNthCalledWith(1, {
            schemaVersion: 1,
            command: 'set-fallback-param',
            target: {
                trackId: 'track-1',
                deviceId: 'grinder-1',
                deviceType: 'grinder',
                parameterId: 'transformerHysteresis',
            },
            value: 0.7,
            correlation: { workletGeneration: expect.any(Number), controlSequence: 1 },
            scheduling: { targetFrame: null, deadlineFrame: null },
        });
        expect(postMessage).toHaveBeenNthCalledWith(2, {
            schemaVersion: 1,
            command: 'set-fallback-param',
            target: {
                trackId: 'track-1',
                deviceId: 'grinder-1',
                deviceType: 'grinder',
                parameterId: 'cabIrSlot',
            },
            value: 3,
            correlation: { workletGeneration: expect.any(Number), controlSequence: 2 },
            scheduling: { targetFrame: null, deadlineFrame: null },
        });
        expect(workletNodeCreations).toBe(1);
    });
});
