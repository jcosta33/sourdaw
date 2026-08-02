import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createKneadNode, isKneadDevice } from '../KneadNode';

// Mock the worklet-init helpers so createKneadNode resolves without a real
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

vi.mock('../../services/kneadProcessor.ts?worker&url', () => ({ default: 'knead-processor-url' }));

describe('isKneadDevice', () => {
    it('should match the knead device type case-insensitively', () => {
        expect(isKneadDevice('knead')).toBe(true);
        expect(isKneadDevice('KNEAD')).toBe(true);
        expect(isKneadDevice('gluten')).toBe(false);
    });
});

describe('createKneadNode', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let resume: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postMessage = vi.fn();
        resume = vi.fn().mockResolvedValue(undefined);

        class FakeWorkletNode {
            port = { postMessage, onmessage: null, close: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
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
        await createKneadNode(makeCtx('suspended'));
        expect(resume).toHaveBeenCalledTimes(1);

        resume.mockClear();
        await createKneadNode(makeCtx('running'));
        expect(resume).not.toHaveBeenCalled();
    });

    it('should post the init message with the transport SAB on creation', async () => {
        const ctx = makeCtx('running');
        const sab = {} as SharedArrayBuffer;

        await createKneadNode(ctx, sab);

        const initPost = postMessage.mock.calls.find((c) => (c[0] as { type?: string }).type === 'init');
        expect(initPost).toBeDefined();
        expect((initPost![0] as { transportSAB?: unknown }).transportSAB).toBe(sab);
    });

    it('should forward setParam as a param message carrying the name and value', async () => {
        const ctx = makeCtx('running');
        const node = await createKneadNode(ctx);
        postMessage.mockClear();

        node.setParam('formant', 0.75);

        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'formant', value: 0.75 });
    });

    it('should forward setParam array values unchanged for pitch-blob updates', async () => {
        const ctx = makeCtx('running');
        const node = await createKneadNode(ctx);
        postMessage.mockClear();

        node.setParam('pitchBlob', [1, 2, 3]);

        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'pitchBlob', value: [1, 2, 3] });
    });

    it('should forward setBypass as a bypass message', async () => {
        const ctx = makeCtx('running');
        const node = await createKneadNode(ctx);
        postMessage.mockClear();

        node.setBypass(true);

        expect(postMessage).toHaveBeenCalledWith({ type: 'bypass', bypassed: true });
    });

    it('should forward updateState as an update-state message carrying the clips', async () => {
        const ctx = makeCtx('running');
        const node = await createKneadNode(ctx);
        postMessage.mockClear();

        const clips = { 'clip-1': { pitch: [0, 1, 2] } };
        node.updateState(clips);

        expect(postMessage).toHaveBeenCalledWith({ type: 'update-state', clips });
    });

    it('should disconnect the worklet and close its port when destroyed', async () => {
        const node = await createKneadNode(makeCtx('running'));

        node.destroy();

        expect(node.workletNode.disconnect).toHaveBeenCalledTimes(1);
        expect(node.workletNode.port.close).toHaveBeenCalledTimes(1);
    });

    it('should expose the underlying worklet node and a ready promise', async () => {
        const ctx = makeCtx('running');
        const node = await createKneadNode(ctx);

        expect(node.workletNode).toBeDefined();
        await expect(node.ready).resolves.toEqual({});
    });
});
