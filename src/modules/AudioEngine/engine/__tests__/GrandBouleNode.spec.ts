import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { dropoutCounters } from '../dropoutCounter';
import { createGrandBouleNode, isGrandBouleDevice } from '../GrandBouleNode';

describe('isGrandBouleDevice', () => {
    it('should return true only for the grand-boule device type string', () => {
        expect(isGrandBouleDevice('grand-boule')).toBe(true);
        expect(isGrandBouleDevice('levain')).toBe(false);
    });
});

// Mock worklet-init + SharedArrayBuffer guard so createGrandBouleNode resolves
// without a real AudioContext / worklet module / cross-origin isolation.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'ready' as const,
        isSettled: () => true,
    })),
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
type PostedInit = { type: 'init'; syncSab?: unknown; contextFrame?: number };

function findInitMessage(spy: PostMessageSpy): PostedInit | undefined {
    for (const [message] of spy.mock.calls) {
        if (message !== null && typeof message === 'object' && 'type' in message && message.type === 'init') {
            const { syncSab, contextFrame } = message as PostedInit;
            return { type: 'init', syncSab, contextFrame };
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
    let lastWorker: { onmessage: ((e: MessageEvent) => void) | null } | undefined;
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

        // A plain constructor function (not a class) so the fake worker instance
        // can be captured without aliasing `this` — returning an object from a
        // `new`-invoked function replaces the implicit `this` with that object.
        function FakeWorker() {
            const instance = {
                postMessage: workerPostMessage,
                onmessage: null as ((e: MessageEvent) => void) | null,
                terminate: workerTerminate,
            };
            lastWorker = instance;
            return instance;
        }
        class FakeWorkletNode {
            port = { postMessage: nodePostMessage, close: nodeClose };
            connect = nodeConnect;
            disconnect = nodeDisconnect;
        }
        class FakeSharedArrayBuffer {
            constructor(_byteLength: number) {}
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

    it('should post an init message to the worklet once the engine worker reports ready', async () => {
        await createGrandBouleNode(ctx);
        nodePostMessage.mockClear();

        lastWorker?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);

        // The worklet is handed the ring SAB plus the shared dropout counters, so
        // ring starvation is tallied instead of silently emitting silence (RT-10),
        // plus the sync slot it publishes its render-cursor offset into — the only
        // thing that tells the engine worker where the context clock stands.
        expect(nodePostMessage).toHaveBeenCalledWith({
            type: 'init',
            sab: expect.anything(),
            dropoutSab: dropoutCounters.getSab(),
            syncSab: expect.anything(),
        });
    });

    it('hands the engine worker the same sync slot it gave the worklet, plus the context anchor', async () => {
        await createGrandBouleNode(ctx);
        lastWorker?.onmessage?.({ data: { type: 'ready' } } as MessageEvent);

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

    it('should expose the underlying worklet node and a ready promise', async () => {
        const node = await createGrandBouleNode(ctx);

        expect(node.workletNode).toBeDefined();
        await expect(node.ready).resolves.toEqual({});
    });
});
