import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCrustNode } from '../CrustNode';

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
        isSettled: () => true,
    })),
}));
vi.mock('../pluginHostingErrors', () => ({ requireSharedArrayBuffer: vi.fn() }));
vi.mock('../telemetryAllocator', async () => {
    const actual = await vi.importActual<typeof import('../telemetryAllocator')>('../telemetryAllocator');
    return { ...actual, telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() } };
});
vi.mock('../../services/crustProcessor.ts?worker&url', () => ({ default: 'crust-processor-url' }));

describe('createCrustNode control protocol', () => {
    let postMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postMessage = vi.fn();
        class FakeWorkletNode {
            port = { postMessage, onmessage: null as ((event: MessageEvent) => void) | null, close: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
        }
        class FakeAudioContext {}
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal('AudioContext', FakeAudioContext);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('emits only the generated versioned control schema and rejects synthetic or scheduled input', async () => {
        const node = await createCrustNode(
            new (globalThis.AudioContext as unknown as new () => BaseAudioContext)(),
            undefined,
            undefined,
            { trackId: 'track-1', deviceId: 'crust-1', deviceType: 'crust', parameterIds: ['synthetic'] }
        );
        postMessage.mockClear();

        node.setParam('ceiling', -1);
        node.setParam('synthetic', 1);
        node.setParam('ceiling', -2, 48_000);
        node.setBypass(true);

        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(postMessage).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                schemaVersion: 1,
                command: 'set-fallback-param',
                target: { trackId: 'track-1', deviceId: 'crust-1', deviceType: 'crust', parameterId: 'ceiling' },
                correlation: expect.objectContaining({ workletGeneration: expect.any(Number), controlSequence: 1 }),
                scheduling: { targetFrame: null, deadlineFrame: null },
            })
        );
        expect(postMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ target: expect.objectContaining({ parameterId: 'bypass' }), value: 1 })
        );
    });
});
