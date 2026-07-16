import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createFermenterNode, isFermenterDevice } from '../FermenterNode';

describe('isFermenterDevice', () => {
    it('should return true only for the fermenter device type string', () => {
        expect(isFermenterDevice('fermenter')).toBe(true);
        expect(isFermenterDevice('levain')).toBe(false);
    });
});

// Mock the worklet-init helpers so createFermenterNode resolves without a real
// AudioContext / worklet module / WASM fetch. The ready handshake resolves
// immediately so the factory completes.
vi.mock('../workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'ready' as const,
        isSettled: () => true,
    })),
}));

vi.mock('../../services/fermenterProcessor.ts?worker&url', () => ({ default: 'fermenter-processor-url' }));

// Entering bypass must release any voices already held. The Fermenter worklet
// keeps running while bypassed (setBypass only gates *new* noteOn), so without
// an explicit release the held voices keep sounding. Mirror the transport-stop
// path (createWebAudioEngine.stopAllScheduled), which posts a single
// `allNotesOff` the Fermenter worklet honors by releasing all voices.
describe('createFermenterNode bypass releases held voices', () => {
    let postMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        postMessage = vi.fn();
        const port = { postMessage, onmessage: null, close: vi.fn() };
        class FakeWorkletNode {
            port = port;
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('posts allNotesOff when entering bypass', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        postMessage.mockClear(); // drop the init postMessage

        result.setBypass(true);

        expect(postMessage).toHaveBeenCalledWith({ type: 'allNotesOff' });
    });

    it('does not post allNotesOff when leaving bypass', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        postMessage.mockClear();

        result.setBypass(false);

        expect(postMessage).not.toHaveBeenCalledWith({ type: 'allNotesOff' });
    });
});
