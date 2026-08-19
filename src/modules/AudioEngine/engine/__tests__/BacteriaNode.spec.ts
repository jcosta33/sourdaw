import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createBacteriaNode, isBacteriaDevice } from '../BacteriaNode';

// Mock the worklet-init helpers so createBacteriaNode resolves without a real
// AudioContext / worklet module / WASM fetch. The ready handshake resolves
// immediately so the factory's `await` chain completes.
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

// SAB requirement is satisfied in the test environment; make it a no-op so the
// factory does not throw before reaching setParam.
vi.mock('../pluginHostingErrors', () => ({ requireSharedArrayBuffer: vi.fn() }));

// No telemetry slot by default; individual tests override allocateSlot to
// exercise the slot-present branches (init-sab post, meter polling).
vi.mock('../telemetryAllocator', async () => {
    const actual = await vi.importActual<typeof import('../telemetryAllocator')>('../telemetryAllocator');
    return { ...actual, telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() } };
});

vi.mock('../../services/bacteriaProcessor.ts?worker&url', () => ({ default: 'bacteria-processor-url' }));

describe('isBacteriaDevice', () => {
    it('should return true only for the bacteria device type string', () => {
        expect(isBacteriaDevice('bacteria')).toBe(true);
        expect(isBacteriaDevice('gluten')).toBe(false);
    });
});

