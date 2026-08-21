import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { proofStore, updateProofMeters } from '#/modules/Proof/stores';

import { createProofNode, isProofDevice, type ProofMeterData } from '../ProofNode';

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
    allocateSlot: vi.fn(() => null),
    releaseSlot: vi.fn(),
}));

// Only the network/registration halves are stubbed. `createReadyHandshake` is
// deliberately the real implementation: the outcome under test — `late` — is
// produced by that state machine and by nothing else, so a stubbed handshake
// would prove the test's own stub rather than the node's forwarding boundary.
vi.mock('#/infra/audioWorklet/workletInitShared', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/infra/audioWorklet/workletInitShared')>()),
    ensureWorkletRegistered: mocks.ensureWorkletRegistered,
    fetchWasmModule: mocks.fetchWasmModule,
}));

vi.mock('../pluginHostingErrors', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../pluginHostingErrors')>()),
    requireSharedArrayBuffer: mocks.requireSharedArrayBuffer,
}));

vi.mock('../telemetryAllocator', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../telemetryAllocator')>()),
    telemetryAllocator: { allocateSlot: mocks.allocateSlot, releaseSlot: mocks.releaseSlot },
}));

vi.mock('../../services/proofProcessor.ts?worker&url', () => ({ default: 'proof-processor-url' }));

type FakePort = {
    postMessage: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
    close: ReturnType<typeof vi.fn>;
};

const workletNodes: Array<{ port: FakePort }> = [];

class FakeAudioWorkletNode {
    port: FakePort = { postMessage: vi.fn(), onmessage: null, close: vi.fn() };
    parameters = new Map<string, AudioParam>();
    connect = vi.fn();
    disconnect = vi.fn();

    constructor(_context: BaseAudioContext, _name: string, _options: AudioWorkletNodeOptions) {
        workletNodes.push(this);
    }
}

function makeContext(): BaseAudioContext {
    return { currentTime: 0, state: 'running', sampleRate: 48_000 } as BaseAudioContext;
}

function lastWorkletPort(): FakePort {
    const node = workletNodes[workletNodes.length - 1];
    if (!node) {
        throw new Error('expected an AudioWorkletNode to have been constructed');
    }
    return node.port;
}

function deliver(port: FakePort, data: Record<string, unknown>): void {
    const handler = port.onmessage;
    if (!handler) {
        throw new Error('expected ProofNode to have installed a port message handler');
    }
    handler({ data } as MessageEvent);
}

describe('isProofDevice', () => {
    it('should return true only for the proof device type string', () => {
        expect(isProofDevice('proof')).toBe(true);
        expect(isProofDevice('dutch-oven')).toBe(false);
    });
});

// ── Fix 9: engine-side ProofMeterData must stay structurally compatible with
// the shape the Proof store consumes. The compile-time guard in ProofNode.ts
// fails the build on drift; this runtime check proves the engine shape is
// accepted end-to-end by the public store sink. ──
describe('ProofMeterData store compatibility', () => {
    beforeEach(() => {
        proofStore.set({});
    });

    it('feeds an engine-shaped meter frame through the public store sink', () => {
        const frame: ProofMeterData = {
            inputLufs: -18,
            outputLufs: -14,
            outputStLufs: -13,
            integratedLufs: -14,
            truePeakDb: -1.2,
            lra: 6,
            correlation: 0.9,
            limiterGrDb: -2.5,
            dynGr: [-1, -2, -3, -4],
            tapPeaks: [
                { peakL: -10, peakR: -9 },
                { peakL: -11, peakR: -10 },
                { peakL: -12, peakR: -11 },
                { peakL: -13, peakR: -12 },
                { peakL: -14, peakR: -13 },
                { peakL: -15, peakR: -14 },
            ],
            latency: 256,
        };

        // The engine frame is assignable to the public store sink at the call
        // site — the structural compatibility under test.
        updateProofMeters('dev-1', frame);

        const state = proofStore.value?.['dev-1'];
        expect(state?.integratedLufs).toBe(-14);
        expect(state?.truePeakDb).toBe(-1.2);
        expect(state?.tapPeaks[5]).toEqual({ peakL: -15, peakR: -14 });
        expect(state?.latency).toBe(256);
    });
});

// ── The node-level forwarding boundary in ProofNode.ts.
//
// A worklet fault raised *after* the ready handshake has settled is the only
// signal the descriptor has that a live Proof device has died; it is what
// drives the terminal demotion in wasmDeviceRegistry. The handshake reports
// that event as `late`, and this branch is the sole place `onRuntimeFailure`
// is ever invoked. Neither the processor spec (which only proves the worklet
// emits an error message) nor the descriptor spec (which invokes the
// descriptor's callback directly) exercises it, so breaking this branch left
// both of them green. ──
describe('ProofNode post-ready runtime failure forwarding', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        workletNodes.length = 0;
        mocks.allocateSlot.mockReturnValue(null);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('forwards a worklet error that arrives after the ready handshake settled', async () => {
        const onRuntimeFailure = vi.fn();
        await createProofNode(makeContext(), undefined, undefined, undefined, onRuntimeFailure);
        const port = lastWorkletPort();

        // Ready settles the handshake; the error behind it is therefore `late`.
        deliver(port, { type: 'ready' });
        expect(onRuntimeFailure).not.toHaveBeenCalled();

        deliver(port, { type: 'error', message: 'proof processor trapped' });

        expect(onRuntimeFailure).toHaveBeenCalledTimes(1);
        expect(onRuntimeFailure).toHaveBeenCalledWith('proof processor trapped');
    });

    it('names the fault even when the late error carries no message string', async () => {
        const onRuntimeFailure = vi.fn();
        await createProofNode(makeContext(), undefined, undefined, undefined, onRuntimeFailure);
        const port = lastWorkletPort();

        deliver(port, { type: 'ready' });
        deliver(port, { type: 'error', message: 42 });

        expect(onRuntimeFailure).toHaveBeenCalledWith('Unknown error');
    });

    it('suppresses a late worklet error once the node has been destroyed', async () => {
        const onRuntimeFailure = vi.fn();
        const node = await createProofNode(makeContext(), undefined, undefined, undefined, onRuntimeFailure);
        const port = lastWorkletPort();
        deliver(port, { type: 'ready' });

        node.destroy();
        deliver(port, { type: 'error', message: 'fault raised during teardown' });

        // The descriptor demotes the device and swaps its control surface on
        // this callback. After `destroy` there is no device left to demote, so
        // a teardown-time fault must not reach it.
        expect(onRuntimeFailure).not.toHaveBeenCalled();
    });

    it('still routes a non-handshake latency message while a runtime-failure reporter is attached', async () => {
        const onRuntimeFailure = vi.fn();
        const node = await createProofNode(makeContext(), undefined, undefined, undefined, onRuntimeFailure);
        const port = lastWorkletPort();
        const latencies: number[] = [];
        node.onLatencyChanged((latency) => latencies.push(latency));

        deliver(port, { type: 'ready' });
        deliver(port, { type: 'latency-changed', latency: 384 });

        expect(latencies).toEqual([384]);
        expect(onRuntimeFailure).not.toHaveBeenCalled();
    });
});
