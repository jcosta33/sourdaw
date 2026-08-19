/**
 * AudioWorkletProcessor for the Crust true-peak limiter.
 *
 * Same shape as `glutenProcessor.ts`: the generated wasm-bindgen bindings via
 * `initSync`, cached linear-memory views, and a seqlock-published telemetry
 * slot. Effect processor — reads `inputs[0]`, writes `outputs[0]`.
 */

import { CRUST_RUNTIME_PARAMETER_COUNT, isCrustRuntimeParameterId } from '../models/CrustRuntimeControl';
import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, CrustInstance } from '../wasm/daw_dsp.js';

import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

/**
 * camelCase parameter names from the Crust panel to the snake_case names the
 * Rust engine dispatches on. The panel's patch keys are the source of truth;
 * `crustParamBridge` encodes their values, this maps their names.
 */
const PARAM_MAP: Record<string, string> = {
    gain: 'gain',
    ceiling: 'ceiling',
    style: 'style',
    algorithm: 'algorithm',
    lookahead: 'lookahead',
    attack: 'attack',
    release: 'release',
    attackAuto: 'attack_auto',
    releaseAuto: 'release_auto',
    channelLinkTransient: 'channel_link_transient',
    channelLinkRelease: 'channel_link_release',
    truePeak: 'true_peak',
    oversampling: 'oversampling',
    satEnabled: 'sat_enabled',
    satAlgorithm: 'sat_algorithm',
    satDrive: 'sat_drive',
    satMix: 'sat_mix',
    deltaListen: 'delta_listen',
    unityGain: 'unity_gain',
    multiBand: 'multi_band',
    crossover1: 'crossover1',
    crossover2: 'crossover2',
    scHpfEnabled: 'sc_hpf_enabled',
    scHpfFreq: 'sc_hpf_freq',
    stereoMode: 'stereo_mode',
    dither: 'dither',
    outputBitDepth: 'output_bit_depth',
    bypass: 'bypass',
    resetTruePeak: 'reset_true_peak',
};

type UnknownRecord = Record<string, unknown>;

const MAX_ID_LENGTH = 128;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isBoundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

class CrustProcessor extends AudioWorkletProcessor {
    _instance: CrustInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView: Float32Array | null = null;
    /** Int32 view over the same slot bytes — carries the seqlock counter. */
    _sabSeqView: Int32Array | null = null;
    _fallbackControlGeneration: number | null = null;
    _fallbackControlTarget: {
        trackId: string;
        deviceId: string;
        deviceType: string;
        parameterIds: readonly string[];
    } | null = null;
    _lastFallbackControlSequence = 0;
    // Cached WASM linear-memory views, reused across render quanta so process()
    // performs no per-block Float32Array allocation; each revalidates on a
    // memory.grow() buffer-identity change. See wasmView.ts.
    _inLeftView = new WasmView();
    _inRightView = new WasmView();
    _outLeftView = new WasmView();
    _outRightView = new WasmView();

