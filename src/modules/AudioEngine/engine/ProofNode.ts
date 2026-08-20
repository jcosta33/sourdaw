/**
 * ProofNode — AudioWorkletNode wrapper for the Proof mastering suite.
 *
 * Same pattern as GlutenNode: caches the compiled WASM module, resumes AudioContext,
 * provides setParam/setBypass/reorder via MessagePort.
 *
 * Effect processor: 1 input, 1 output.
 */

import { raceAbortSignal } from '#/infra/audioWorklet/raceAbortSignal';
import { createReadyHandshake, ensureWorkletRegistered, fetchWasmModule } from '#/infra/audioWorklet/workletInitShared';

import { createProofRuntimeParameterIds } from '../models/ProofRuntimeControl';
import { type RuntimeDeviceControlTarget } from '../models/RuntimeDeviceControl';
import { compileRuntimeDeviceControl } from '../services/compileRuntimeDeviceControl';
import proofProcessorUrl from '../services/proofProcessor.ts?worker&url';

import { requireSharedArrayBuffer } from './pluginHostingErrors';
import { telemetryAllocator, createTelemetryReader, PROOF_IDX } from './telemetryAllocator';

const DEFAULT_WASM_URL = '/wasm/daw-dsp/daw_dsp_bg.wasm';
const MAX_RUNTIME_ID_LENGTH = 128;
let nextWorkletControlGeneration = 1;

function allocateWorkletControlGeneration(): number {
    const generation = nextWorkletControlGeneration;
    nextWorkletControlGeneration = generation >= Number.MAX_SAFE_INTEGER ? 1 : generation + 1;
    return generation;
}

