import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { createGrinderNode, isGrinderDevice } from '../GrinderNode';

// Mock the worklet-init helpers so createGrinderNode resolves without a real
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
vi.mock('../pluginHostingErrors', () => ({
    requireSharedArrayBuffer: vi.fn(),
}));

// No telemetry slot by default; individual tests override allocateSlot to
// exercise the slot-present branches (init-sab post, meter polling).
vi.mock('../telemetryAllocator', async () => {
    const actual = await vi.importActual<typeof import('../telemetryAllocator')>('../telemetryAllocator');
    return { ...actual, telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() } };
});

vi.mock('../../services/grinderProcessor.ts?worker&url', () => ({ default: 'grinder-processor-url' }));

describe('isGrinderDevice', () => {
    it('should return true only for the grinder device type string', () => {
        expect(isGrinderDevice('grinder')).toBe(true);
        expect(isGrinderDevice('proof')).toBe(false);
    });
});

describe('createGrinderNode', () => {
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
            parameters = new Map<string, unknown>();
            connect = connect;
            disconnect = disconnect;
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
        );

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
            currentTime = 0;
            resume = resume;
        }
        vi.stubGlobal('AudioContext', FakeAudioContext);
        return new FakeAudioContext() as unknown as BaseAudioContext;
    }

    it('should resume the context only when it starts out suspended', async () => {
        await createGrinderNode(makeCtx('suspended'));
        expect(resume).toHaveBeenCalledTimes(1);

        resume.mockClear();
        await createGrinderNode(makeCtx('running'));
        expect(resume).not.toHaveBeenCalled();
    });

    it('should propagate a shared WASM module load failure', async () => {
        const { fetchWasmModule } = await import('#/infra/audioWorklet/workletInitShared');
        vi.mocked(fetchWasmModule).mockRejectedValueOnce(new Error('Failed to fetch WASM: 500'));

        await expect(createGrinderNode(makeCtx())).rejects.toThrow('Failed to fetch WASM: 500');
    });

    it('should guard on SharedArrayBuffer availability and post init-sab only when a slot was allocated', async () => {
        const { requireSharedArrayBuffer } = await import('../pluginHostingErrors');
        const { telemetryAllocator } = await import('../telemetryAllocator');

        await createGrinderNode(makeCtx());
        expect(requireSharedArrayBuffer).toHaveBeenCalledWith('Grinder');
        expect(postMessage.mock.calls.some((c) => (c[0] as { type?: string }).type === 'init-sab')).toBe(false);

        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValueOnce({
            sab: {} as SharedArrayBuffer,
            byteOffset: 64,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        postMessage.mockClear();

        await createGrinderNode(makeCtx());

        expect(postMessage).toHaveBeenCalledWith({ type: 'init-sab', sab: expect.anything(), byteOffset: 64 });
    });

    it('should forward setPatch and compile setBypass as a typed fallback control', async () => {
        const node = await createGrinderNode(makeCtx(), undefined, undefined, {
            trackId: 'track-1',
            deviceId: 'grinder-1',
            deviceType: 'grinder',
            parameterIds: ['unmapped-param'],
        });
        const initialization = postMessage.mock.calls.find(
            (call) => (call[0] as { command?: string }).command === 'initialize-fallback-control'
        )?.[0];
        expect(initialization).toEqual({
            schemaVersion: 1,
            command: 'initialize-fallback-control',
            target: {
                trackId: 'track-1',
                deviceId: 'grinder-1',
                deviceType: 'grinder',
                parameterIds: ['unmapped-param', 'bypass'],
            },
            correlation: { workletGeneration: expect.any(Number) },
        });
        expect(Object.isFrozen(initialization)).toBe(true);
        expect(Object.isFrozen((initialization as { target: unknown }).target)).toBe(true);
        postMessage.mockClear();

        node.setPatch({ drive: 0.5 });
        expect(postMessage).toHaveBeenCalledWith({ type: 'patch', patch: { drive: 0.5 } });

        node.setBypass(true);
        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                schemaVersion: 1,
                command: 'set-fallback-param',
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterId: 'bypass',
                },
                value: 1,
                correlation: {
                    workletGeneration: expect.any(Number),
                    controlSequence: 1,
                },
            })
        );

        node.setBypass(false);
        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                schemaVersion: 1,
                command: 'set-fallback-param',
                target: expect.objectContaining({ parameterId: 'bypass' }),
                value: 0,
                correlation: expect.objectContaining({ controlSequence: 2 }),
            })
        );
    });

    it('ramps a named AudioParam directly when the worklet exposes it', async () => {
        const node = await createGrinderNode(makeCtx(), undefined, undefined, {
            trackId: 'track-1',
            deviceId: 'grinder-1',
            deviceType: 'grinder',
            parameterIds: ['unmapped-param'],
        });
        postMessage.mockClear();
        // Inject a real AudioParam-backed slot so setParam takes the
        // `node.parameters.get(name)` path (setTargetAtTime) instead of the
        // message-port coalescing path.
        const setTarget = vi.fn();
        (node.workletNode.parameters as Map<string, unknown>).set('drive', { setTargetAtTime: setTarget });

        node.setParam('drive', 0.7);

        expect(setTarget).toHaveBeenCalledWith(0.7, 0, 0.01);
        // The message-port path was NOT taken.
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('schedules an AudioParam from its sample frame and clamps past frames to the current context time', async () => {
        const ctx = makeCtx() as BaseAudioContext & { currentTime: number; sampleRate: number };
        Object.assign(ctx, { currentTime: 1.5, sampleRate: 48_000 });
        const node = await createGrinderNode(ctx, undefined, undefined, {
            trackId: 'track-1',
            deviceId: 'grinder-1',
            deviceType: 'grinder',
            parameterIds: ['drive'],
        });
        const setTarget = vi.fn();
        (node.workletNode.parameters as Map<string, unknown>).set('drive', { setTargetAtTime: setTarget });

        node.setParam('drive', 0.7, 96_000);
        node.setParam('drive', 0.2, 48_000);

        expect(setTarget).toHaveBeenNthCalledWith(1, 0.7, 2, 0.01);
        expect(setTarget).toHaveBeenNthCalledWith(2, 0.2, 1.5, 0.01);
    });

    it('drops a non-finite setParam value without touching the param or port', async () => {
        const node = await createGrinderNode(makeCtx());
        postMessage.mockClear();
        const setTarget = vi.fn();
        (node.workletNode.parameters as Map<string, unknown>).set('drive', { setTargetAtTime: setTarget });

        node.setParam('drive', Number.NaN);
        node.setParam('drive', Number.POSITIVE_INFINITY);

        expect(setTarget).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('drops an unbound fallback parameter instead of posting the legacy raw port message', async () => {
        vi.stubGlobal('requestAnimationFrame', undefined);
        const node = await createGrinderNode(makeCtx());
        postMessage.mockClear();

        node.setParam('unknown-fallback-param', 0.5);

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('rejects a scheduled fallback control when telemetry capacity cannot acknowledge a latency change', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue(null);
        const node = await createGrinderNode(makeCtx(), undefined, undefined, {
            trackId: 'track-1',
            deviceId: 'grinder-1',
            deviceType: 'grinder',
            parameterIds: ['latency-control'],
        });
        expect(telemetryAllocator.allocateSlot).toHaveReturnedWith(null);
        postMessage.mockClear();

        node.setParam('latency-control', 0.5, 48_000);

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('should invoke the latency callback only for a latency-changed message with a numeric latency', async () => {
        const node = await createGrinderNode(makeCtx());
        const cb = vi.fn();
        node.onLatencyChanged(cb);

        node.workletNode.port.onmessage?.({ data: { type: 'other-thing' } } as MessageEvent);
        expect(cb).not.toHaveBeenCalled();

        node.workletNode.port.onmessage?.({ data: { type: 'latency-changed', latency: 42 } } as MessageEvent);
        expect(cb).toHaveBeenCalledWith(42);
    });

    it('should log a runtime fault for a late error event, defaulting the message when absent, and ignore other late events', async () => {
        const { createReadyHandshake } = await import('#/infra/audioWorklet/workletInitShared');
        vi.spyOn(logger, 'warn').mockImplementation(() => {});
        vi.mocked(createReadyHandshake).mockReturnValueOnce({
            promise: Promise.resolve({}),
            onMessage: () => 'late' as const,
            reject: () => 'late' as const,
            isSettled: () => true,
        });

        const node = await createGrinderNode(makeCtx());

        node.workletNode.port.onmessage?.({ data: { type: 'ping' } } as MessageEvent);
        expect(logger.warn).not.toHaveBeenCalled();

        node.workletNode.port.onmessage?.({ data: { type: 'error' } } as MessageEvent);
        expect(logger.warn).toHaveBeenCalledWith(
            'GrinderNode runtime fault (WASM panic — processor faulted):',
            'Unknown error'
        );

        node.workletNode.port.onmessage?.({ data: { type: 'error', message: 'panic' } } as MessageEvent);
        expect(logger.warn).toHaveBeenCalledWith(
            'GrinderNode runtime fault (WASM panic — processor faulted):',
            'panic'
        );
    });

    it('should schedule a meter poll only once a telemetry slot is available, defaulting missing fields to 0', async () => {
        const { telemetryAllocator, GRINDER_IDX } = await import('../telemetryAllocator');
        const raf = vi.fn();
        vi.stubGlobal('requestAnimationFrame', raf);

        const noSlotNode = await createGrinderNode(makeCtx());
        noSlotNode.onMeterData(vi.fn());
        expect(raf).not.toHaveBeenCalled();

        const view = new Float32Array(6); // shorter than a full slot: exercises the ?? 0 fallback
        view[GRINDER_IDX.inputDb] = -12;
        view[GRINDER_IDX.preampDb] = 3;
        view[GRINDER_IDX.powerAmpDb] = 1.5;
        view[GRINDER_IDX.outputDb] = -2;
        view[GRINDER_IDX.gateOpen] = 1;
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 0,
            view,
            // Full-length seqlock view: the counter lives at the last slot index
            // (31), so the reader needs the whole slot even when the float view
            // under test is deliberately short.
            seqView: new Int32Array(32),
        });
        const rafCallbacks: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        const node = await createGrinderNode(makeCtx());
        const cb = vi.fn();
        node.onMeterData(cb);
        rafCallbacks[0]!(0);

        expect(cb).toHaveBeenCalledWith({
            inputDb: -12,
            preampDb: 3,
            powerAmpDb: 1.5,
            outputDb: -2,
            gateOpen: 1,
            gateEnvelopeDb: 0,
            sagVoltage: 0,
            latency: 0,
            neuralCpuPercent: 0,
            neuralWarmupProgress: 0,
        });
    });

    it('refreshes latency from the telemetry signal outside the worklet render callback', async () => {
        const { telemetryAllocator, GRINDER_IDX } = await import('../telemetryAllocator');
        const view = new Float32Array(32);
        view[GRINDER_IDX.latency] = 96;
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

        const node = await createGrinderNode(makeCtx());
        const latencyCallback = vi.fn();
        node.onLatencyChanged(latencyCallback);
        node.onMeterData(vi.fn());
        rafCallbacks[0]!(0);

        expect(latencyCallback).toHaveBeenCalledWith(96);
    });

    it('should connect to the destination and swallow a disconnect error instead of throwing', async () => {
        disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const node = await createGrinderNode(makeCtx());
        const dest = {} as AudioNode;

        node.connect(dest);
        expect(connect).toHaveBeenCalledWith(dest);
        expect(() => node.disconnect()).not.toThrow();
    });

    it('should release the telemetry slot, cancel the meter poll and pending param flush, disconnect and close the port on destroy', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 96,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        let nextId = 10;
        vi.stubGlobal('requestAnimationFrame', () => nextId++);
        const cancelRaf = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelRaf);

        const node = await createGrinderNode(makeCtx());
        node.onMeterData(vi.fn()); // schedules a meter poll (meterRafId = 10)
        node.onMeterData(vi.fn()); // cancels 10, reschedules (meterRafId = 11)
        node.setParam('unmapped-param', 0.5); // queues a param flush (paramFlushRafId = 12)

        node.destroy();

        expect(cancelRaf).toHaveBeenCalledWith(10);
        expect(cancelRaf).toHaveBeenCalledWith(11);
        expect(cancelRaf).toHaveBeenCalledWith(12);
        expect(telemetryAllocator.releaseSlot).toHaveBeenCalledWith(96);
        expect(disconnect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('destroy is a safe no-op when no slot, poll, or param flush is active', async () => {
        // Default allocateSlot returns null; onMeterData and setParam never
        // called → all three destroy guards take their false arms.
        const cancelRaf = vi.fn();
        vi.stubGlobal('cancelAnimationFrame', cancelRaf);

        const node = await createGrinderNode(makeCtx());
        node.destroy();

        expect(cancelRaf).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('should post message-port params immediately when requestAnimationFrame is unavailable', async () => {
        vi.stubGlobal('requestAnimationFrame', undefined);

        const node = await createGrinderNode(makeCtx(), undefined, undefined, {
            trackId: 'track-1',
            deviceId: 'grinder-1',
            deviceType: 'grinder',
            parameterIds: ['unmapped-param'],
        });
        postMessage.mockClear();

        node.setParam('unmapped-param', 0.42);

        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                schemaVersion: 1,
                command: 'set-fallback-param',
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterId: 'unmapped-param',
                },
                value: 0.42,
                scheduling: { targetFrame: null, deadlineFrame: null },
            })
        );
    });

    it('should expose the underlying worklet node and a ready promise', async () => {
        const node = await createGrinderNode(makeCtx());

        expect(node.workletNode).toBeDefined();
        await expect(node.ready).resolves.toEqual({});
    });
});

// ── Fix 9: message-port params coalesce per animation frame ──
//
// A param with no backing AudioParam is forwarded to the worklet via
// postMessage. A rapid live knob drag fires setParam many times per frame;
// without coalescing each call is its own structured-clone post, flooding the
// port. The node buffers the latest immediate value per name and flushes once
// per requestAnimationFrame; scheduled automation keeps every point.
describe('GrinderNode setParam coalescing', () => {
    let rafCallbacks: FrameRequestCallback[];
    let postMessage: ReturnType<typeof vi.fn>;
    let parameters: Map<string, unknown>;

    beforeEach(() => {
        rafCallbacks = [];
        postMessage = vi.fn();
        // Empty parameters map → every setParam takes the postMessage path.
        parameters = new Map();

        class FakeWorkletNode {
            port = { postMessage, onmessage: null, close: vi.fn() };
            parameters = parameters;
            connect = vi.fn();
            disconnect = vi.fn();
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
        // Capture rAF callbacks so the test controls when a frame flushes.
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            rafCallbacks.push(cb);
            return rafCallbacks.length;
        });
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        // Grinder fetches its WASM via its own fetcher; return a valid response.
        vi.stubGlobal(
            'fetch',
            vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
        );
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function flushFrame(): void {
        const cbs = rafCallbacks.splice(0);
        for (const cb of cbs) {
            cb(performance.now());
        }
    }

    async function makeNode() {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        return createGrinderNode(ctx, undefined, undefined, {
            trackId: 'track-1',
            deviceId: 'grinder-1',
            deviceType: 'grinder',
            parameterIds: ['drive', 'tone'],
        });
    }

    it('collapses repeated posts of one param into a single post per frame', async () => {
        const node = await makeNode();
        postMessage.mockClear(); // ignore the init post

        // A rapid sweep: many setParam calls within one frame.
        node.setParam('drive', 0.1);
        node.setParam('drive', 0.4);
        node.setParam('drive', 0.9);

        // Nothing posted yet — buffered until the frame flush.
        const paramPostsBeforeFrame = postMessage.mock.calls.filter(
            (c) => (c[0] as { command?: string })?.command === 'set-fallback-param'
        );
        expect(paramPostsBeforeFrame.length).toBe(0);

        flushFrame();

        // Exactly one post, carrying the LAST value of the sweep.
        const paramPosts = postMessage.mock.calls.filter(
            (c) => (c[0] as { command?: string })?.command === 'set-fallback-param'
        );
        expect(paramPosts.length).toBe(1);
        expect(paramPosts[0]![0]).toEqual(
            expect.objectContaining({
                schemaVersion: 1,
                command: 'set-fallback-param',
                target: {
                    trackId: 'track-1',
                    deviceId: 'grinder-1',
                    deviceType: 'grinder',
                    parameterId: 'drive',
                },
                value: 0.9,
                scheduling: { targetFrame: null, deadlineFrame: null },
            })
        );
    });

    it('preserves ordered scheduled controls for one parameter before a frame flush', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 0,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        const node = await makeNode();
        postMessage.mockClear();

        node.setParam('drive', 0.2, 1_024);
        node.setParam('drive', 0.8, 2_048);

        const scheduledPostsBeforeFrame = postMessage.mock.calls.filter(
            (call) => (call[0] as { command?: string }).command === 'set-fallback-param'
        );
        expect(scheduledPostsBeforeFrame).toHaveLength(2);
        flushFrame();

        const scheduledPosts = postMessage.mock.calls
            .map((call) => call[0])
            .filter(
                (
                    message
                ): message is {
                    command: 'set-fallback-param';
                    value: number;
                    correlation: { controlSequence: number };
                    scheduling: { targetFrame: number; deadlineFrame: number };
                } => (message as { command?: string }).command === 'set-fallback-param'
            );
        expect(scheduledPosts).toEqual([
            expect.objectContaining({
                value: 0.2,
                correlation: expect.objectContaining({ controlSequence: 1 }),
                scheduling: { targetFrame: 1_024, deadlineFrame: 1_152 },
            }),
            expect.objectContaining({
                value: 0.8,
                correlation: expect.objectContaining({ controlSequence: 2 }),
                scheduling: { targetFrame: 2_048, deadlineFrame: 2_176 },
            }),
        ]);
    });

    it('posts the latest value per distinct param name in one frame', async () => {
        const node = await makeNode();
        postMessage.mockClear();

        node.setParam('drive', 0.5);
        node.setParam('tone', 0.2);
        node.setParam('drive', 0.7);

        flushFrame();

        const paramPosts = postMessage.mock.calls
            .filter((c) => (c[0] as { command?: string })?.command === 'set-fallback-param')
            .map((c) => c[0]);
        expect(paramPosts).toContainEqual(
            expect.objectContaining({ target: expect.objectContaining({ parameterId: 'drive' }), value: 0.7 })
        );
        expect(paramPosts).toContainEqual(
            expect.objectContaining({ target: expect.objectContaining({ parameterId: 'tone' }), value: 0.2 })
        );
        expect(paramPosts.length).toBe(2);
    });
});
