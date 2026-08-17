/**
 * AudioWorkletProcessor for the Bacteria creative multi-effects framework.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { BacteriaInstance, initSync } from '../wasm/daw_dsp.js';

import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

/** Bacteria passes param names through as-is (Rust engine uses camelCase matching). */
const PARAM_MAP: Record<string, string> = {
    mix: 'mix',
    inputGain: 'inputGain',
    outputGain: 'outputGain',
    bypass: 'bypass',
    bandCount: 'bandCount',
    crossoverFreq1: 'crossoverFreq1',
    crossoverFreq2: 'crossoverFreq2',
    crossoverFreq3: 'crossoverFreq3',
    crossoverFreq4: 'crossoverFreq4',
    crossoverFreq5: 'crossoverFreq5',
    crossoverSlope: 'crossoverSlope',
    crossoverMode: 'crossoverMode',
    globalRouting: 'globalRouting',
    morphX: 'morphX',
    morphY: 'morphY',
    macro1: 'macro1',
    macro2: 'macro2',
    macro3: 'macro3',
    macro4: 'macro4',
    macro5: 'macro5',
    macro6: 'macro6',
    macro7: 'macro7',
    macro8: 'macro8',
    lfo1Rate: 'lfo1Rate',
    lfo1Shape: 'lfo1Shape',
    lfo1Amount: 'lfo1Amount',
    lfo2Rate: 'lfo2Rate',
    lfo2Shape: 'lfo2Shape',
    lfo2Amount: 'lfo2Amount',
    envFollowerAttack: 'envFollowerAttack',
    envFollowerRelease: 'envFollowerRelease',
    lorenzSigma: 'lorenzSigma',
    lorenzRho: 'lorenzRho',
    lorenzBeta: 'lorenzBeta',
    lorenzSpeed: 'lorenzSpeed',
};

type UnknownRecord = Record<string, unknown>;
type ScheduledControl = { parameterId: string; value: number; targetFrame: number; deadlineFrame: number };
const MAX_PENDING_FALLBACK_CONTROLS = 32;
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

