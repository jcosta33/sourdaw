import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PROOF_CHAMBER_AUTOMATION_PARAM_IDS, createProofChamberNode, isProofChamberDevice } from '../ProofChamberNode';

const EXPECTED_ORDINALS = {
    mix: 0,
    decay: 1,
    damping: 2,
    predelay: 3,
    size: 4,
    mod_rate: 5,
    mod_depth: 6,
    diffusion: 7,
    high_cut: 8,
    low_cut: 9,
    width: 10,
    freeze: 11,
    shimmer: 12,
    shimmer_amount: 13,
    gravity: 14,
    early_late: 15,
    density: 16,
    decay_eq_0: 17,
    decay_eq_1: 18,
    decay_eq_2: 19,
    decay_eq_3: 20,
    decay_eq_4: 21,
    decay_eq_5: 22,
};

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

    it('posts each Dutch Oven control with its pinned unique ordinal', async () => {
        const node = await createProofChamberNode(makeCtx());
        const segments = [{ startFrame: 128, endFrame: 384, startValue: 0.25, endValue: 0.75 }];
        postMessage.mockClear();

        expect(PROOF_CHAMBER_AUTOMATION_PARAM_IDS).toEqual(EXPECTED_ORDINALS);
        expect(new Set(Object.values(EXPECTED_ORDINALS)).size).toBe(23);
        for (const [name, paramId] of Object.entries(EXPECTED_ORDINALS)) {
            expect(node.acceptsScheduledParam(name)).toBe(true);
            node.scheduleParam(name, segments);
            expect(postMessage).toHaveBeenLastCalledWith({ type: 'paramAutomation', paramId, segments });
        }
        expect(postMessage).toHaveBeenCalledTimes(23);
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
