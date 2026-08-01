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
    fetchWasmBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'late' as const,
        cancel: vi.fn(),
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

    it('waits for the processor disposal acknowledgement before closing the port', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.destroy();
        result.destroy();

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'dispose' });
        expect(close).not.toHaveBeenCalled();

        node.port.onmessage?.({ data: { type: 'disposed' } } as MessageEvent);

        expect(close).toHaveBeenCalledTimes(1);
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

    it('noteOff always forwards regardless of bypass state', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.noteOff(60, 128);
        expect(postMessage).toHaveBeenCalledWith({ type: 'noteOff', note: 60, sampleFrame: 128 });
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
