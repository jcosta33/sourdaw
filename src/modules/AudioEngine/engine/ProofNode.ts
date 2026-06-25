/**
 * ProofNode — AudioWorkletNode wrapper for the Proof mastering suite.
 *
 * Same pattern as GlutenNode: caches WASM binary, resumes AudioContext,
 * provides setParam/setBypass/reorder via MessagePort.
 *
 * Effect processor: 1 input, 1 output.
 */

import { type updateProofMeters } from '#/modules/Proof/stores';

import proofProcessorUrl from '../services/proofProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, PROOF_IDX, TELEMETRY_SEQ_IDX } from './telemetryAllocator';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from './workletInitShared';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';

export type ProofMeterData = {
    inputLufs: number;
    outputLufs: number;
    outputStLufs: number;
    integratedLufs: number;
    truePeakDb: number;
    lra: number;
    correlation: number;
    limiterGrDb: number;
    dynGr: [number, number, number, number];
    tapPeaks: Array<{ peakL: number; peakR: number }>;
    latency: number;
};

/**
 * Compile-time guard that this engine-side `ProofMeterData` stays structurally
 * identical to the meter shape the Proof store consumes. Proof defines its own
 * local copy (it cannot import this private engine module), so a field added,
 * removed, or retyped on either side would otherwise drift silently until a
 * runtime value was wrong. Mutual assignability fails the build on any drift.
 *
 * `updateProofMeters` is the public Proof sink AudioEngine already feeds via
 * `wasmDeviceRegistry`; its second parameter is Proof's local `ProofMeterData`.
 */
type ProofMeterSink = Parameters<typeof updateProofMeters>[1];
type AssertMutuallyAssignable<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : never) : never;
const proofMeterDataCompat: AssertMutuallyAssignable<ProofMeterData, ProofMeterSink> = true;
void proofMeterDataCompat;

