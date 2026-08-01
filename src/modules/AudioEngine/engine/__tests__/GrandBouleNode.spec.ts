import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ensureWorkletRegistered } from '#/infra/audioWorklet/workletInitShared';

import { dropoutCounters } from '../dropoutCounter';
import { createGrandBouleNode, isGrandBouleDevice } from '../GrandBouleNode';
import { requireSharedArrayBuffer } from '../pluginHostingErrors';

describe('isGrandBouleDevice', () => {
    it('should return true only for the grand-boule device type string', () => {
        expect(isGrandBouleDevice('grand-boule')).toBe(true);
        expect(isGrandBouleDevice('levain')).toBe(false);
    });
});

// Mock worklet-init + SharedArrayBuffer guard so createGrandBouleNode resolves
// without a real AudioContext / worklet module / cross-origin isolation.
//
// The handshake stand-in settles only when a `ready` message actually arrives,
// because that is the property under test. The previous stand-in resolved
// unconditionally, which is precisely why nothing here could observe that
// `ready` was answering for the engine worker alone.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    createReadyHandshake: vi.fn(() => {
        let settle: (data: Record<string, unknown>) => void = () => {};
        let fail: (reason: Error) => void = () => {};
        let settled = false;
        const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
            settle = resolve;
            fail = reject;
        });
        return {
            promise,
            onMessage: (event: MessageEvent) => {
                const data: unknown = event.data;
                if (data === null || typeof data !== 'object') {
                    return 'other' as const;
                }
                const { type } = data as { type?: unknown };
                if (type !== 'ready' && type !== 'error') {
                    return 'other' as const;
                }
                if (settled) {
                    return 'late' as const;
                }
                settled = true;
                if (type === 'error') {
                    // Same narrowing the real helper does, so a non-string
                    // message degrades to the generic text rather than to
                    // '[object Object]'.
                    const { message } = data as { message?: unknown };
                    fail(new Error(typeof message === 'string' ? message : 'init error'));
                    return 'error' as const;
                }
                settle(data as Record<string, unknown>);
                return 'ready' as const;
            },
            isSettled: () => settled,
        };
    }),
}));

vi.mock('../pluginHostingErrors', () => ({ requireSharedArrayBuffer: vi.fn() }));

vi.mock('../../services/grandBouleProcessor.ts?worker&url', () => ({ default: 'grand-boule-processor-url' }));

// Grand Boule routes MIDI/control to its engine Worker, not the worklet.
// Bypass-entry voice release is owned by TrackNode.updateBypass, which calls
// controller.allNotesOff() — this surface must post to the engine Worker, and
// setBypass itself must stay a flag flip (no in-node post, or the release
// would run twice per bypass entry).
/**
 * A `postMessage` spy typed at the surface it actually stands in for, so the
 * recorded calls read back as `unknown` rather than `any`.
 */
type PostMessageSpy = ReturnType<typeof vi.fn<(message: unknown, transfer?: readonly unknown[]) => void>>;

/** The `init` payload out of a `postMessage` spy's recorded calls, if it sent one. */
type PostedInit = {
    type: 'init';
    sab?: SharedArrayBuffer;
    dropoutSab?: SharedArrayBuffer;
    syncSab?: SharedArrayBuffer;
    contextFrame?: number;
    countPreRollStarvation?: boolean;
};

function findInitMessage(spy: PostMessageSpy): PostedInit | undefined {
    for (const [message] of spy.mock.calls) {
        if (message !== null && typeof message === 'object' && 'type' in message && message.type === 'init') {
            const { sab, dropoutSab, syncSab, contextFrame, countPreRollStarvation } = message as PostedInit;
            return { type: 'init', sab, dropoutSab, syncSab, contextFrame, countPreRollStarvation };
        }
    }
    return undefined;
}

