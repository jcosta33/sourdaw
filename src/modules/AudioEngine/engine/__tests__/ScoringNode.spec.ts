import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createScoringNode, isScoringDevice } from '../ScoringNode';

// Mock the worklet-init helpers so createScoringNode resolves without a real
// AudioContext / worklet module / WASM fetch. The ready handshake resolves
// immediately so the factory's `await` chain completes.
vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: vi.fn().mockResolvedValue(undefined),
    fetchWasmModule: vi.fn().mockResolvedValue(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))),
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: () => 'other' as const,
        isSettled: () => true,
    })),
}));

// SAB requirement is satisfied in the test environment; make it a no-op so the
// factory does not throw before reaching setParam.
vi.mock('../pluginHostingErrors', () => ({ requireSharedArrayBuffer: vi.fn() }));

// No telemetry slot by default; individual tests override allocateSlot to
// exercise the slot-present branches (init-sab post, explicit telemetry polling).
vi.mock('../telemetryAllocator', async () => {
    const actual = await vi.importActual<typeof import('../telemetryAllocator')>('../telemetryAllocator');
    return { ...actual, telemetryAllocator: { allocateSlot: vi.fn(() => null), releaseSlot: vi.fn() } };
});

vi.mock('../../services/scoringProcessor.ts?worker&url', () => ({ default: 'scoring-processor-url' }));

describe('isScoringDevice', () => {
    it('should return true only for the native-scoring device type string', () => {
        expect(isScoringDevice('native-scoring')).toBe(true);
        expect(isScoringDevice('proof')).toBe(false);
    });
});