function isBoundedRuntimeId(value: string): boolean {
    return value.length > 0 && value.length <= MAX_RUNTIME_ID_LENGTH;
}

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
    signal?: AbortSignal,
    controlTarget?: RuntimeDeviceControlTarget,
    onRuntimeFailure?: (message: string) => void
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
    const wasmLease = await raceAbortSignal(
        fetchWasmModule({ ctx, bundleId: 'daw-dsp', url: wasmUrl ?? DEFAULT_WASM_URL, signal }),
        signal
    );

    signal?.throwIfAborted();

    let node: AudioWorkletNode;
    try {
        node = new AudioWorkletNode(ctx, 'proof-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            processorOptions: { wasmModule: wasmLease.module },
        });
        wasmLease.commit();
    } catch (error) {
        wasmLease.release();
        throw error;
    }

    let meterCallback: ((data: ProofMeterData) => void) | null = null;
    let latencyCallback: ((latency: number) => void) | null = null;
    let sabSlot = telemetryAllocator.allocateSlot();
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    const workletGeneration = allocateWorkletControlGeneration();
    const hasLiveControl = controlTarget !== undefined;
    const target =
        controlTarget &&
        isBoundedRuntimeId(controlTarget.trackId) &&
        isBoundedRuntimeId(controlTarget.deviceId) &&
        isBoundedRuntimeId(controlTarget.deviceType)
            ? Object.freeze({
                  trackId: controlTarget.trackId,
                  deviceId: controlTarget.deviceId,
                  deviceType: 'proof',
                  parameterIds: createProofRuntimeParameterIds(),
              })
            : null;
    let nextControlSequence = 1;
    let destroyed = false;
    const postControl = (name: string, value: number): void => {
        if (!Number.isFinite(value)) {
            return;
        }
        if (!hasLiveControl) {
            node.port.postMessage({ type: 'param', name, value });
            return;
        }
        if (!target) {
            return;
        }
        const compilation = compileRuntimeDeviceControl(
            {
                schemaVersion: 1,
                command: 'set-fallback-param',
                target: {
                    trackId: target.trackId,
                    deviceId: target.deviceId,
                    deviceType: target.deviceType,
                    parameterId: name,
                },
                value,
                correlation: { workletGeneration, controlSequence: nextControlSequence },
                scheduling: { targetFrame: null, deadlineFrame: null },
            },
            target.parameterIds
        );
        if (compilation.status === 'compiled') {
            nextControlSequence++;
            node.port.postMessage(compilation.control);
        }
    };

    const handshake = createReadyHandshake({ pluginName: 'ProofNode' });
    node.port.onmessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown> | null;
        const outcome = handshake.onMessage(event);
        if (outcome === 'other') {
            if (data && data.type === 'latency-changed' && typeof data.latency === 'number') {
                latencyCallback?.(data.latency);
            }
            return;
        }
        if (outcome === 'late' && data?.type === 'error' && !destroyed) {
            onRuntimeFailure?.(typeof data.message === 'string' ? data.message : 'Unknown error');
            return;
        }
        if (outcome !== 'ready') {
            return;
        }
        // On ready: wire up SAB telemetry polling (§90.2 — see worklet note).
        if (sabSlot) {
            node.port.postMessage({ type: 'init-sab', sab: sabSlot.sab, byteOffset: sabSlot.byteOffset });
            // Built once, outside the interval, since it retains the last
            // consistent snapshot to hand back on retry exhaustion (audit RT-2).
            const readMeter = createTelemetryReader({ slot: sabSlot, project: projectProofMeter });
            pollInterval = setInterval(() => {
                if (meterCallback) {
                    meterCallback(readMeter());
                }
            }, 16);
        }
    };
    const readyPromise = handshake.promise;

    if (target) {
        node.port.postMessage(
            Object.freeze({
                schemaVersion: 1,
                command: 'initialize-fallback-control',
                target,
                correlation: Object.freeze({ workletGeneration }),
            })
        );
    }
    node.port.postMessage({ type: 'init' });

    return {
        workletNode: node,
        /**
         * Forwarded regardless of bypass state — bypass is a signal-path
         * decision, not a parameter gate.
         *
         * This used to be guarded by `!bypassed`, and `setBypass` performed no
         * replay, so a value changed while Proof was bypassed never reached the
         * worklet at all: the UI and the document showed the new number and the
         * DSP kept the old one for the rest of the session. Automation writing
         * into a bypassed Proof was dropped the same way, and that case has no
         * un-bypass event to replay on, which is why forwarding is the fix
         * rather than a replay.
         *
         * `TrackNode.updateParam` forwards writes without consulting bypass and
         * `updateBypass` routes the device out without rebuilding the node, so
         * this is also what every other device in `engine/` already does.
         */
        setParam(name: string, value: number) {
            postControl(name, value);
        },
        setBypass(state: boolean) {
            postControl('bypass', state ? 1 : 0);
        },
        reorderModules(order: [number, number, number, number, number]) {
            if (!hasLiveControl) {
                node.port.postMessage({ type: 'reorder', order });
                return;
            }
            if (!target) {
                return;
            }
            if (
                new Set(order).size !== 5 ||
                order.some((value) => !Number.isInteger(value) || value < 0 || value > 4)
            ) {
                return;
            }
            node.port.postMessage(
                Object.freeze({
                    schemaVersion: 1,
                    command: 'reorder-modules',
                    target: Object.freeze({
                        trackId: target.trackId,
                        deviceId: target.deviceId,
                        deviceType: target.deviceType,
                    }),
                    order: Object.freeze([...order]),
                    correlation: Object.freeze({ workletGeneration, controlSequence: nextControlSequence++ }),
                    scheduling: Object.freeze({ targetFrame: null, deadlineFrame: null }),
                })
            );
        },
        resetIntegrated() {
            if (!hasLiveControl) {
                node.port.postMessage({ type: 'reset_integrated' });
                return;
            }
            if (!target) {
                return;
            }
            node.port.postMessage(
                Object.freeze({
                    schemaVersion: 1,
                    command: 'reset-integrated',
                    target: Object.freeze({
                        trackId: target.trackId,
                        deviceId: target.deviceId,
                        deviceType: target.deviceType,
                    }),
                    correlation: Object.freeze({ workletGeneration, controlSequence: nextControlSequence++ }),
                    scheduling: Object.freeze({ targetFrame: null, deadlineFrame: null }),
                })
            );
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
            destroyed = true;
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
