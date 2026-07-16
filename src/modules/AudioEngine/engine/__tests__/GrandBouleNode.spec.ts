import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createGrandBouleNode, isGrandBouleDevice } from '../GrandBouleNode';

describe('isGrandBouleDevice', () => {
    it('should return true only for the grand-boule device type string', () => {
        expect(isGrandBouleDevice('grand-boule')).toBe(true);
        expect(isGrandBouleDevice('levain')).toBe(false);
    });
});

// Mock worklet-init + SharedArrayBuffer guard so createGrandBouleNode resolves
// without a real AudioContext / worklet module / cross-origin isolation.
vi.mock('../workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'ready' as const,
        isSettled: () => true,
    })),
}));

vi.mock('../pluginHostingErrors', () => ({ requireSharedArrayBuffer: vi.fn() }));

vi.mock('../../services/grandBouleProcessor.ts?worker&url', () => ({ default: 'grand-boule-processor-url' }));

// Grand Boule routes MIDI/control to its engine Worker, not the worklet. On
// bypass, held voices must be released at the source; setBypass only gates new
// noteOn, so without an explicit allNotesOff the Worker keeps rendering held
// voices into the SAB ring the worklet copies out.
describe('createGrandBouleNode bypass releases held voices', () => {
    let workerPostMessage: ReturnType<typeof vi.fn>;
    let ctx: BaseAudioContext;

    beforeEach(() => {
        workerPostMessage = vi.fn();
        class FakeWorker {
            postMessage = workerPostMessage;
            onmessage: ((e: MessageEvent) => void) | null = null;
            terminate = vi.fn();
        }
        class FakeWorkletNode {
            port = { postMessage: vi.fn(), close: vi.fn() };
            connect = vi.fn();
            disconnect = vi.fn();
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

    it('posts allNotesOff to the engine worker when entering bypass', async () => {
        const result = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        result.setBypass(true);

        expect(workerPostMessage).toHaveBeenCalledWith({ type: 'allNotesOff' });
    });

    it('does not post allNotesOff when leaving bypass', async () => {
        const result = await createGrandBouleNode(ctx);
        workerPostMessage.mockClear();

        result.setBypass(false);

        expect(workerPostMessage).not.toHaveBeenCalledWith({ type: 'allNotesOff' });
    });
});
