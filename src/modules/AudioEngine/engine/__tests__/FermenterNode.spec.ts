import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createFermenterNode, isFermenterDevice, type FermenterTelemetryData } from '../FermenterNode';

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
        if (!result.scheduleParam || !result.acceptsScheduledParam) {
            throw new Error('Expected Fermenter automation controls');
        }

        result.scheduleParam('filterCutoff', segments);

        expect(result.acceptsScheduledParam('filterCutoff')).toBe(true);
        expect(result.acceptsScheduledParam('missing')).toBe(false);
        expect(postMessage).toHaveBeenCalledWith({ type: 'paramAutomation', paramId: 1, segments });

        postMessage.mockClear();
        result.scheduleParam('constructor', segments);

        expect(result.acceptsScheduledParam('constructor')).toBe(false);
        expect(postMessage).not.toHaveBeenCalled();
    });
});

// Telemetry read path (audit RT-3). The worklet no longer posts a telemetry
// message; it publishes peaks + the scope waveform into a SAB slot under the
// shared seqlock, and the node polls that slot.
describe('createFermenterNode telemetry over the SAB slot', () => {
    const SEQ_IDX = 31;
    const SCOPE_BASE = 32;
    const SCOPE_SAMPLES = 128;

    let postMessage: ReturnType<typeof vi.fn>;
    /** Pending rAF callbacks by handle — a real registry so cancellation is real. */
    let rafCallbacks: Map<number, FrameRequestCallback>;
    let nextRafHandle: number;

    /** Run every rAF callback queued so far (the poll re-arms itself each tick). */
    function tickFrame(): void {
        const pending = [...rafCallbacks.values()];
        rafCallbacks.clear();
        for (const callback of pending) {
            callback(0);
        }
    }

    /** The slot the node handed the worklet via `init-sab`. */
    function slotViews(): { view: Float32Array; seqView: Int32Array } {
        const initSab = postMessage.mock.calls.find(
            (call) => (call[0] as { type?: string } | undefined)?.type === 'init-sab'
        );
        if (!initSab) {
            throw new Error('Expected the node to send an init-sab message');
        }
        const { sab, byteOffset } = initSab[0] as { sab: SharedArrayBuffer; byteOffset: number };
        return {
            view: new Float32Array(sab, byteOffset),
            seqView: new Int32Array(sab, byteOffset),
        };
    }

    /** Publish one telemetry block the way the worklet does: bracketed by the seqlock. */
    function publish(peakL: number, peakR: number, sampleAt: (index: number) => number): void {
        beginPublish(peakL, peakR);
        endPublish(sampleAt);
    }

    /** Open the seqlock and write only the peaks — the publish is now mid-flight. */
    function beginPublish(peakL: number, peakR: number): void {
        const { view, seqView } = slotViews();
        Atomics.store(seqView, SEQ_IDX, Atomics.load(seqView, SEQ_IDX) + 1);
        view[0] = peakL;
        view[1] = peakR;
    }

    /** Write the waveform and close the seqlock, settling the generation. */
    function endPublish(sampleAt: (index: number) => number): void {
        const { view, seqView } = slotViews();
        for (let index = 0; index < SCOPE_SAMPLES; index++) {
            view[SCOPE_BASE + index] = sampleAt(index);
        }
        Atomics.store(seqView, SEQ_IDX, Atomics.load(seqView, SEQ_IDX) + 1);
    }

    beforeEach(() => {
        postMessage = vi.fn();
        rafCallbacks = new Map();
        nextRafHandle = 1;
        const port = { postMessage, onmessage: null, close: vi.fn() };
        class FakeWorkletNode {
            port = port;
            connect = vi.fn();
            disconnect = vi.fn();
        }
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
            const handle = nextRafHandle++;
            rafCallbacks.set(handle, callback);
            return handle;
        });
        vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
            rafCallbacks.delete(handle);
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('hands the worklet a slot wide enough for the scope waveform', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        await createFermenterNode(ctx);

        const { view } = slotViews();

        // 32 scalar header floats (counter at 31) + 128 waveform samples.
        expect(view.length).toBe(160);
        expect(SCOPE_BASE + SCOPE_SAMPLES).toBe(view.length);
    });

    it('delivers the published peaks and waveform to the telemetry callback', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        const received: { peakL: number; peakR: number; scopeBuffer: Float32Array }[] = [];
        result.onTelemetry((data) => received.push(data));

        publish(0.75, 0.25, (index) => index / SCOPE_SAMPLES);
        tickFrame();

        expect(received).toHaveLength(1);
        expect(received[0]!.peakL).toBe(0.75);
        expect(received[0]!.peakR).toBe(0.25);
        expect(received[0]!.scopeBuffer).toHaveLength(SCOPE_SAMPLES);
        expect(received[0]!.scopeBuffer[64]).toBe(Math.fround(64 / SCOPE_SAMPLES));
    });

    it('emits once per publish, not once per polled frame', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        const received: FermenterTelemetryData[] = [];
        const callback = vi.fn((data: FermenterTelemetryData) => received.push(data));
        result.onTelemetry(callback);

        publish(0.5, 0.5, () => 0.1);
        tickFrame();
        // Three further frames with no new publish — the worklet publishes every
        // ~46 ms while rAF runs at ~16 ms, so most polls must be no-ops.
        tickFrame();
        tickFrame();
        tickFrame();

        expect(callback).toHaveBeenCalledTimes(1);

        publish(0.9, 0.9, () => 0.2);
        tickFrame();

        expect(callback).toHaveBeenCalledTimes(2);
        // fround: the slot is Float32, so 0.9 round-trips as the nearest f32.
        expect(received[1]!.peakL).toBe(Math.fround(0.9));
    });

    it('copies the waveform out of shared memory so a later publish cannot rewrite it', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        const received: { scopeBuffer: Float32Array }[] = [];
        result.onTelemetry((data) => received.push(data));

        publish(0.5, 0.5, () => 0.25);
        tickFrame();
        publish(0.5, 0.5, () => 0.75);
        tickFrame();

        // The consumer store holds the first buffer until it swaps in the second;
        // handing out a live SAB view would have mutated it under the store.
        expect(received[0]!.scopeBuffer[0]).toBe(0.25);
        expect(received[1]!.scopeBuffer[0]).toBe(0.75);
        expect(received[0]!.scopeBuffer).not.toBe(received[1]!.scopeBuffer);
    });

    it('holds emission while a publish is still mid-flight', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        const received: FermenterTelemetryData[] = [];
        const callback = vi.fn((data: FermenterTelemetryData) => received.push(data));
        result.onTelemetry(callback);

        publish(0.4, 0.4, () => 0.4);
        tickFrame();
        callback.mockClear();
        received.length = 0;

        // Peaks written behind an open counter; the waveform still holds the
        // previous generation's samples. Emitting here would hand the UI 0.99
        // paired with the old waveform — exactly the torn read.
        beginPublish(0.99, 0.99);
        tickFrame();

        expect(callback).not.toHaveBeenCalled();
    });

    it('emits once — not twice — when a poll races a publish that then settles', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        const received: FermenterTelemetryData[] = [];
        const callback = vi.fn((data: FermenterTelemetryData) => received.push(data));
        result.onTelemetry(callback);

        // Frame 1 lands mid-publish and samples the odd generation. Storing that
        // odd value would desync the gate and emit again on frame 2 for the same
        // publish, so the cadence gate must ignore it entirely.
        beginPublish(0.8, 0.8);
        tickFrame();
        expect(callback).not.toHaveBeenCalled();

        // Frame 2 sees the settled counter and the complete block.
        endPublish(() => 0.8);
        tickFrame();

        expect(callback).toHaveBeenCalledTimes(1);
        expect(received[0]!.peakL).toBe(Math.fround(0.8));
        expect(received[0]!.scopeBuffer[0]).toBe(Math.fround(0.8));

        // Frame 3: nothing new published, so the gate stays closed.
        tickFrame();

        expect(callback).toHaveBeenCalledTimes(1);
    });

    it('stops polling once destroyed', async () => {
        const ctx = { currentTime: 0, state: 'running' } as unknown as BaseAudioContext;
        const result = await createFermenterNode(ctx);
        const callback = vi.fn();
        result.onTelemetry(callback);

        result.destroy();
        publish(0.6, 0.6, () => 0.6);
        tickFrame();

        expect(callback).not.toHaveBeenCalled();
    });
});
