import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createProofNode, type ProofMeterData } from '../ProofNode';
import { PROOF_IDX, TELEMETRY_SEQ_IDX } from '../telemetryAllocator';

const mocks = vi.hoisted(() => ({
    ensureWorkletRegistered: vi.fn(() => Promise.resolve()),
    fetchWasmModule: vi.fn(() =>
        Promise.resolve({
            module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
            commit: vi.fn(),
            release: vi.fn(),
        })
    ),
    requireSharedArrayBuffer: vi.fn(),
    allocateSlot: vi.fn(),
    releaseSlot: vi.fn(),
}));

vi.mock('#/infra/audioWorklet/workletInitShared', () => ({
    ensureWorkletRegistered: mocks.ensureWorkletRegistered,
    fetchWasmModule: mocks.fetchWasmModule,
    createReadyHandshake: vi.fn(() => ({
        promise: Promise.resolve({}),
        onMessage: (event: MessageEvent) => {
            const data = event.data as { type?: string } | undefined;
            if (data?.type === 'ready') {
                return 'ready' as const;
            }
            return 'other' as const;
        },
        isSettled: () => true,
    })),
}));

vi.mock('../pluginHostingErrors', () => ({
    requireSharedArrayBuffer: mocks.requireSharedArrayBuffer,
}));

vi.mock('../telemetryAllocator', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../telemetryAllocator')>();
    return {
        ...actual,
        telemetryAllocator: { allocateSlot: mocks.allocateSlot, releaseSlot: mocks.releaseSlot },
    };
});

vi.mock('../../services/proofProcessor.ts?worker&url', () => ({ default: 'proof-processor-url' }));

type FakePort = {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    close: ReturnType<typeof vi.fn>;
};

const workletNodes: Array<{
    port: FakePort;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    options: AudioWorkletNodeOptions;
}> = [];

class FakeAudioWorkletNode {
    port: FakePort = { postMessage: vi.fn(), onmessage: null, close: vi.fn() };
    parameters = new Map<string, AudioParam>();
    connect = vi.fn();
    disconnect = vi.fn();
    options: AudioWorkletNodeOptions;

    constructor(_context: BaseAudioContext, _name: string, options: AudioWorkletNodeOptions) {
        this.options = options;
        workletNodes.push(this);
    }
}

const SLOT_FLOATS = TELEMETRY_SEQ_IDX + 1;

function makeSlot(): { sab: ArrayBuffer; byteOffset: number; view: Float32Array; seqView: Int32Array } {
    const sab = new ArrayBuffer(SLOT_FLOATS * 4);
    return {
        sab,
        byteOffset: 128,
        view: new Float32Array(sab),
        seqView: new Int32Array(SLOT_FLOATS),
    };
}

function makeContext(): BaseAudioContext {
    return { currentTime: 0, state: 'running', sampleRate: 48_000 } as BaseAudioContext;
}

function lastWorklet() {
    const node = workletNodes[workletNodes.length - 1];
    if (!node) {
        throw new Error('expected an AudioWorkletNode to have been constructed');
    }
    return node;
}

function paramPosts(port: FakePort): Array<Record<string, unknown>> {
    return port.postMessage.mock.calls
        .map((call) => call[0] as Record<string, unknown>)
        .filter((message) => message.type === 'param');
}