    constructor(...args: unknown[]) {
        super();
        let wasmModule = resolveProcessorWasmModule(args[0]);
        this.port.onmessage = (event: MessageEvent<unknown>) => {
            const msg = event.data;
            try {
                if (!isRecord(msg)) {
                    return;
                }
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    if (!wasmModule) {
                        throw new TypeError('CrustProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (
                    msg.type === 'init-sab' &&
                    msg.sab instanceof SharedArrayBuffer &&
                    isNonNegativeSafeInteger(msg.byteOffset)
                ) {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                    this._sabSeqView = new Int32Array(msg.sab, msg.byteOffset, 32);
                } else if (this._initializeFallbackControl(msg)) {
                    return;
                } else {
                    this._handleFallbackControl(msg);
                }
            } catch (error) {
                // A throw at the wasm boundary may leave the instance trapped,
                // and a trap carries no message, so it cannot be told apart
                // from a recoverable error. Fault the processor rather than let
                // it keep accepting work.
                console.error('CrustProcessor error:', error);
                this._faulted = true;
                this.port.postMessage({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        };
    }

    _initializeFallbackControl(message: UnknownRecord): boolean {
        if (
            this._fallbackControlGeneration !== null ||
            !hasOnlyKeys(message, ['schemaVersion', 'command', 'target', 'correlation']) ||
            message.schemaVersion !== 1 ||
            message.command !== 'initialize-fallback-control' ||
            !isRecord(message.target) ||
            !hasOnlyKeys(message.target, ['trackId', 'deviceId', 'deviceType', 'parameterIds']) ||
            !isBoundedId(message.target.trackId) ||
            !isBoundedId(message.target.deviceId) ||
            message.target.deviceType !== 'crust' ||
            !Array.isArray(message.target.parameterIds) ||
            message.target.parameterIds.length !== CRUST_RUNTIME_PARAMETER_COUNT ||
            !message.target.parameterIds.every(isCrustRuntimeParameterId) ||
            new Set(message.target.parameterIds).size !== message.target.parameterIds.length ||
            !isRecord(message.correlation) ||
            !hasOnlyKeys(message.correlation, ['workletGeneration']) ||
            !isPositiveSafeInteger(message.correlation.workletGeneration)
        ) {
            return false;
        }
        this._fallbackControlTarget = Object.freeze({
            trackId: message.target.trackId,
            deviceId: message.target.deviceId,
            deviceType: message.target.deviceType,
            parameterIds: Object.freeze([...message.target.parameterIds]),
        });
        this._fallbackControlGeneration = message.correlation.workletGeneration;
        this._lastFallbackControlSequence = 0;
        return true;
    }

    _handleFallbackControl(message: UnknownRecord): void {
        if (
            !hasOnlyKeys(message, ['schemaVersion', 'command', 'target', 'value', 'correlation', 'scheduling']) ||
            message.schemaVersion !== 1 ||
            message.command !== 'set-fallback-param' ||
            !isRecord(message.target) ||
            !hasOnlyKeys(message.target, ['trackId', 'deviceId', 'deviceType', 'parameterId']) ||
            !isBoundedId(message.target.trackId) ||
            !isBoundedId(message.target.deviceId) ||
            message.target.deviceType !== 'crust' ||
            !isCrustRuntimeParameterId(message.target.parameterId) ||
            typeof message.value !== 'number' ||
            !Number.isFinite(message.value) ||
            !isRecord(message.correlation) ||
            !hasOnlyKeys(message.correlation, ['workletGeneration', 'controlSequence']) ||
            !isPositiveSafeInteger(message.correlation.workletGeneration) ||
            !isPositiveSafeInteger(message.correlation.controlSequence) ||
            !isRecord(message.scheduling) ||
            !hasOnlyKeys(message.scheduling, ['targetFrame', 'deadlineFrame']) ||
            message.scheduling.targetFrame !== null ||
            message.scheduling.deadlineFrame !== null
        ) {
            return;
        }
        const target = this._fallbackControlTarget;
        if (
            !target ||
            this._fallbackControlGeneration === null ||
            message.correlation.workletGeneration !== this._fallbackControlGeneration ||
            message.correlation.controlSequence <= this._lastFallbackControlSequence ||
            message.target.trackId !== target.trackId ||
            message.target.deviceId !== target.deviceId ||
            message.target.deviceType !== target.deviceType ||
            !target.parameterIds.includes(message.target.parameterId)
        ) {
            return;
        }
        this._lastFallbackControlSequence = message.correlation.controlSequence;
        this._applyFallbackControl(message.target.parameterId, message.value);
    }

    _applyFallbackControl(parameterId: string, value: number): void {
        if (!this._instance || this._faulted) {
            return;
        }
        // The look-ahead, true-peak switch and ceiling can move the delay line,
        // so latency is re-read after every accepted control.
        const oldLatency = this._instance.get_latency_samples();
        this._instance.set_param(PARAM_MAP[parameterId] ?? parameterId, value);
        const newLatency = this._instance.get_latency_samples();
        if (newLatency !== oldLatency) {
            this.port.postMessage({ type: 'latency-changed', latency: newLatency });
        }
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const wasmExports = initSync({ module: wasmModule });
        this._memory = wasmExports.memory;
        this._instance = new CrustInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready', latency: this._instance.get_latency_samples() });
    }

    _passthrough(input: Float32Array[], output: Float32Array[]): void {
        const in0 = input[0];
        const in1 = input[1] ?? in0;
        if (output[0] && in0) {
            output[0].set(in0);
        }
        if (output[1] && in1) {
            output[1].set(in1);
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        if (!this._ready || this._faulted) {
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length === 0 || !output || output.length < 2) {
            return true;
        }

        const in0 = input[0];
        const out0 = output[0];
        if (!in0 || !out0) {
            return true;
        }
        const frames = out0.length;

        try {
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            const inLeftPtr = inst.get_input_left_ptr();
            const inRightPtr = inst.get_input_right_ptr();
            this._inLeftView.get(mem, inLeftPtr, frames).set(in0);
            this._inRightView.get(mem, inRightPtr, frames).set(input[1] ?? in0);

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation
            // can grow the linear memory mid-call and detach the buffer inputs
            // were written into, so output views must map the post-grow buffer.
            const outMem = this._memory?.buffer ?? mem;

            out0.set(this._outLeftView.get(outMem, outLeftPtr, frames));
            const out1 = output[1];
            if (out1) {
                out1.set(this._outRightView.get(outMem, outRightPtr, frames));
            }

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                if (this._sabView) {
                    // Seqlock publish: counter odd, the field stores, counter
                    // even. A main-thread poll that lands inside this window
                    // retries instead of consuming a snapshot torn across two
                    // meter blocks.
                    beginTelemetryPublish(this._sabSeqView);
                    this._sabView[0] = inst.get_gr_db();
                    this._sabView[1] = inst.get_input_db();
                    this._sabView[2] = inst.get_output_db();
                    this._sabView[3] = inst.get_lufs_integrated();
                    this._sabView[4] = inst.get_lufs_short_term();
                    this._sabView[5] = inst.get_lufs_momentary();
                    this._sabView[6] = inst.get_lra();
                    this._sabView[7] = inst.get_true_peak_max();
                    this._sabView[8] = inst.get_true_peak_exceeded();
                    this._sabView[9] = inst.get_latency_samples();
                    endTelemetryPublish(this._sabSeqView);
                }
            }
        } catch (error) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
            this._passthrough(input, output);
        }

        return true;
    }
}

registerProcessor('crust-processor', CrustProcessor);
