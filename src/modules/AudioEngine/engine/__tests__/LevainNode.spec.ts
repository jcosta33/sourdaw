import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createLevainNode, isLevainDevice } from '../LevainNode';
import { LEVAIN_IDX, telemetryAllocator, TELEMETRY_SEQ_IDX } from '../telemetryAllocator';

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
    fetchWasmModule: vi.fn().mockResolvedValue(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))),
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

    it('reports "Unknown error" for an error event that omits the message field', async () => {
        const onFault = vi.fn();
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;

        await createLevainNode(ctx, undefined, onFault);

        // An error with no `message` key exercises the cond-expr false arm.
        node.port.onmessage?.({ data: { type: 'error' } } as MessageEvent);

        expect(onFault).toHaveBeenCalledWith('Unknown error');
    });
});

// Bypass-entry voice release is owned by TrackNode.updateBypass, which calls
// controller.allNotesOff(). setBypass only gates new noteOn locally: TrackNode
// removes the generator from the audible graph while the processor completes
// its release and reaches DSP-owned sleep.
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

    it('setBypass hard-stops sounding state before TrackNode disconnects the generator', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.setBypass(true);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'allSoundsOff' });
    });

    it('un-bypass does not send processor control messages', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        result.setBypass(false);

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('noteOn posts while unbypassed and is suppressed while bypassed', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        postMessage.mockClear();

        // Unbypassed → noteOn forwards to the worklet.
        result.noteOn(60, 100);
        expect(postMessage).toHaveBeenCalledWith({ type: 'noteOn', note: 60, velocity: 100, sampleFrame: undefined });

        // Bypassed → noteOn is a no-op.
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

describe('createLevainNode processor lifecycle telemetry', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    let onmessage: ((event: MessageEvent<unknown>) => void) | null;

    beforeEach(() => {
        postMessage = vi.fn();
        close = vi.fn();
        onmessage = null;
        class FakeWorkletNode {
            port = {
                postMessage,
                close,
                get onmessage() {
                    return onmessage;
                },
                set onmessage(handler: ((event: MessageEvent<unknown>) => void) | null) {
                    onmessage = handler;
                },
            };
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('projects stable lifecycle codes published by the worklet SAB', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        const initMessage = postMessage.mock.calls
            .map(([message]) => message as { type?: string; sab?: SharedArrayBuffer; byteOffset?: number })
            .find((message) => message.type === 'init-sab');

        expect(initMessage?.sab).toBeInstanceOf(SharedArrayBuffer);
        expect(result.processorLifecycle()).toBeNull();

        const byteOffset = initMessage?.byteOffset ?? 0;
        const values = new Float32Array(initMessage!.sab!, byteOffset);
        const sequence = new Int32Array(initMessage!.sab!, byteOffset);
        values[LEVAIN_IDX.lifecycle] = 3;
        Atomics.store(sequence, TELEMETRY_SEQ_IDX, 2);

        expect(result.processorLifecycle()).toBe('sleep');
    });

    it('releases the telemetry slot only after the processor acknowledges disposal', async () => {
        const releaseSlot = vi.spyOn(telemetryAllocator, 'releaseSlot');
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);

        result.destroy();

        expect(postMessage).toHaveBeenCalledWith({ type: 'dispose' });
        expect(releaseSlot).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();

        onmessage?.({ data: { type: 'disposed' } } as MessageEvent<unknown>);

        expect(releaseSlot).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('stops reporting stale lifecycle state after a runtime fault', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createLevainNode(ctx);
        const initMessage = postMessage.mock.calls
            .map(([message]) => message as { type?: string; sab?: SharedArrayBuffer; byteOffset?: number })
            .find((message) => message.type === 'init-sab');
        const byteOffset = initMessage?.byteOffset ?? 0;
        const values = new Float32Array(initMessage!.sab!, byteOffset);
        const sequence = new Int32Array(initMessage!.sab!, byteOffset);
        values[LEVAIN_IDX.lifecycle] = 0;
        Atomics.store(sequence, TELEMETRY_SEQ_IDX, 2);
        expect(result.processorLifecycle()).toBe('continue');

        onmessage?.({ data: { type: 'error', message: 'wasm trap' } } as MessageEvent<unknown>);

        expect(result.processorLifecycle()).toBeNull();
    });
});
