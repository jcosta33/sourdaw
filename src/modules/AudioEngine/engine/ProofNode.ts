/**
 * ProofNode — AudioWorkletNode wrapper for the Proof mastering suite.
 *
 * Same pattern as GlutenNode: caches WASM binary, resumes AudioContext,
 * provides setParam/setBypass/reorder via MessagePort.
 *
 * Effect processor: 1 input, 1 output.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmBinary } from '#/infra/audioWorklet/workletInitShared';

import proofProcessorUrl from '../services/proofProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, createTelemetryReader, PROOF_IDX } from './telemetryAllocator';

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

export type ProofNodeResult = {
    workletNode: AudioWorkletNode;
    setParam: (name: string, value: number) => void;
    setBypass: (bypassed: boolean) => void;
    reorderModules: (order: [number, number, number, number, number]) => void;
    resetIntegrated: () => void;
    onMeterData: (cb: (data: ProofMeterData) => void) => void;
    pollTelemetry: () => void;
    onLatencyChanged: (cb: (latency: number) => void) => void;
    connect: (dest: AudioNode) => void;
    disconnect: () => void;
    destroy: () => void;
    ready: Promise<Record<string, unknown>>;
};

export function isProofDevice(deviceType: string): boolean {
    return deviceType === 'proof';
}

/**
 * Slot floats → Proof meter snapshot. Pure: the seqlock reader may re-run it on
 * retry. Reading it under `readTelemetrySnapshot` is what stops a poll from
 * mixing fields across two writes (e.g. tap0 from a new write with tap5 from
 * the old).
 */
function projectProofMeter(view: Float32Array): ProofMeterData {
    return {
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
}

export async function createProofNode(
    ctx: BaseAudioContext,
    wasmUrl?: string,
    signal?: AbortSignal
): Promise<ProofNodeResult> {
    // Proof's mastering telemetry (LUFS, true-peak, limiter GR) is SAB-backed.
    // Without SAB the UI would show flat curves and no GR indicator; the DSP
    // itself would run but the user experience is "knobs do nothing" (§8.20).
    // Fail fast with a typed error.
    requireSharedArrayBuffer('Proof');

    await raceAbortSignal(ensureWorkletRegistered(ctx, proofProcessorUrl), signal);

    if (ctx instanceof AudioContext && ctx.state === 'suspended') {
        await raceAbortSignal(ctx.resume(), signal);
    }
    const wasmBytes = await raceAbortSignal(fetchWasmBinary(wasmUrl ?? DEFAULT_WASM_URL), signal);

    signal?.throwIfAborted();

    const node = new AudioWorkletNode(ctx, 'proof-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
    });

    let bypassed = false;
    let meterCallback: ((data: ProofMeterData) => void) | null = null;
    let latencyCallback: ((latency: number) => void) | null = null;
    let sabSlot = telemetryAllocator.allocateSlot();
    let readMeter: (() => ProofMeterData) | null = null;

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
        // On ready: hand the SAB to the processor and prepare synchronous reads.
        if (sabSlot) {
            node.port.postMessage({ type: 'init-sab', sab: sabSlot.sab, byteOffset: sabSlot.byteOffset });
            // Built once on readiness, since it retains the last
            // consistent snapshot to hand back on retry exhaustion (audit RT-2).
            readMeter = createTelemetryReader({ slot: sabSlot, project: projectProofMeter });
        }
    };
    const readyPromise = handshake.promise;

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
        pollTelemetry() {
            if (!sabSlot || !readMeter || !meterCallback) {
                return;
            }
            meterCallback(readMeter());
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
            meterCallback = null;
            readMeter = null;
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