describe('createBacteriaNode', () => {
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
    const target = { trackId: 'track-1', deviceId: 'bacteria-1', deviceType: 'bacteria', parameterIds: ['drive'] };

    it('should resume the context only when it starts out suspended', async () => {
        await createBacteriaNode(makeCtx('suspended'));
        expect(resume).toHaveBeenCalledTimes(1);

        resume.mockClear();
        await createBacteriaNode(makeCtx('running'));
        expect(resume).not.toHaveBeenCalled();
    });

    it('should guard on SharedArrayBuffer availability and post init-sab only when a slot was allocated', async () => {
        const { requireSharedArrayBuffer } = await import('../pluginHostingErrors');
        const { telemetryAllocator } = await import('../telemetryAllocator');

        await createBacteriaNode(makeCtx());
        expect(requireSharedArrayBuffer).toHaveBeenCalledWith('Bacteria');
        expect(postMessage.mock.calls.some((c) => (c[0] as { type?: string }).type === 'init-sab')).toBe(false);

        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValueOnce({
            sab: {} as SharedArrayBuffer,
            byteOffset: 128,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        postMessage.mockClear();

        await createBacteriaNode(makeCtx());

        expect(postMessage).toHaveBeenCalledWith({ type: 'init-sab', sab: expect.anything(), byteOffset: 128 });
    });

    it('should forward a finite setParam value and drop a non-finite one', async () => {
        const node = await createBacteriaNode(makeCtx(), undefined, undefined, target);
        postMessage.mockClear();

        node.setParam('drive', 0.6);
        node.setParam('drive', Number.NaN);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'set-fallback-param',
                target: expect.objectContaining({ parameterId: 'drive' }),
                value: 0.6,
            })
        );
    });

    it('admits Bacteria bridge band keys, rejects synthetic keys, and refuses scheduled control without telemetry', async () => {
        const node = await createBacteriaNode(makeCtx(), undefined, undefined, target);
        postMessage.mockClear();

        node.setParam('band5_drive', 0.6);
        node.setParam('synthetic-control', 1);
        node.setParam('drive', 0.6, 48_000);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'set-fallback-param',
                target: expect.objectContaining({ parameterId: 'band5_drive' }),
                scheduling: { targetFrame: null, deadlineFrame: null },
            })
        );
    });

    it('sends scheduled control only with a telemetry slot and retains the requested frame/deadline', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 0,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        const node = await createBacteriaNode(makeCtx(), undefined, undefined, target);
        postMessage.mockClear();

        node.setParam('drive', 0.6, 48_000);

        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                scheduling: { targetFrame: 48_000, deadlineFrame: 48_128 },
            })
        );
    });

    it('should forward setBypass as a param message named bypass', async () => {
        const node = await createBacteriaNode(makeCtx(), undefined, undefined, target);
        postMessage.mockClear();

        node.setBypass(true);
        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'set-fallback-param',
                target: expect.objectContaining({ parameterId: 'bypass' }),
                value: 1,
            })
        );

        node.setBypass(false);
        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'set-fallback-param',
                target: expect.objectContaining({ parameterId: 'bypass' }),
                value: 0,
            })
        );
    });

    it('should poll meter data only when a telemetry slot is available, converting band levels to dB', async () => {
        const { telemetryAllocator, BACTERIA_IDX } = await import('../telemetryAllocator');
        const raf = vi.fn();
        vi.stubGlobal('requestAnimationFrame', raf);

        const noSlotNode = await createBacteriaNode(makeCtx());
        noSlotNode.onMeterData(vi.fn());
        expect(raf).not.toHaveBeenCalled();

        const view = new Float32Array(32);
        view[BACTERIA_IDX.inputDb] = -6;
        view[BACTERIA_IDX.outputDb] = -3;
        view[BACTERIA_IDX.latency] = 128;
        view[BACTERIA_IDX.bandLevelsBase] = 1; // linear 1.0 → 0 dB
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

        const node = await createBacteriaNode(makeCtx());
        const cb = vi.fn();
        node.onMeterData(cb);
        rafCallbacks[0]!(0);

        expect(cb).toHaveBeenCalledTimes(1);
        const data = cb.mock.calls[0]![0] as {
            inputDb: number;
            outputDb: number;
            latency: number;
            bandLevels: number[];
        };
        expect(data).toEqual({
            inputDb: -6,
            outputDb: -3,
            latency: 128,
            bandLevels: [0, -100, -100, -100, -100, -100],
        });
    });

    it('should invoke the latency callback when the worklet posts a latency-changed message', async () => {
        const node = await createBacteriaNode(makeCtx());
        const cb = vi.fn();
        node.onLatencyChanged(cb);

        node.workletNode.port.onmessage?.({ data: { type: 'latency-changed', latency: 42 } } as MessageEvent);

        expect(cb).toHaveBeenCalledWith(42);
    });

    it('should connect to the destination and swallow a disconnect error instead of throwing', async () => {
        disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const node = await createBacteriaNode(makeCtx());
        const dest = {} as AudioNode;

        node.connect(dest);
        expect(connect).toHaveBeenCalledWith(dest);
        expect(() => node.disconnect()).not.toThrow();
    });

    it('should release the telemetry slot, cancel polling, disconnect and close the port on destroy', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 64,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        vi.stubGlobal('requestAnimationFrame', () => 7);
        const cancelRaf = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelRaf);

        const node = await createBacteriaNode(makeCtx());
        node.onMeterData(vi.fn());

        node.destroy();
        postMessage.mockClear();
        node.setParam('band5_drive', 0.4);
        node.setBypass(true);
        node.destroy();

        expect(postMessage).not.toHaveBeenCalled();
        expect(telemetryAllocator.releaseSlot).toHaveBeenCalledWith(64);
        expect(cancelRaf).toHaveBeenCalledWith(7);
        expect(disconnect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('should expose the underlying worklet node and a ready promise', async () => {
        const node = await createBacteriaNode(makeCtx());

        expect(node.workletNode).toBeDefined();
        await expect(node.ready).resolves.toEqual({});
    });

    it('cancels a prior meter rAF before installing a new polling loop', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 0,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        const rafCallbacks: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        const cancelRaf = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelRaf);

        const node = await createBacteriaNode(makeCtx());
        node.onMeterData(vi.fn());
        // A second registration cancels the first scheduled frame (the
        // `meterRafId !== null` guard) before starting a fresh loop.
        node.onMeterData(vi.fn());

        expect(cancelRaf).toHaveBeenCalledWith(1);
    });

    it('destroy is a safe no-op when no slot was allocated and no poll is running', async () => {
        const cancelRaf = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelRaf);

        const node = await createBacteriaNode(makeCtx());
        node.destroy();

        expect(cancelRaf).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('skips the latency handler when the handshake classifies the message as ready/late', async () => {
        const { createReadyHandshake } = await import('#/infra/audioWorklet/workletInitShared');
        vi.mocked(createReadyHandshake).mockReturnValueOnce({
            promise: Promise.resolve({}),
            onMessage: () => 'ready' as const,
            reject: () => 'late' as const,
            isSettled: () => true,
        });

        const node = await createBacteriaNode(makeCtx());
        const cb = vi.fn();
        node.onLatencyChanged(cb);

        node.workletNode.port.onmessage?.({ data: { type: 'latency-changed', latency: 9 } } as MessageEvent);
        // outcome was 'ready', not 'other' → latency handler skipped.
        expect(cb).not.toHaveBeenCalled();
    });
});
