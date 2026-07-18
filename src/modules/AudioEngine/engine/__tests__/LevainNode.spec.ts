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
        isSettled: () => true,
    })),
}));

vi.mock('../../services/levainProcessor.ts?worker&url', () => ({ default: 'levain-processor-url' }));

// A post-ready worklet fault must surface through the onFault callback so the
// caller can flip engineReady back to false (obs. 3 — engineReady was a
// write-once latch that never reflected a WASM panic).
describe('createLevainNode runtime-fault notification', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let node: { port: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((e: MessageEvent) => void) | null } };

    beforeEach(() => {
        postMessage = vi.fn();
        node = { port: { postMessage, onmessage: null } };
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
        const node = { port: { postMessage, onmessage: null as ((e: MessageEvent) => void) | null } };
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
});
