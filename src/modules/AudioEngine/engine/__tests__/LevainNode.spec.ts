import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createLevainNode, isLevainDevice } from '../LevainNode';

describe('isLevainDevice', () => {
    it('should return true only for the levain device type string', () => {
        expect(isLevainDevice('levain')).toBe(true);
        expect(isLevainDevice('fermenter')).toBe(false);
        expect(isLevainDevice('')).toBe(false);
    });
});

// Mock the worklet-init helpers so createLevainNode resolves without a real
// AudioContext / worklet module / WASM fetch. `onMessage` returns 'late' so a
// post-ready `error` message is treated as a runtime fault (the branch under
// test), and the ready handshake resolves immediately so the factory completes.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue({
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        commit: vi.fn(),
        release: vi.fn(),
    }),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'late' as const,
        reject: vi.fn(() => 'error' as const),
        isSettled: () => true,
    })),
}));

vi.mock('../../services/levainProcessor.ts?worker&url', () => ({ default: 'levain-processor-url' }));

// A post-ready worklet fault must surface through the onFault callback so the
// caller can flip engineReady back to false (obs. 3 — engineReady was a
// write-once latch that never reflected a WASM panic).
describe('createLevainNode runtime-fault notification', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    let disconnect: ReturnType<typeof vi.fn>;
    let node: {
        port: {
            postMessage: ReturnType<typeof vi.fn>;
            close: ReturnType<typeof vi.fn>;
            onmessage: ((e: MessageEvent) => void) | null;
        };
    };

    beforeEach(() => {
        postMessage = vi.fn();
        close = vi.fn();
        disconnect = vi.fn();
        node = { port: { postMessage, close, onmessage: null } };
        class FakeWorkletNode {
            port = node.port;
            connect = vi.fn();
            disconnect = disconnect;
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('invokes onFault with the message when the worklet posts a post-ready error', async () => {
        const onFault = vi.fn();
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        await createLevainNode(ctx, undefined, onFault);

        // Simulate a WASM panic posted after the handshake already settled.
        node.port.onmessage?.({ data: { type: 'error', message: 'wasm panic' } } as MessageEvent);

        expect(onFault).toHaveBeenCalledTimes(1);
        expect(onFault).toHaveBeenCalledWith('wasm panic');
    });

    it('does not invoke onFault for a non-error late message', async () => {
        const onFault = vi.fn();
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        await createLevainNode(ctx, undefined, onFault);

        node.port.onmessage?.({ data: { type: 'meter', peakL: 0.5 } } as MessageEvent);

        expect(onFault).not.toHaveBeenCalled();
    });

    it('reports "Unknown error" for an error event that omits the message field', async () => {
        const onFault = vi.fn();
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        await createLevainNode(ctx, undefined, onFault);

        // An error with no `message` key exercises the cond-expr false arm.
        node.port.onmessage?.({ data: { type: 'error' } } as MessageEvent);

        expect(onFault).toHaveBeenCalledWith('Unknown error');
    });
});

// A disposed processor frees its bank in bounded steps the node paces with
// `releaseDisposedBanks` messages, so the port has to stay open until the
// worklet reports done, reports an error, or loses its context.
describe('createLevainNode disposal release', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    let disconnect: ReturnType<typeof vi.fn>;
    let node: {
        port: {
            postMessage: ReturnType<typeof vi.fn>;
            close: ReturnType<typeof vi.fn>;
            onmessage: ((e: MessageEvent) => void) | null;
        };
    };
    let stateListeners: (() => void)[];
    let ctx: { currentTime: number; state: string; addEventListener: unknown; removeEventListener: unknown };
    let removeEventListener: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postMessage = vi.fn();
        close = vi.fn();
        disconnect = vi.fn();
        node = { port: { postMessage, close, onmessage: null } };
        class FakeWorkletNode {
            port = node.port;
            connect = vi.fn();
            disconnect = disconnect;
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        stateListeners = [];
        removeEventListener = vi.fn((_type: string, listener: () => void) => {
            stateListeners = stateListeners.filter((registered) => registered !== listener);
        });
        ctx = {
            currentTime: 0,
            state: 'running',
            addEventListener: vi.fn((_type: string, listener: () => void) => {
                stateListeners.push(listener);
            }),
            removeEventListener,
        };
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    function receive(data: unknown): void {
        node.port.onmessage?.({ data } as MessageEvent);
    }

    it('paces the release after the disposal acknowledgement and closes the port only on done', async () => {
        const result = await createLevainNode(ctx as unknown as BaseAudioContext);
        postMessage.mockClear();

        result.destroy();
        result.destroy();

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'dispose' });
        expect(close).not.toHaveBeenCalled();
        postMessage.mockClear();

        receive({ type: 'disposed' });

        expect(close).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenLastCalledWith({ type: 'releaseDisposedBanks' });

        receive({ type: 'disposedBanksReleased', done: false });
        receive({ type: 'disposedBanksReleased', done: false });

        expect(close).not.toHaveBeenCalled();
        expect(postMessage).toHaveBeenCalledTimes(3);

        receive({ type: 'disposedBanksReleased', done: true });

        expect(close).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledTimes(3);
        expect(removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function));
    });

    it('starts one release loop however many times the processor acknowledges disposal', async () => {
        const result = await createLevainNode(ctx as unknown as BaseAudioContext);
        result.destroy();
        postMessage.mockClear();

        receive({ type: 'disposed' });
        receive({ type: 'disposed' });

        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('closes the port when the worklet reports an error during the release', async () => {
        const onFault = vi.fn();
        const result = await createLevainNode(ctx as unknown as BaseAudioContext, undefined, onFault);
        result.destroy();
        receive({ type: 'disposed' });
        expect(close).not.toHaveBeenCalled();

        receive({ type: 'error', message: 'wasm trap' });

        expect(close).toHaveBeenCalledTimes(1);
        expect(onFault).not.toHaveBeenCalled();
    });

    it('closes the port when the context closes mid-release and not for another state change', async () => {
        const result = await createLevainNode(ctx as unknown as BaseAudioContext);
        result.destroy();
        receive({ type: 'disposed' });
        const [listener] = stateListeners;
        if (!listener) {
            throw new TypeError('Expected a statechange listener after destroy');
        }

        ctx.state = 'suspended';
        listener();
        expect(close).not.toHaveBeenCalled();

        ctx.state = 'closed';
        listener();

        expect(close).toHaveBeenCalledTimes(1);

        receive({ type: 'disposedBanksReleased', done: true });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('closes the port at once when destroyed on a closed live AudioContext', async () => {
        const result = await createLevainNode(ctx as unknown as BaseAudioContext);
        ctx.state = 'closed';
        postMessage.mockClear();

        result.destroy();

        expect(close).toHaveBeenCalledTimes(1);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('posts dispose and keeps the port open when destroyed on a suspended context', async () => {
        const result = await createLevainNode(ctx as unknown as BaseAudioContext);
        ctx.state = 'suspended';
        postMessage.mockClear();

        result.destroy();

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'dispose' });
        expect(close).not.toHaveBeenCalled();
    });

    describe('on a closed OfflineAudioContext, which still answers its worklet port', () => {
        function stubOfflineContext(): void {
            class FakeOfflineAudioContext {}
            vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
            Object.setPrototypeOf(ctx, FakeOfflineAudioContext.prototype);
        }

        it('posts dispose, drains to done and closes the port only then', async () => {
            stubOfflineContext();
            const result = await createLevainNode(ctx as unknown as BaseAudioContext);
            ctx.state = 'closed';
            postMessage.mockClear();

            result.destroy();

            expect(postMessage).toHaveBeenCalledTimes(1);
            expect(postMessage).toHaveBeenCalledWith({ type: 'dispose' });
            expect(close).not.toHaveBeenCalled();

            receive({ type: 'disposed' });
            receive({ type: 'disposedBanksReleased', done: false });

            expect(postMessage).toHaveBeenLastCalledWith({ type: 'releaseDisposedBanks' });
            expect(postMessage).toHaveBeenCalledTimes(3);
            expect(close).not.toHaveBeenCalled();

            receive({ type: 'disposedBanksReleased', done: true });

            expect(close).toHaveBeenCalledTimes(1);
        });

        it('keeps draining when its state changes to closed mid-drain', async () => {
            stubOfflineContext();
            const result = await createLevainNode(ctx as unknown as BaseAudioContext);
            result.destroy();
            receive({ type: 'disposed' });
            const [listener] = stateListeners;
            if (!listener) {
                throw new TypeError('Expected a statechange listener after destroy');
            }

            ctx.state = 'closed';
            listener();

            expect(close).not.toHaveBeenCalled();

            receive({ type: 'disposedBanksReleased', done: true });

            expect(close).toHaveBeenCalledTimes(1);
        });
    });
});

// Bypass-entry voice release is owned by TrackNode.updateBypass, which calls
// controller.allNotesOff() (the Levain worklet's message handler dispatches it
// to the WASM instance even while the processor is muted). setBypass itself
// only posts the bypass mute — no in-node allNotesOff, or the release burst
// suppression path would run twice per bypass entry.
describe('createLevainNode bypass and allNotesOff surfaces', () => {
    let postMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postMessage = vi.fn();
        const node = {
            port: { postMessage, close: vi.fn(), onmessage: null as ((e: MessageEvent) => void) | null },
        };
        class FakeWorkletNode {
            port = node.port;
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('allNotesOff posts the silent release message the worklet honors', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.allNotesOff();

        expect(postMessage).toHaveBeenCalledWith({ type: 'allNotesOff' });
    });

    it('setBypass posts only the bypass mute — release is TrackNode-owned', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.setBypass(true);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'bypass', bypassed: true });
    });

    it('un-bypass posts only the bypass unmute', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.setBypass(false);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'bypass', bypassed: false });
    });

    it('noteOn posts while unbypassed and is suppressed while bypassed', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        // Unbypassed → noteOn forwards to the worklet.
        result.noteOn(60, 100);
        expect(postMessage).toHaveBeenCalledWith({ type: 'noteOn', note: 60, velocity: 100, sampleFrame: undefined });

        // Bypassed → noteOn is a no-op. setBypass itself posts the bypass mute;
        // clear after it so only the subsequent noteOn is observed.
        result.setBypass(true);
        postMessage.mockClear();
        result.noteOn(60, 100);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('posts the immutable per-note articulation without changing note timing or channel', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.noteOn(62, 96, 6000, 4, 8);

        expect(postMessage).toHaveBeenCalledWith({
            type: 'noteOn',
            note: 62,
            velocity: 96,
            sampleFrame: 6000,
            channel: 4,
            articulationId: 8,
        });
    });

    it('noteOff always forwards regardless of bypass state', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.noteOff(60, 128);
        expect(postMessage).toHaveBeenCalledWith({ type: 'noteOff', note: 60, sampleFrame: 128 });
    });

    it('handleCc posts the controller with the frame it should land on', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.handleCc(64, 127, 4_096);
        expect(postMessage).toHaveBeenCalledWith({ type: 'cc', cc: 64, value: 127, sampleFrame: 4_096 });

        postMessage.mockClear();
        result.handleCc(1, 40);
        expect(postMessage).toHaveBeenCalledWith({ type: 'cc', cc: 1, value: 40, sampleFrame: undefined });
    });

    it('handleCc marks a move stored playback posts, and only that one, and discardStoredCc posts the discard', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.handleCc(11, 20, 4_096, true);
        expect(postMessage).toHaveBeenCalledWith({ type: 'cc', cc: 11, value: 20, sampleFrame: 4_096, stored: true });

        postMessage.mockClear();
        result.handleCc(11, 90, 4_096);
        expect(postMessage).toHaveBeenCalledWith({ type: 'cc', cc: 11, value: 90, sampleFrame: 4_096 });
        expect(postMessage.mock.calls[0]?.[0].stored).toBeUndefined();

        postMessage.mockClear();
        result.discardStoredCc();
        expect(postMessage).toHaveBeenCalledWith({ type: 'discardStoredCc' });
    });

    it('setParam forwards finite values and drops non-finite ones', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.setParam('gain', 0.5);
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'gain', value: 0.5 });

        // NaN and Infinity must be dropped (never forwarded to the worklet).
        postMessage.mockClear();
        result.setParam('gain', Number.NaN);
        result.setParam('gain', Number.POSITIVE_INFINITY);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('resumes a suspended AudioContext before wiring the worklet', async () => {
        const resume = vi.fn().mockResolvedValue(undefined);
        const suspendedCtx = {
            currentTime: 0,
            state: 'suspended',
            resume,
        } as unknown as AudioContext;
        // Stub the global so `instanceof AudioContext` holds for the fake ctx.
        class FakeAudioContext {}
        vi.stubGlobal('AudioContext', FakeAudioContext);
        Object.setPrototypeOf(suspendedCtx, FakeAudioContext.prototype);

        await createLevainNode(suspendedCtx);
        expect(resume).toHaveBeenCalledTimes(1);
    });
});