describe('createGrandBouleNode', () => {
    let workerPostMessage: PostMessageSpy;
    let workerTerminate: ReturnType<typeof vi.fn>;
    let nodePostMessage: PostMessageSpy;
    let nodeClose: ReturnType<typeof vi.fn>;
    let nodeConnect: ReturnType<typeof vi.fn>;
    let nodeDisconnect: ReturnType<typeof vi.fn>;
    let resume: ReturnType<typeof vi.fn>;
    let lastWorker:
        | {
              onmessage: ((e: MessageEvent) => void) | null;
              onerror: ((e: ErrorEvent) => void) | null;
          }
        | undefined;
    let lastNodePort: { onmessage: ((e: MessageEvent) => void) | null } | undefined;
    let lastWorkletNode: object | undefined;
    let lastProcessorName: string | undefined;
    let workerConstructed = 0;
    let sharedArrayBuffersAllocated = 0;
    let ctx: BaseAudioContext;

    beforeEach(() => {
        workerPostMessage = vi.fn();
        workerTerminate = vi.fn();
        nodePostMessage = vi.fn();
        nodeClose = vi.fn();
        nodeConnect = vi.fn();
        nodeDisconnect = vi.fn();
        resume = vi.fn().mockResolvedValue(undefined);
        lastWorker = undefined;
        lastNodePort = undefined;
        lastWorkletNode = undefined;
        lastProcessorName = undefined;
        workerConstructed = 0;
        sharedArrayBuffersAllocated = 0;

        // A plain constructor function (not a class) so the fake worker instance
        // can be captured without aliasing `this` — returning an object from a
        // `new`-invoked function replaces the implicit `this` with that object.
        function FakeWorker() {
            workerConstructed++;
            const instance = {
                postMessage: workerPostMessage,
                onmessage: null as ((e: MessageEvent) => void) | null,
                onerror: null as ((e: ErrorEvent) => void) | null,
                terminate: workerTerminate,
            };
            lastWorker = instance;
            return instance;
        }
        // Same plain-constructor trick as FakeWorker above, for the same reason:
        // the created node has to be captured, and returning an object from a
        // `new`-invoked function replaces the implicit `this` with that object.
        function FakeWorkletNode(_context: unknown, processorName?: string) {
            lastProcessorName = processorName;
            const instance = {
                port: {
                    postMessage: nodePostMessage,
                    close: nodeClose,
                    onmessage: null as ((e: MessageEvent) => void) | null,
                },
                connect: nodeConnect,
                disconnect: nodeDisconnect,
            };
            lastNodePort = instance.port;
            lastWorkletNode = instance;
            return instance;
        }
        const NativeSharedArrayBuffer = globalThis.SharedArrayBuffer;
        function FakeSharedArrayBuffer(byteLength: number) {
            sharedArrayBuffersAllocated++;
            return new NativeSharedArrayBuffer(byteLength);
        }
        vi.stubGlobal('Worker', FakeWorker);
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal('SharedArrayBuffer', FakeSharedArrayBuffer);
        const fetchResponse = { ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetchResponse));
        ctx = { currentTime: 0, state: 'running', sampleRate: 48000 } as unknown as BaseAudioContext;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function makeSuspendableCtx(state: 'running' | 'suspended') {
        class FakeAudioContext {
            state = state;
            currentTime = 0;
            sampleRate = 48000;
            resume = resume;
        }
        vi.stubGlobal('AudioContext', FakeAudioContext);
        return new FakeAudioContext() as unknown as BaseAudioContext;
    }

    it('posts allNotesOff to the engine worker', async () => {
        const result = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        result.allNotesOff();

        expect(workerPostMessage).toHaveBeenCalledWith({ type: 'allNotesOff' });
    });

    it('setBypass only gates new notes — release is TrackNode-owned, no in-node post', async () => {
        const result = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        result.setBypass(true);

        expect(workerPostMessage).not.toHaveBeenCalled();
    });

    it('should resume the context only when it starts out suspended', async () => {
        await createGrandBouleNode(makeSuspendableCtx('suspended'));
        expect(resume).toHaveBeenCalledTimes(1);

        resume.mockClear();
        await createGrandBouleNode(makeSuspendableCtx('running'));
        expect(resume).not.toHaveBeenCalled();
    });

    it('should reject when the Grand Boule WASM fetch response is not ok', async () => {
        vi.resetModules();
        const { createGrandBouleNode: freshCreate } = await import('../GrandBouleNode');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));

        await expect(freshCreate(ctx)).rejects.toThrow('Failed to fetch Grand Boule WASM: 500');
    });

    it('hands the worklet its ring at construction, without waiting for the engine worker', async () => {
        await createGrandBouleNode(ctx);

        // Nothing in the worklet's init depends on the engine worker having
        // started: the ring, the dropout counters and the sync slot all exist
        // before either side runs. Gating this on the worker's `ready` only
        // narrowed the window in which the worklet could still be holding no
        // ring once a render began.
        //
        // The worklet is handed the ring SAB plus the shared dropout counters, so
        // ring starvation is tallied instead of silently emitting silence (RT-10),
        // plus the sync slot it publishes its render-cursor offset into — the only
        // thing that tells the engine worker where the context clock stands.
        const workletInit = findInitMessage(nodePostMessage);
        const workerInit = findInitMessage(workerPostMessage);
        if (!workerInit?.syncSab) {
            throw new Error('worker init did not receive its consumer-offset slot');
        }
        expect(workletInit).toEqual({
            type: 'init',
            sab: workerInit.sab,
            dropoutSab: dropoutCounters.getSab(),
            syncSab: workerInit.syncSab,
            contextFrame: undefined,
            countPreRollStarvation: false,
        });
        expect(Atomics.load(new Int32Array(workerInit.syncSab), 0)).toBe(-1);
    });

    it('does not report ready until the worklet confirms it holds the ring', async () => {
        const node = await createGrandBouleNode(ctx);
        let resolved = false;
        const watching = (async () => {
            await node.ready;
            resolved = true;
        })();

        lastWorker?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
        await new Promise((resolve) => setTimeout(resolve, 0));
        const afterWorkerOnly = resolved;

        lastNodePort?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
        await watching;

        // The offline strategy awaits this promise and then starts rendering. A
        // render that begins while the worklet still holds no ring emits total
        // silence and records zero dropouts, because `process()` returns at its
        // not-ready guard before the underrun is ever counted.
        expect({ afterWorkerOnly, afterBoth: resolved }).toEqual({ afterWorkerOnly: false, afterBoth: true });
    });

    it('rejects ready when either side reports an init error', async () => {
        const workerFailed = createGrandBouleNode(ctx).then((node) => {
            lastWorker?.onerror?.({ message: 'wasm compile failed' } as ErrorEvent);
            lastNodePort?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
            return node.ready;
        });
        await expect(workerFailed).rejects.toThrow('wasm compile failed');
        expect(nodePostMessage).toHaveBeenCalledWith({ type: 'engineError' });
        expect(workerTerminate).toHaveBeenCalledOnce();

        const workletFailed = createGrandBouleNode(ctx).then((node) => {
            lastWorker?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
            lastNodePort?.onmessage?.({ data: { type: 'error', message: 'ring map failed' } } as MessageEvent);
            return node.ready;
        });
        // A device that cannot come up has to reach `buildDeviceChain`, which
        // warns the export and drops it. Resolving `ready` on a half-built device
        // is what put an unannounced silent track in the file.
        await expect(workletFailed).rejects.toThrow('ring map failed');
    });

    it('stops the live consumer after a post-ready engine Worker crash', async () => {
        const node = await createGrandBouleNode(ctx);
        lastWorker?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
        lastNodePort?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
        await node.ready;
        nodePostMessage.mockClear();
        workerTerminate.mockClear();

        lastWorker?.onerror?.({ message: 'render failed' } as ErrorEvent);

        expect(nodePostMessage).toHaveBeenCalledWith({ type: 'engineError' });
        expect(workerTerminate).toHaveBeenCalledOnce();
    });

    it('builds the inline engine worklet offline and the worker ring live', async () => {
        class FakeOfflineAudioContext {
            state = 'suspended';
            currentTime = 0;
            sampleRate = 48000;
        }
        vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);

        await createGrandBouleNode(new FakeOfflineAudioContext() as unknown as BaseAudioContext);
        const offline = {
            processor: lastProcessorName,
            workers: workerConstructed,
            sharedBuffers: sharedArrayBuffersAllocated,
        };

        workerConstructed = 0;
        sharedArrayBuffersAllocated = 0;
        await createGrandBouleNode(ctx);
        const live = {
            processor: lastProcessorName,
            workers: workerConstructed,
            sharedBuffers: sharedArrayBuffersAllocated,
        };

        // This is the transport split. Offline there is no deadline for the ring
        // to protect (Web Audio §2.6) and its back-pressure is what starves an
        // export into silence, so the engine runs in the worklet itself: no
        // Worker, and no shared memory at all — not the ring, not the sync slot.
        // Live keeps both, because a starved ring drops out one device instead of
        // missing the graph deadline for every track.
        expect({ offline, live }).toEqual({
            offline: { processor: 'grand-boule-offline-processor', workers: 0, sharedBuffers: 0 },
            live: { processor: 'grand-boule-processor', workers: 1, sharedBuffers: 2 },
        });
    });

    it('hands the offline worklet the engine bytes, and nothing the ring needed', async () => {
        class FakeOfflineAudioContext {
            state = 'suspended';
            currentTime = 0;
            sampleRate = 48000;
        }
        vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);

        await createGrandBouleNode(new FakeOfflineAudioContext() as unknown as BaseAudioContext);
        const init = nodePostMessage.mock.calls
            .map(([message]) => message)
            .find(
                (message): message is Record<string, unknown> =>
                    message !== null && typeof message === 'object' && 'type' in message && message.type === 'init'
            );

        // The offline processor constructs its own `GrandBouleInstance`, so its
        // init is the WASM bytes and nothing else. A ring field surviving here
        // would mean the ring consumer was built by mistake — the failure mode
        // that produced a silent export reporting zero dropouts.
        expect({
            hasWasmBytes: init?.wasmBytes instanceof ArrayBuffer,
            ringFields: ['sab', 'syncSab', 'dropoutSab', 'countPreRollStarvation'].filter(
                (field) => init !== undefined && field in init
            ),
        }).toEqual({ hasWasmBytes: true, ringFields: [] });
    });

    it('refuses a live node without cross-origin isolation before doing any work for it', async () => {
        const gate = vi.mocked(requireSharedArrayBuffer);
        const registered = vi.mocked(ensureWorkletRegistered);
        const fetchSpy = vi.mocked(fetch);
        gate.mockImplementationOnce(() => {
            throw new Error('Grand Boule requires cross-origin isolation');
        });

        const rejected = createGrandBouleNode(ctx);

        // The gate has to precede the awaits, not just live inside the live
        // transport. Past them the user has already paid a `resume()`, a
        // permanent `addModule` registration on the context and a 554 KB wasm
        // download before being told the device cannot run — and an abort landing
        // during any of those replaces the typed error `buildDeviceChain` maps to
        // the isolation notification with an `AbortError`.
        await expect(rejected).rejects.toThrow('cross-origin isolation');
        expect({
            workletRegistrations: registered.mock.calls.length,
            wasmFetches: fetchSpy.mock.calls.length,
        }).toEqual({ workletRegistrations: 0, wasmFetches: 0 });
    });

    it('gates on SharedArrayBuffer only for the live ring, never for a render', async () => {
        class FakeOfflineAudioContext {
            state = 'suspended';
            currentTime = 0;
            sampleRate = 48000;
        }
        vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
        const gate = vi.mocked(requireSharedArrayBuffer);

        gate.mockClear();
        await createGrandBouleNode(new FakeOfflineAudioContext() as unknown as BaseAudioContext);
        const offlineChecks = gate.mock.calls.length;

        gate.mockClear();
        await createGrandBouleNode(ctx);
        const liveChecks = gate.mock.calls.length;

        // A browser without cross-origin isolation cannot host the live ring, so
        // the node refuses there. An export uses no shared memory at all, and
        // refusing it would make a project unexportable over a capability the
        // render never touches. The gate belongs to the transport, not the
        // factory.
        expect({ offlineChecks, liveChecks }).toEqual({ offlineChecks: 0, liveChecks: 1 });
    });

    it('hands the engine worker the same sync slot it gave the worklet, plus the context anchor', async () => {
        await createGrandBouleNode(ctx);

        const workletInit = findInitMessage(nodePostMessage);
        const workerInit = findInitMessage(workerPostMessage);

        // A different buffer on each side would leave the worker reading an
        // offset nobody writes, and every scheduled note would fall back to the
        // anchor for the whole session.
        expect({
            sameSyncSab: workerInit?.syncSab === workletInit?.syncSab,
            syncSabExists: workerInit?.syncSab !== undefined,
            contextFrame: workerInit?.contextFrame,
        }).toEqual({ sameSyncSab: true, syncSabExists: true, contextFrame: 0 });
    });

    it('should post noteOn to the engine worker unless bypassed', async () => {
        const node = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        node.noteOn(60, 100, 5);
        expect(workerPostMessage).toHaveBeenCalledWith({ type: 'noteOn', midiNote: 60, velocity: 100, sampleFrame: 5 });

        workerPostMessage.mockClear();
        node.setBypass(true);
        node.noteOn(60, 100);
        expect(workerPostMessage).not.toHaveBeenCalled();
    });

    it('should post noteOff with an explicit or defaulted release velocity', async () => {
        const node = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        node.noteOff(60, 5, 0.75);
        expect(workerPostMessage).toHaveBeenCalledWith({
            type: 'noteOff',
            midiNote: 60,
            sampleFrame: 5,
            releaseVelocity: 0.75,
        });

        workerPostMessage.mockClear();
        node.noteOff(60);
        expect(workerPostMessage).toHaveBeenCalledWith({
            type: 'noteOff',
            midiNote: 60,
            sampleFrame: undefined,
            releaseVelocity: 0,
        });
    });

    it('should forward a finite setParam value, drop a non-finite one, and post a temperament change', async () => {
        const node = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        node.setParam('brightness', 0.6);
        node.setParam('brightness', Number.NaN);

        expect(workerPostMessage).toHaveBeenCalledTimes(1);
        expect(workerPostMessage).toHaveBeenCalledWith({ type: 'param', name: 'brightness', value: 0.6 });

        workerPostMessage.mockClear();
        node.setTemperament(3);
        expect(workerPostMessage).toHaveBeenCalledWith({ type: 'temperament', index: 3 });
    });

    it('should post sustain, una corda and sostenuto messages', async () => {
        const node = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        node.setSustain(0.5);
        node.setUnaCorda(true);
        node.setSostenuto(false);

        expect(workerPostMessage).toHaveBeenCalledWith({ type: 'sustain', position: 0.5 });
        expect(workerPostMessage).toHaveBeenCalledWith({ type: 'unaCorda', engaged: true });
        expect(workerPostMessage).toHaveBeenCalledWith({ type: 'sostenuto', engaged: false });
    });

    it('should post noteOnMidi2 to the engine worker unless bypassed', async () => {
        const node = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        node.noteOnMidi2(60, 32000, 1024);
        expect(workerPostMessage).toHaveBeenCalledWith({
            type: 'noteOnMidi2',
            midiNote: 60,
            velocity16bit: 32000,
            pitchOffsetQ24: 1024,
        });

        workerPostMessage.mockClear();
        node.setBypass(true);
        node.noteOnMidi2(60, 32000, 1024);
        expect(workerPostMessage).not.toHaveBeenCalled();
    });

    it('should post a defensive copy of the attack-clip samples', async () => {
        const node = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();
        const samples = new Float32Array([0.1, 0.2, 0.3]);

        node.loadAttackClip(21, samples);

        const call = workerPostMessage.mock.calls[0]![0] as { type: string; key: number; samples: Float32Array };
        expect(call.type).toBe('loadAttackClip');
        expect(call.key).toBe(21);
        expect(call.samples).toEqual(samples);
        expect(call.samples).not.toBe(samples);
    });

    it('should connect to the destination and log a swallowed disconnect error', async () => {
        const node = await createGrandBouleNode(ctx);
        const dest = {} as AudioNode;

        node.connect(dest);
        expect(nodeConnect).toHaveBeenCalledWith(dest);

        nodeDisconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => node.disconnect()).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith('[GrandBouleNode] Disconnect failed:', expect.any(Error));
    });

    it('should log and continue cleanup when disconnect throws during destroy', async () => {
        nodeDisconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const node = await createGrandBouleNode(ctx);

        expect(() => node.destroy()).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
            '[GrandBouleNode] Disconnect failed during destroy:',
            expect.any(Error)
        );
        expect(nodeClose).toHaveBeenCalled();
        expect(workerTerminate).toHaveBeenCalled();
    });

    it('should expose the underlying worklet node and a ready promise carrying the worker payload', async () => {
        const node = await createGrandBouleNode(ctx);

        lastWorker?.onmessage?.({ data: { type: 'ready', engine: 'grand-boule' } } as MessageEvent);
        lastNodePort?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);

        expect(node.workletNode).toBe(lastWorkletNode);
        // The worker's payload is the one callers read; the worklet ack carries
        // nothing but its own arrival.
        await expect(node.ready).resolves.toEqual({ type: 'ready', engine: 'grand-boule' });
    });
});