describe('createProofNode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workletNodes.length = 0;
        mocks.allocateSlot.mockReturnValue(null);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('fails fast when SharedArrayBuffer support is missing', async () => {
        mocks.requireSharedArrayBuffer.mockImplementationOnce(() => {
            throw new Error('Proof requires SharedArrayBuffer');
        });

        await expect(createProofNode(makeContext())).rejects.toThrow('Proof requires SharedArrayBuffer');
        expect(mocks.ensureWorkletRegistered).not.toHaveBeenCalled();
    });

    it('registers the worklet and supplies the compiled WASM module in processor options', async () => {
        await createProofNode(makeContext());

        expect(mocks.ensureWorkletRegistered).toHaveBeenCalledTimes(1);
        const { options, port } = lastWorklet();
        expect(options.processorOptions?.wasmModule).toBeInstanceOf(WebAssembly.Module);
        const initCall = port.postMessage.mock.calls.find((call) => (call[0] as { type?: string }).type === 'init');
        expect(initCall).toEqual([{ type: 'init' }]);
    });

    // The bypass half of this case previously asserted that a write made while
    // bypassed produced *no* post — it pinned the defect AC-8 removes, and it
    // is updated here rather than deleted. The non-finite half is unchanged.
    it('posts finite params, drops non-finite values, and keeps posting while bypassed', async () => {
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();
        port.postMessage.mockClear();

        node.setParam('lim_ceiling', -0.3);
        node.setParam('lim_ceiling', Number.NaN);
        node.setParam('lim_ceiling', Number.POSITIVE_INFINITY);
        expect(paramPosts(port)).toEqual([{ type: 'param', name: 'lim_ceiling', value: -0.3 }]);

        node.setBypass(true);
        node.setParam('lim_ceiling', -1);
        expect(paramPosts(port)).toEqual([
            { type: 'param', name: 'lim_ceiling', value: -0.3 },
            { type: 'param', name: 'bypass', value: 1 },
            { type: 'param', name: 'lim_ceiling', value: -1 },
        ]);

        node.setBypass(false);
        node.setParam('input_gain', 2);
        expect(paramPosts(port).at(-1)).toEqual({ type: 'param', name: 'input_gain', value: 2 });
    });

    it('posts module reorder and integrated-reset control messages', async () => {
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();
        port.postMessage.mockClear();

        node.reorderModules([4, 3, 2, 1, 0]);
        node.resetIntegrated();

        expect(port.postMessage).toHaveBeenNthCalledWith(1, { type: 'reorder', order: [4, 3, 2, 1, 0] });
        expect(port.postMessage).toHaveBeenNthCalledWith(2, { type: 'reset_integrated' });
    });

    it('admits the real Proof scalar namespace and rejects synthetic parameters in live mode', async () => {
        const node = await createProofNode(makeContext(), undefined, undefined, {
            trackId: 'track-1',
            deviceId: 'proof-1',
            deviceType: 'proof',
            parameterIds: [],
        });
        const { port } = lastWorklet();
        port.postMessage.mockClear();
        node.setParam('lim_ceiling', -1);
        node.setParam('not-a-proof-param', 1);
        const controls = port.postMessage.mock.calls
            .map((call) => call[0])
            .filter((message) => (message as { command?: string }).command === 'set-fallback-param');
        expect(controls).toEqual([
            expect.objectContaining({
                target: expect.objectContaining({
                    trackId: 'track-1',
                    deviceId: 'proof-1',
                    deviceType: 'proof',
                    parameterId: 'lim_ceiling',
                }),
                correlation: expect.objectContaining({ controlSequence: 1 }),
                scheduling: { targetFrame: null, deadlineFrame: null },
            }),
        ]);
    });

    it('initializes SAB telemetry on ready and polls torn-free meter snapshots into the callback', async () => {
        const slot = makeSlot();
        mocks.allocateSlot.mockReturnValue(slot);
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();

        // Worklet signals ready → the node hands the SAB slot to the processor.
        port.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
        const initSab = port.postMessage.mock.calls.find((call) => (call[0] as { type?: string }).type === 'init-sab');
        expect(initSab![0]).toEqual({ type: 'init-sab', sab: slot.sab, byteOffset: slot.byteOffset });

        // Publish a settled telemetry block (even seqlock counter).
        slot.view[PROOF_IDX.inputLufs] = -18;
        slot.view[PROOF_IDX.outputLufs] = -14;
        slot.view[PROOF_IDX.integratedLufs] = -13.5;
        slot.view[PROOF_IDX.truePeakDb] = -1.2;
        slot.view[PROOF_IDX.limiterGrDb] = -2.5;
        slot.view[PROOF_IDX.dynGr1] = -4;
        slot.view[PROOF_IDX.tap5PeakL] = 0.7;
        slot.view[PROOF_IDX.tap5PeakR] = 0.6;
        slot.view[PROOF_IDX.latency] = 256;
        slot.seqView[TELEMETRY_SEQ_IDX] = 2;

        const frames: ProofMeterData[] = [];
        node.onMeterData((data) => frames.push(data));
        vi.advanceTimersByTime(16);

        expect(frames).toHaveLength(1);
        expect(frames[0]).toMatchObject({
            inputLufs: -18,
            outputLufs: -14,
            integratedLufs: -13.5,
            truePeakDb: expect.closeTo(-1.2, 5),
            limiterGrDb: -2.5,
            latency: 256,
        });
        expect(frames[0]!.dynGr[1]).toBe(-4);
        expect(frames[0]!.tapPeaks[5]!.peakL).toBeCloseTo(0.7, 5);
        expect(frames[0]!.tapPeaks[5]!.peakR).toBeCloseTo(0.6, 5);

        // Polling keeps delivering frames every 16 ms.
        vi.advanceTimersByTime(32);
        expect(frames).toHaveLength(3);
    });

    it('delivers the neutral snapshot — never the open-seqlock fields — when the counter never settles', async () => {
        const slot = makeSlot();
        mocks.allocateSlot.mockReturnValue(slot);
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();
        port.onmessage?.({ data: { type: 'ready' } } as MessageEvent);

        // Odd counter = writer mid-block, forever. The poll must not hang, and
        // must not publish the fields sitting behind the open seqlock — those
        // may be torn across two blocks (audit RT-2).
        slot.view[PROOF_IDX.inputLufs] = -20;
        slot.view[PROOF_IDX.latency] = 512;
        slot.seqView[TELEMETRY_SEQ_IDX] = 3;

        const frames: ProofMeterData[] = [];
        node.onMeterData((data) => frames.push(data));
        vi.advanceTimersByTime(16);

        expect(frames).toHaveLength(1);
        expect(frames[0]!.inputLufs).toBe(0);
        expect(frames[0]!.latency).toBe(0);
    });

    it('holds the last settled snapshot when the writer dies mid-publish', async () => {
        const slot = makeSlot();
        mocks.allocateSlot.mockReturnValue(slot);
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();
        port.onmessage?.({ data: { type: 'ready' } } as MessageEvent);

        // One good published block.
        slot.view[PROOF_IDX.inputLufs] = -18;
        slot.view[PROOF_IDX.latency] = 256;
        slot.seqView[TELEMETRY_SEQ_IDX] = 2;

        const frames: ProofMeterData[] = [];
        node.onMeterData((data) => frames.push(data));
        vi.advanceTimersByTime(16);
        expect(frames[0]!.inputLufs).toBe(-18);

        // Writer opens the seqlock, overwrites one field, and never closes it:
        // the slot now holds a genuinely torn pair (-20 with the old latency).
        slot.seqView[TELEMETRY_SEQ_IDX] = 3;
        slot.view[PROOF_IDX.inputLufs] = -20;

        vi.advanceTimersByTime(16);

        // Stale-but-consistent, not the mixed generation.
        expect(frames).toHaveLength(2);
        expect(frames[1]).toMatchObject({ inputLufs: -18, latency: 256 });
    });

    it('skips SAB wiring entirely when no telemetry slot is available', async () => {
        mocks.allocateSlot.mockReturnValue(null);
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();

        port.onmessage?.({ data: { type: 'ready' } } as MessageEvent);

        expect(port.postMessage.mock.calls.some((call) => (call[0] as { type?: string }).type === 'init-sab')).toBe(
            false
        );

        const frames: ProofMeterData[] = [];
        node.onMeterData((data) => frames.push(data));
        vi.advanceTimersByTime(64);
        expect(frames).toHaveLength(0);
    });

    it('forwards latency-changed worklet messages to the latency callback', async () => {
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();
        const latencies: number[] = [];
        node.onLatencyChanged((latency) => latencies.push(latency));

        port.onmessage?.({ data: { type: 'latency-changed', latency: 128 } } as MessageEvent);
        port.onmessage?.({ data: { type: 'latency-changed', latency: 'bogus' } } as MessageEvent);

        expect(latencies).toEqual([128]);
    });

    it('connect and disconnect delegate to the worklet node, swallowing detached disconnects', async () => {
        const node = await createProofNode(makeContext());
        const worklet = lastWorklet();
        const destination = {} as AudioNode;

        node.connect(destination);
        expect(worklet.connect).toHaveBeenCalledWith(destination);

        worklet.disconnect.mockImplementation(() => {
            throw new Error('already disconnected');
        });
        expect(() => node.disconnect()).not.toThrow();
    });

    it('destroy stops polling, releases the telemetry slot, and closes the port', async () => {
        const slot = makeSlot();
        mocks.allocateSlot.mockReturnValue(slot);
        const node = await createProofNode(makeContext());
        const worklet = lastWorklet();
        worklet.port.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
        slot.seqView[TELEMETRY_SEQ_IDX] = 2;

        const frames: ProofMeterData[] = [];
        node.onMeterData((data) => frames.push(data));
        vi.advanceTimersByTime(16);
        expect(frames).toHaveLength(1);

        node.destroy();

        expect(mocks.releaseSlot).toHaveBeenCalledWith(slot.byteOffset);
        expect(worklet.disconnect).toHaveBeenCalled();
        expect(worklet.port.close).toHaveBeenCalledTimes(1);
        // The 16 ms poll is gone — no further frames arrive.
        vi.advanceTimersByTime(64);
        expect(frames).toHaveLength(1);
    });

    // ── SPEC-offline-live-collapse AC-8 ───────────────────────────────────
    //
    // `setParam` used to be guarded by `if (!bypassed && …)`, and `setBypass`
    // only flipped the flag — there was no replay on un-bypass. Meanwhile
    // `TrackNode.updateParam` forwards writes regardless of bypass state and
    // `updateBypass` routes the device out without rebuilding the node, so a
    // parameter changed while Proof was bypassed was lost for the whole
    // session: the UI and the document showed the new value and the worklet
    // kept the old one.
    //
    // **This changes the monitor, not the export.** The offline node is built
    // fresh from `parameterValues`, so the bounce was already correct and
    // playback was the wrong leg. The fix moves live onto offline.
    //
    // ProofNode was the only device in `engine/` that gated writes this way —
    // Gluten, Bacteria, Crust, Grinder and the rest all forward on
    // `Number.isFinite(value)` alone. Bypass is a signal-path decision, not a
    // parameter gate.
    describe('parameter writes while bypassed', () => {
        it('forwards a parameter write that arrives while the device is bypassed', async () => {
            const node = await createProofNode(makeContext());
            const worklet = lastWorklet();
            worklet.port.postMessage.mockClear();

            node.setBypass(true);
            node.setParam('limiter_ceiling', -0.3);

            expect(paramPosts(worklet.port)).toContainEqual({
                type: 'param',
                name: 'limiter_ceiling',
                value: -0.3,
            });
        });

        it('runs the value written under bypass once the device is un-bypassed', async () => {
            const node = await createProofNode(makeContext());
            const worklet = lastWorklet();

            node.setBypass(true);
            node.setParam('limiter_ceiling', -0.3);
            worklet.port.postMessage.mockClear();
            node.setBypass(false);

            // Un-bypass posts the bypass flag and nothing else: the ceiling is
            // already in the worklet because the write was forwarded when it
            // happened. A replay-on-un-bypass implementation would also pass
            // the assertion above, so this pins which of the two shipped —
            // and forwarding is the one that also fixes automation writing
            // into a bypassed Proof, which no un-bypass event ever follows.
            expect(paramPosts(worklet.port)).toEqual([{ type: 'param', name: 'bypass', value: 0 }]);
        });

        it('still refuses a non-finite value, bypassed or not', async () => {
            const node = await createProofNode(makeContext());
            const worklet = lastWorklet();
            worklet.port.postMessage.mockClear();

            node.setBypass(true);
            node.setParam('limiter_ceiling', Number.NaN);
            node.setBypass(false);
            node.setParam('limiter_ceiling', Number.POSITIVE_INFINITY);

            expect(paramPosts(worklet.port).filter((message) => message.name === 'limiter_ceiling')).toEqual([]);
        });
    });
});