class BacteriaProcessor extends AudioWorkletProcessor {
    _instance: BacteriaInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView: Float32Array | null = null;
    /** Int32 view over the same slot bytes — carries the seqlock counter (RT-2). */
    _sabSeqView: Int32Array | null = null;
    _fallbackControlGeneration: number | null = null;
    _fallbackControlTarget: {
        trackId: string;
        deviceId: string;
        deviceType: string;
        parameterIds: readonly string[];
    } | null = null;
    _lastFallbackControlSequence = 0;
    _pendingFallbackControls: Array<ScheduledControl | null> = Array.from(
        { length: MAX_PENDING_FALLBACK_CONTROLS },
        () => null
    );
    // Cached WASM linear-memory views — reused across render quanta so process()
    // performs no per-block Float32Array allocation (audit RT-1); each revalidates
    // on a memory.grow() buffer-identity change (audit RT-7). See wasmView.ts.
    _inLeftView = new WasmView();
    _inRightView = new WasmView();
    _outLeftView = new WasmView();
    _outRightView = new WasmView();
    _bandLevelsView = new WasmView();

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
                        throw new TypeError('BacteriaProcessor requires a compiled WASM module');
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
                // Same policy as the process() catch below. A throw at the wasm
                // boundary may leave the instance trapped, and a trap carries no
                // message, so it cannot be told apart from a recoverable error.
                // Report it and stop taking work; a worklet console reaches nobody.
                console.error('BacteriaProcessor error:', error);
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
            !isBoundedId(message.target.deviceType) ||
            !Array.isArray(message.target.parameterIds) ||
            !message.target.parameterIds.every(isBoundedId) ||
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
        this._pendingFallbackControls.fill(null);
        return true;
    }

    _handleFallbackControl(message: UnknownRecord): boolean {
        if (message.command !== 'set-fallback-param') {
            return false;
        }
        if (
            !hasOnlyKeys(message, ['schemaVersion', 'command', 'target', 'value', 'correlation', 'scheduling']) ||
            message.schemaVersion !== 1 ||
            !isRecord(message.target) ||
            !hasOnlyKeys(message.target, ['trackId', 'deviceId', 'deviceType', 'parameterId']) ||
            !isBoundedId(message.target.trackId) ||
            !isBoundedId(message.target.deviceId) ||
            !isBoundedId(message.target.deviceType) ||
            !isBoundedId(message.target.parameterId) ||
            typeof message.value !== 'number' ||
            !Number.isFinite(message.value) ||
            !isRecord(message.correlation) ||
            !hasOnlyKeys(message.correlation, ['workletGeneration', 'controlSequence']) ||
            !isPositiveSafeInteger(message.correlation.workletGeneration) ||
            !isPositiveSafeInteger(message.correlation.controlSequence) ||
            !isRecord(message.scheduling) ||
            !hasOnlyKeys(message.scheduling, ['targetFrame', 'deadlineFrame'])
        ) {
            return true;
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
            return true;
        }
        const { targetFrame, deadlineFrame } = message.scheduling;
        const immediate = targetFrame === null && deadlineFrame === null;
        const scheduled = isNonNegativeSafeInteger(targetFrame) && isNonNegativeSafeInteger(deadlineFrame);
        if (!immediate && (!scheduled || targetFrame > deadlineFrame)) {
            return true;
        }
        this._lastFallbackControlSequence = message.correlation.controlSequence;
        if (scheduled && currentFrame > deadlineFrame) {
            return true;
        }
        if (scheduled && currentFrame < targetFrame) {
            const slot = this._pendingFallbackControls.findIndex((entry) => entry === null);
            if (slot !== -1) {
                this._pendingFallbackControls[slot] = {
                    parameterId: message.target.parameterId,
                    value: message.value,
                    targetFrame,
                    deadlineFrame,
                };
            }
            return true;
        }
        this._applyFallbackControl(message.target.parameterId, message.value, true);
        return true;
    }

    _applyFallbackControl(parameterId: string, value: number, reportLatency: boolean): void {
        if (!this._instance || this._faulted) {
            return;
        }
        const oldLatency = this._instance.get_latency_samples();
        this._instance.set_param(PARAM_MAP[parameterId] ?? parameterId, value);
        const nextLatency = this._instance.get_latency_samples();
        if (reportLatency && nextLatency !== oldLatency) {
            this.port.postMessage({ type: 'latency-changed', latency: nextLatency });
        }
    }

    _applyDueFallbackControls(): void {
        for (let index = 0; index < this._pendingFallbackControls.length; index++) {
            const pending = this._pendingFallbackControls[index];
            if (!pending) {
                continue;
            }
            if (currentFrame > pending.deadlineFrame) {
                this._pendingFallbackControls[index] = null;
            } else if (currentFrame >= pending.targetFrame) {
                this._pendingFallbackControls[index] = null;
                this._applyFallbackControl(pending.parameterId, pending.value, false);
            }
        }
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const wasmExports = initSync({ module: wasmModule });
        this._memory = wasmExports.memory;
        this._instance = new BacteriaInstance(sampleRate);
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
        if (!input || input.length < 2 || !output || output.length < 2) {
            return true;
        }

        const in0 = input[0];
        const in1 = input[1] ?? in0;
        const out0 = output[0];
        const out1 = output[1];
        if (!in0 || !out0) {
            return true;
        }
        const frames = out0.length;

        try {
            this._applyDueFallbackControls();
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            const inLeftPtr = inst.get_input_left_ptr();
            const inRightPtr = inst.get_input_right_ptr();
            this._inLeftView.get(mem, inLeftPtr, frames).set(in0);
            this._inRightView.get(mem, inRightPtr, frames).set(in1 ?? in0);

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the buffer inputs were
            // written into, so every view read past this point (outputs and the
            // band-levels telemetry) must map the post-grow buffer (audit RT-7).
            // Steady state leaves the identity unchanged and reuses the cache.
            const outMem = this._memory?.buffer ?? mem;

            out0.set(this._outLeftView.get(outMem, outLeftPtr, frames));
            if (out1) {
                out1.set(this._outRightView.get(outMem, outRightPtr, frames));
            }

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                if (this._sabView) {
                    // Seqlock publish (audit RT-2): counter odd, the header floats
                    // plus the 6-band blit, counter even. Without the bracket a
                    // poll could mix bands from two blocks — the exact tear the
                    // slot layout documents.
                    beginTelemetryPublish(this._sabSeqView);
                    this._sabView[0] = inst.get_input_db();
                    this._sabView[1] = inst.get_output_db();
                    this._sabView[2] = inst.get_latency_samples();
                    // Blit the Rust engine's 6-element peak-level array directly into
                    // the SAB slot starting at index 3 (bandLevelsBase). Peak levels
                    // are linear amplitude; consumers convert to dB.
                    const bandPtr = inst.get_band_levels_ptr();
                    const bandView = this._bandLevelsView.get(outMem, bandPtr, 6);
                    this._sabView.set(bandView, 3);
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

registerProcessor('bacteria-processor', BacteriaProcessor);
