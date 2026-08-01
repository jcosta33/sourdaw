import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createProofChamberNode, isProofChamberDevice } from '../ProofChamberNode';

// Mock the worklet-init helpers so createProofChamberNode resolves without a
// real AudioContext / worklet module / WASM fetch. The ready handshake
// resolves immediately so the factory's `await` chain completes.
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

vi.mock('../../services/proofChamberProcessor.ts?worker&url', () => ({ default: 'proof-chamber-processor-url' }));

describe('isProofChamberDevice', () => {
    it('should return true only for the dutch-oven device type string', () => {
        expect(isProofChamberDevice('dutch-oven')).toBe(true);
        expect(isProofChamberDevice('proof')).toBe(false);
    });
});

describe('createProofChamberNode', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let disconnect: ReturnType<typeof vi.fn>;
    let connect: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    let resume: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postMessage = vi.fn();
        disconnect = vi.fn();
        connect = vi.fn();
        close = vi.fn();
        resume = vi.fn().mockResolvedValue(undefined);

        class FakeWorkletNode {
            port = { postMessage, onmessage: null, close };
            connect = connect;
            disconnect = disconnect;
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
        await createProofChamberNode(makeCtx('suspended'));
        expect(resume).toHaveBeenCalledTimes(1);

        resume.mockClear();
        await createProofChamberNode(makeCtx('running'));
        expect(resume).not.toHaveBeenCalled();
    });

    it('should forward a finite setParam value as a param message', async () => {
        const node = await createProofChamberNode(makeCtx());
        postMessage.mockClear();

        node.setParam('decay', 2.4);

        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'decay', value: 2.4 });
    });

    it('should drop a non-finite setParam value instead of posting it', async () => {
        const node = await createProofChamberNode(makeCtx());
        postMessage.mockClear();

        node.setParam('decay', Number.NaN);
        node.setParam('decay', Number.POSITIVE_INFINITY);

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('posts validated frame-addressed parameter automation as one worklet message', async () => {
        const node = await createProofChamberNode(makeCtx());
        postMessage.mockClear();
        const segments = [{ startFrame: 0, endFrame: 48_000, startValue: 0.2, endValue: 0.9 }];

        node.scheduleParam('mix', segments);

        expect(node.acceptsScheduledParam('mix')).toBe(true);
        expect(node.acceptsScheduledParam('constructor')).toBe(false);
        expect(postMessage).toHaveBeenCalledWith({ type: 'paramAutomation', paramId: 0, segments });

        postMessage.mockClear();
        node.scheduleParam('constructor', segments);

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('should forward setBypass as a bypass message', async () => {
        const node = await createProofChamberNode(makeCtx());
        postMessage.mockClear();

        node.setBypass(true);

        expect(postMessage).toHaveBeenCalledWith({ type: 'bypass', bypassed: true });
    });

    it('should connect the underlying worklet node to the given destination', async () => {
        const node = await createProofChamberNode(makeCtx());
        const dest = {} as AudioNode;

        node.connect(dest);

        expect(connect).toHaveBeenCalledWith(dest);
    });

    it('should swallow a disconnect error instead of throwing', async () => {
        disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const node = await createProofChamberNode(makeCtx());

        expect(() => node.disconnect()).not.toThrow();
        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('should disconnect and close the port on destroy', async () => {
        const node = await createProofChamberNode(makeCtx());

        node.destroy();

        expect(disconnect).toHaveBeenCalledTimes(1);
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('should expose the underlying worklet node and a ready promise', async () => {
        const node = await createProofChamberNode(makeCtx());

        expect(node.workletNode).toBeDefined();
        await expect(node.ready).resolves.toEqual({});
    });
});
