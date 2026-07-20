import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createGlutenNode, isGlutenDevice } from '../GlutenNode';

// Mock the worklet-init helpers so createGlutenNode resolves without a real
// AudioContext / worklet module / WASM fetch. The ready handshake resolves
// immediately so the factory's `await` chain completes.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'other' as const,
        isSettled: () => true,
    })),
}));

// SAB requirement is satisfied in the test environment; make it a no-op so the
// factory does not throw before reaching setParam.
vi.mock('../pluginHostingErrors', () => ({ requireSharedArrayBuffer: vi.fn() }));

// No telemetry slot by default; individual tests override allocateSlot to
// exercise the slot-present branches (init-sab post, meter polling).
vi.mock('../telemetryAllocator', async () => {
    const actual = await vi.importActual<typeof import('../telemetryAllocator')>('../telemetryAllocator');
    return { ...actual, telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() } };
});

vi.mock('../../services/glutenProcessor.ts?worker&url', () => ({ default: 'gluten-processor-url' }));

describe('isGlutenDevice', () => {
    it('should return true only for the gluten device type string', () => {
        expect(isGlutenDevice('gluten')).toBe(true);
        expect(isGlutenDevice('levain')).toBe(false);
    });
});

describe('createGlutenNode', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let disconnect: ReturnType<typeof vi.fn>;
    let connect: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    let resume: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        postMessage = vi.fn();
        disconnect = vi.fn();
        connect = vi.fn();
        close = vi.fn();
        resume = vi.fn().mockResolvedValue(undefined);

        class FakeWorkletNode {
            port = { postMessage, onmessage: null as ((e: MessageEvent) => void) | null, close };
            connect = connect;
            disconnect = disconnect;
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);

        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue(null);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function makeCtx(state: 'running' | 'suspended' = 'running') {
        class FakeAudioContext {
            state = state;
            resume = resume;
        }
        vi.stubGlobal('AudioContext', FakeAudioContext);
        return new FakeAudioContext() as unknown as BaseAudioContext;
    }

    it('should resume the context only when it starts out suspended', async () => {
        await createGlutenNode(makeCtx('suspended'));
        expect(resume).toHaveBeenCalledTimes(1);

        resume.mockClear();
        await createGlutenNode(makeCtx('running'));
        expect(resume).not.toHaveBeenCalled();
    });

    it('should guard on SharedArrayBuffer availability and post init-sab only when a slot was allocated', async () => {
        const { requireSharedArrayBuffer } = await import('../pluginHostingErrors');
        const { telemetryAllocator } = await import('../telemetryAllocator');

        await createGlutenNode(makeCtx());
        expect(requireSharedArrayBuffer).toHaveBeenCalledWith('Gluten');
        expect(postMessage.mock.calls.some((c) => (c[0] as { type?: string }).type === 'init-sab')).toBe(false);

        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValueOnce({
            sab: {} as SharedArrayBuffer,
            byteOffset: 96,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        postMessage.mockClear();

        await createGlutenNode(makeCtx());

        expect(postMessage).toHaveBeenCalledWith({ type: 'init-sab', sab: expect.anything(), byteOffset: 96 });
    });

    it('should forward a finite setParam value and drop a non-finite one', async () => {
        const node = await createGlutenNode(makeCtx());
        postMessage.mockClear();

        node.setParam('threshold', -12);
        node.setParam('threshold', Number.POSITIVE_INFINITY);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'threshold', value: -12 });
    });

    it('should forward setBypass as a param message named bypass', async () => {
        const node = await createGlutenNode(makeCtx());
        postMessage.mockClear();

        node.setBypass(true);
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'bypass', value: 1 });

        node.setBypass(false);
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'bypass', value: 0 });
    });

    it('should poll meter data only when a telemetry slot is available', async () => {
        const { telemetryAllocator, GLUTEN_IDX } = await import('../telemetryAllocator');
        const raf = vi.fn();
        vi.stubGlobal('requestAnimationFrame', raf);

        const noSlotNode = await createGlutenNode(makeCtx());
        noSlotNode.onMeterData(vi.fn());
        expect(raf).not.toHaveBeenCalled();

        const view = new Float32Array(32);
        view[GLUTEN_IDX.grDb] = -4.5;
        view[GLUTEN_IDX.inputDb] = -8;
        view[GLUTEN_IDX.outputDb] = -3;
        view[GLUTEN_IDX.crest] = 6;
        view[GLUTEN_IDX.phaseCorr] = 1;
        view[GLUTEN_IDX.latency] = 64;
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 0,
            view,
            seqView: new Int32Array(32),
        });
        const rafCallbacks: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        const node = await createGlutenNode(makeCtx());
        const cb = vi.fn();
        node.onMeterData(cb);
        rafCallbacks[0]!(0);

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({ grDb: -4.5, inputDb: -8, outputDb: -3, crest: 6, phaseCorr: 1, latency: 64 });
    });

    it('should invoke the latency callback when the worklet posts a latency-changed message', async () => {
        const node = await createGlutenNode(makeCtx());
        const cb = vi.fn();
        node.onLatencyChanged(cb);

        node.workletNode.port.onmessage?.({ data: { type: 'latency-changed', latency: 17 } } as MessageEvent);

        expect(cb).toHaveBeenCalledWith(17);
    });

    it('should connect to the destination and swallow a disconnect error instead of throwing', async () => {
        disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const node = await createGlutenNode(makeCtx());
        const dest = {} as AudioNode;

        node.connect(dest);
        expect(connect).toHaveBeenCalledWith(dest);
        expect(() => node.disconnect()).not.toThrow();
    });

    it('should release the telemetry slot, cancel polling, disconnect and close the port on destroy', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 32,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        vi.stubGlobal('requestAnimationFrame', () => 9);
        const cancelRaf = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelRaf);

        const node = await createGlutenNode(makeCtx());
        node.onMeterData(vi.fn());

        node.destroy();

        expect(telemetryAllocator.releaseSlot).toHaveBeenCalledWith(32);
        expect(cancelRaf).toHaveBeenCalledWith(9);
        expect(disconnect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('should expose the underlying worklet node and a ready promise', async () => {
        const node = await createGlutenNode(makeCtx());

        expect(node.workletNode).toBeDefined();
        await expect(node.ready).resolves.toEqual({});
    });
});
