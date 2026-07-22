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
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmBinary: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'ready' as const,
        isSettled: () => true,
    })),
}));

vi.mock('../../services/fermenterProcessor.ts?worker&url', () => ({ default: 'fermenter-processor-url' }));

// Bypass-entry voice release is owned by TrackNode.updateBypass, which calls
// `controller.allNotesOff()` when entering bypass. The node must therefore
// expose an `allNotesOff` surface posting the single worklet message the
// Fermenter processor honors (same message the transport-stop path posts) —
// without it, TrackNode's mechanism cannot cover Fermenter and held voices
// keep sounding through bypass.
describe('createFermenterNode allNotesOff surface', () => {
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

    it('posts the allNotesOff worklet message', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        postMessage.mockClear(); // drop the init postMessage

        result.allNotesOff();

        expect(postMessage).toHaveBeenCalledWith({ type: 'allNotesOff' });
    });

    it('setBypass only gates new notes — release is TrackNode-owned, no in-node post', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        postMessage.mockClear();

        result.setBypass(true);

        expect(postMessage).not.toHaveBeenCalled();
    });

    it('posts validated frame-addressed parameter automation as one worklet message', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        postMessage.mockClear();
        const segments = [{ startFrame: 0, endFrame: 48_000, startValue: 200, endValue: 2_000 }];

        result.scheduleParam('filterCutoff', segments);

        expect(postMessage).toHaveBeenCalledWith({ type: 'paramAutomation', name: 'filterCutoff', segments });
    });
});