describe('createScoringNode', () => {
    let postMessage: ReturnType<typeof vi.fn>;
    let disconnect: ReturnType<typeof vi.fn>;
    let connect: ReturnType<typeof vi.fn>;
    let close: ReturnType<typeof vi.fn>;
    let resume: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        postMessage = vi.fn();
        disconnect = vi.fn();
        connect = vi.fn();
        close = vi.fn();
        resume = vi.fn().mockResolvedValue(undefined);

        class FakeWorkletNode {
            port = { postMessage, onmessage: null as ((e: MessageEvent) => void) | null, close };
            connect = connect;
            disconnect = disconnect;
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);

        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue(null);
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
        await createScoringNode(makeCtx('suspended'));
        expect(resume).toHaveBeenCalledTimes(1);

        resume.mockClear();
        await createScoringNode(makeCtx('running'));
        expect(resume).not.toHaveBeenCalled();
    });

    it('should guard on SharedArrayBuffer availability and post init-sab only when a slot was allocated', async () => {
        const { requireSharedArrayBuffer } = await import('../pluginHostingErrors');
        const { telemetryAllocator } = await import('../telemetryAllocator');

        await createScoringNode(makeCtx());
        expect(requireSharedArrayBuffer).toHaveBeenCalledWith('Scoring');
        expect(postMessage.mock.calls.some((c) => (c[0] as { type?: string }).type === 'init-sab')).toBe(false);

        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValueOnce({
            sab: {} as SharedArrayBuffer,
            byteOffset: 96,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        postMessage.mockClear();

        await createScoringNode(makeCtx());

        expect(postMessage).toHaveBeenCalledWith({ type: 'init-sab', sab: expect.anything(), byteOffset: 96 });
    });

    it('should forward a finite setParam value and drop a non-finite one', async () => {
        const node = await createScoringNode(makeCtx());
        postMessage.mockClear();

        node.setParam('sensitivity', 0.6);
        node.setParam('sensitivity', Number.NaN);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith({ type: 'param', name: 'sensitivity', value: 0.6 });
    });

    it('should forward setBypass as a bypass message', async () => {
        const node = await createScoringNode(makeCtx());
        postMessage.mockClear();

        node.setBypass(true);
        expect(postMessage).toHaveBeenCalledWith({ type: 'bypass', bypassed: true });

        node.setBypass(false);
        expect(postMessage).toHaveBeenCalledWith({ type: 'bypass', bypassed: false });
    });

    it('delivers telemetry only when explicitly polled with a slot, deriving noteName from noteIndex', async () => {
        const { telemetryAllocator, SCORING_IDX } = await import('../telemetryAllocator');
        const raf = vi.fn();
        vi.stubGlobal('requestAnimationFrame', raf);

        const noSlotNode = await createScoringNode(makeCtx());
        const noSlotCallback = vi.fn();
        noSlotNode.onTelemetry(noSlotCallback);
        noSlotNode.pollTelemetry();
        expect(noSlotCallback).not.toHaveBeenCalled();
        expect(raf).not.toHaveBeenCalled();

        const view = new Float32Array(32);
        view[SCORING_IDX.active] = 1;
        view[SCORING_IDX.frequency] = 440;
        view[SCORING_IDX.cents] = -3.5;
        view[SCORING_IDX.confidence] = 0.875;
        view[SCORING_IDX.noteIndex] = 9; // A
        view[SCORING_IDX.octave] = 4;
        view[SCORING_IDX.midiNote] = 69;
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 0,
            view,
            seqView: new Int32Array(32),
        });
        const node = await createScoringNode(makeCtx());
        const cb = vi.fn();
        node.onTelemetry(cb);
        node.pollTelemetry();

        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith({
            active: true,
            frequency: 440,
            cents: -3.5,
            confidence: 0.875,
            noteIndex: 9,
            octave: 4,
            midiNote: 69,
            noteName: 'A',
        });
        expect(raf).not.toHaveBeenCalled();
    });

    it('should report an inactive, zeroed telemetry frame when the active flag is unset', async () => {
        const { telemetryAllocator, SCORING_IDX } = await import('../telemetryAllocator');
        const view = new Float32Array(32);
        view[SCORING_IDX.active] = 0;
        view[SCORING_IDX.frequency] = 440;
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 0,
            view,
            seqView: new Int32Array(32),
        });
        const node = await createScoringNode(makeCtx());
        const cb = vi.fn();
        node.onTelemetry(cb);
        node.pollTelemetry();

        expect(cb).toHaveBeenCalledWith({
            active: false,
            frequency: 0,
            cents: 0,
            confidence: 0,
            noteIndex: 0,
            octave: 0,
            midiNote: 0,
            noteName: '',
        });
    });

    it('should connect to the destination and swallow a disconnect error instead of throwing', async () => {
        disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        const node = await createScoringNode(makeCtx());
        const dest = {} as AudioNode;

        node.connect(dest);
        expect(connect).toHaveBeenCalledWith(dest);
        expect(() => node.disconnect()).not.toThrow();
    });

    it('releases the telemetry slot, stops callback delivery, disconnects and closes the port on destroy', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 32,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        const node = await createScoringNode(makeCtx());
        const callback = vi.fn();
        node.onTelemetry(callback);

        node.destroy();
        node.pollTelemetry();

        expect(telemetryAllocator.releaseSlot).toHaveBeenCalledWith(32);
        expect(callback).not.toHaveBeenCalled();
        expect(disconnect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('should expose the underlying worklet node and a ready promise', async () => {
        const node = await createScoringNode(makeCtx());

        expect(node.workletNode).toBeDefined();
        await expect(node.ready).resolves.toEqual({});
    });

    it('replaces the registered telemetry callback without starting a recurring scheduler', async () => {
        const { telemetryAllocator } = await import('../telemetryAllocator');
        vi.mocked(telemetryAllocator.allocateSlot).mockReturnValue({
            sab: {} as SharedArrayBuffer,
            byteOffset: 0,
            view: new Float32Array(32),
            seqView: new Int32Array(32),
        });
        const raf = vi.fn();
        vi.stubGlobal('requestAnimationFrame', raf);

        const node = await createScoringNode(makeCtx());
        const first = vi.fn();
        const second = vi.fn();
        node.onTelemetry(first);
        node.onTelemetry(second);
        node.pollTelemetry();

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect(raf).not.toHaveBeenCalled();
    });

    it('destroy is safe when no telemetry slot was allocated', async () => {
        const node = await createScoringNode(makeCtx());
        node.destroy();

        expect(disconnect).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });
});