export type ProofNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    reorderModules: (order: [number, number, number, number, number]) => void;
    resetIntegrated: () => void;
    onMeterData: (cb: (data: ProofMeterData) => void) => void;
    onLatencyChanged: (cb: (latency: number) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isProofDevice(deviceType: string): boolean {
    return deviceType === 'proof';
}

/** Bound the seqlock retry so a misbehaving writer can never hang the poll. */
const TELEMETRY_SEQ_MAX_RETRIES = 8;

/**
 * Read a torn-free Proof meter snapshot from the telemetry slot.
 *
 * The worklet publishes the 25 fields under a seqlock counter (odd while
 * writing, even when settled). This samples the counter before and after the
 * field read and retries while it is odd or moved, so a poll landing mid-write
 * never mixes fields from two different blocks (e.g. tap0 from a new write with
 * tap5 from the old). On retry exhaustion it returns the last read — a bounded,
 * possibly-stale snapshot beats spinning the main thread.
 */
function readProofMeterSnapshot(view: Float32Array, seqView: Int32Array): ProofMeterData {
    let snapshot: ProofMeterData = EMPTY_PROOF_METER;
    for (let attempt = 0; attempt <= TELEMETRY_SEQ_MAX_RETRIES; attempt++) {
        const before = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
        snapshot = {
            inputLufs: view[PROOF_IDX.inputLufs]!,
            outputLufs: view[PROOF_IDX.outputLufs]!,
            outputStLufs: view[PROOF_IDX.outputStLufs]!,
            integratedLufs: view[PROOF_IDX.integratedLufs]!,
            truePeakDb: view[PROOF_IDX.truePeakDb]!,
            lra: view[PROOF_IDX.lra]!,
            correlation: view[PROOF_IDX.correlation]!,
            limiterGrDb: view[PROOF_IDX.limiterGrDb]!,
            dynGr: [view[PROOF_IDX.dynGr0]!, view[PROOF_IDX.dynGr1]!, view[PROOF_IDX.dynGr2]!, view[PROOF_IDX.dynGr3]!],
            tapPeaks: [
                { peakL: view[PROOF_IDX.tap0PeakL]!, peakR: view[PROOF_IDX.tap0PeakR]! },
                { peakL: view[PROOF_IDX.tap1PeakL]!, peakR: view[PROOF_IDX.tap1PeakR]! },
                { peakL: view[PROOF_IDX.tap2PeakL]!, peakR: view[PROOF_IDX.tap2PeakR]! },
                { peakL: view[PROOF_IDX.tap3PeakL]!, peakR: view[PROOF_IDX.tap3PeakR]! },
                { peakL: view[PROOF_IDX.tap4PeakL]!, peakR: view[PROOF_IDX.tap4PeakR]! },
                { peakL: view[PROOF_IDX.tap5PeakL]!, peakR: view[PROOF_IDX.tap5PeakR]! },
            ],
            latency: view[PROOF_IDX.latency]!,
        };
        const after = Atomics.load(seqView, TELEMETRY_SEQ_IDX);
        if (before === after && (before & 1) === 0) {
            break;
        }
    }
    return snapshot;
}

const EMPTY_PROOF_METER: ProofMeterData = {
    inputLufs: 0,
    outputLufs: 0,
    outputStLufs: 0,
    integratedLufs: 0,
    truePeakDb: 0,
    lra: 0,
    correlation: 0,
    limiterGrDb: 0,
    dynGr: [0, 0, 0, 0],
    tapPeaks: [
        { peakL: 0, peakR: 0 },
        { peakL: 0, peakR: 0 },
        { peakL: 0, peakR: 0 },
        { peakL: 0, peakR: 0 },
        { peakL: 0, peakR: 0 },
        { peakL: 0, peakR: 0 },
    ],
    latency: 0,
};

export async function createProofNode(ctx: BaseAudioContext, wasmUrl?: string): Promise<ProofNodeResult> {
    // Proof's mastering telemetry (LUFS, true-peak, limiter GR) is SAB-backed.
    // Without SAB the UI would show flat curves and no GR indicator; the DSP
    // itself would run but the user experience is "knobs do nothing" (§8.20).
    // Fail fast with a typed error.
    requireSharedArrayBuffer('Proof');

    await ensureWorkletRegistered(ctx, proofProcessorUrl);

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await ctx.resume();
    }

    const node = new AudioWorkletNode(ctx, 'proof-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
    });

    let bypassed = false;
    let meterCallback: ((data: ProofMeterData) => void) | null = null;
    let latencyCallback: ((latency: number) => void) | null = null;
    let sabSlot = telemetryAllocator.allocateSlot();
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const handshake = createReadyHandshake({ pluginName: 'ProofNode' });
    node.port.onmessage = (event: MessageEvent) => {
        const outcome = handshake.onMessage(event);
        if (outcome === 'other') {
            const data = event.data as Record<string, unknown>;
            if (data && data.type === 'latency-changed' && typeof data.latency === 'number') {
                latencyCallback?.(data.latency);
            }
            return;
        }
        if (outcome !== 'ready') {
            return;
        }
        // On ready: wire up SAB telemetry polling (§90.2 — see worklet note).
        if (sabSlot) {
            node.port.postMessage({ type: 'init-sab', sab: sabSlot.sab, byteOffset: sabSlot.byteOffset });
            const view = sabSlot.view;
            const seqView = sabSlot.seqView;
            pollInterval = setInterval(() => {
                if (meterCallback) {
                    meterCallback(readProofMeterSnapshot(view, seqView));
                }
            }, 16);
        }
    };
    const readyPromise = handshake.promise;

    const wasmBytes = await fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL);
    const copy = wasmBytes.slice(0);
    node.port.postMessage({ type: 'init', wasmBytes: copy }, [copy]);

    return {
        workletNode: node,
        setParam(name: string, value: number) {
            if (!bypassed && Number.isFinite(value)) {
                node.port.postMessage({ type: 'param', name, value });
            }
        },
        setBypass(state: boolean) {
            bypassed = state;
            node.port.postMessage({ type: 'param', name: 'bypass', value: state ? 1 : 0 });
        },
        reorderModules(order: [number, number, number, number, number]) {
            node.port.postMessage({ type: 'reorder', order });
        },
        resetIntegrated() {
            node.port.postMessage({ type: 'reset_integrated' });
        },
        onMeterData(cb: (data: ProofMeterData) => void) {
            meterCallback = cb;
        },
        onLatencyChanged(cb: (latency: number) => void) {
            latencyCallback = cb;
        },
        connect(dest: AudioNode) {
            node.connect(dest);
        },
        disconnect() {
            try {
                node.disconnect();
            } catch {
                /* already disconnected */
            }
        },
        destroy() {
            if (pollInterval !== null) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
            if (sabSlot) {
                telemetryAllocator.releaseSlot(sabSlot.byteOffset);
                sabSlot = null;
            }
            try {
                node.disconnect();
            } catch {
                // ignore
            }
            node.port.close();
        },
        ready: readyPromise,
    };
}
