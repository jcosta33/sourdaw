import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createProofNode, type ProofMeterData } from '../ProofNode';
import { PROOF_IDX, TELEMETRY_SEQ_IDX } from '../telemetryAllocator';

const mocks = vi.hoisted(() => ({
    ensureWorkletRegistered: vi.fn(() => Promise.resolve()),
    fetchWasmModule: vi.fn(() =>
        Promise.resolve(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])))
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

    it('posts finite params, drops non-finite values, and gates params while bypassed', async () => {
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

    it('initializes SAB telemetry on ready and explicitly polls torn-free meter snapshots into the callback', async () => {
        const slot = makeSlot();
        mocks.allocateSlot.mockReturnValue(slot);
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();
        const frames: ProofMeterData[] = [];
        node.onMeterData((data) => frames.push(data));

        node.pollTelemetry();
        expect(frames).toHaveLength(0);

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

        node.pollTelemetry();

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

        node.pollTelemetry();
        expect(frames).toHaveLength(2);
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
        node.pollTelemetry();

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
        node.pollTelemetry();
        expect(frames[0]!.inputLufs).toBe(-18);

        // Writer opens the seqlock, overwrites one field, and never closes it:
        // the slot now holds a genuinely torn pair (-20 with the old latency).
        slot.seqView[TELEMETRY_SEQ_IDX] = 3;
        slot.view[PROOF_IDX.inputLufs] = -20;

        node.pollTelemetry();

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
        node.pollTelemetry();
        expect(frames).toHaveLength(0);
    });

    it('does not start an independent recurring scheduler when telemetry is registered or polled', async () => {
        const slot = makeSlot();
        mocks.allocateSlot.mockReturnValue(slot);
        const setIntervalSpy = vi.fn();
        const requestAnimationFrameSpy = vi.fn();
        vi.stubGlobal('setInterval', setIntervalSpy);
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);
        const node = await createProofNode(makeContext());
        const { port } = lastWorklet();
        port.onmessage?.({ data: { type: 'ready' } } as MessageEvent);

        node.onMeterData(vi.fn());
        node.pollTelemetry();

        expect(setIntervalSpy).not.toHaveBeenCalled();
        expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
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

    it('destroy stops callback delivery, releases the telemetry slot, and closes the port', async () => {
        const slot = makeSlot();
        mocks.allocateSlot.mockReturnValue(slot);
        const node = await createProofNode(makeContext());
        const worklet = lastWorklet();
        worklet.port.onmessage?.({ data: { type: 'ready' } } as MessageEvent);
        slot.seqView[TELEMETRY_SEQ_IDX] = 2;

        const frames: ProofMeterData[] = [];
        node.onMeterData((data) => frames.push(data));
        node.pollTelemetry();
        expect(frames).toHaveLength(1);

        node.destroy();
        node.pollTelemetry();

        expect(mocks.releaseSlot).toHaveBeenCalledWith(slot.byteOffset);
        expect(worklet.disconnect).toHaveBeenCalled();
        expect(worklet.port.close).toHaveBeenCalledTimes(1);
        expect(frames).toHaveLength(1);
    });
});
