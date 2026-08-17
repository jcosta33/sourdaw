/**
 * AudioWorkletProcessor for the Proof mastering suite.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads inputs[0], writes outputs[0].
 * Handles the full mastering chain via WASM (EQ → Dynamics → Imager → Exciter → Limiter).
 * Writes metering data (LUFS, GR, correlation, tap levels) into a shared telemetry slot.
 */

import { isProofRuntimeParameterId, PROOF_RUNTIME_PARAMETER_COUNT } from '../models/ProofRuntimeControl';
import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, ProofInstance } from '../wasm/daw_dsp.js';

import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';
import { WasmView } from './wasmView';

type ProofMsg =
    | { type: 'init' }
    | { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number }
    | { type: 'param'; name: string; value: number }
    | { type: 'reorder'; order: [number, number, number, number, number] }
    | { type: 'reset_integrated' };
type UnknownRecord = Record<string, unknown>;
const MAX_RUNTIME_ID_LENGTH = 128;
function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function only(value: UnknownRecord, keys: readonly string[]): boolean {
    const actual = Object.keys(value);
    return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function positive(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function boundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_RUNTIME_ID_LENGTH;
}

class ProofProcessor extends AudioWorkletProcessor {
    _instance: ProofInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView: Float32Array | null = null;
    _sabSeqView: Int32Array | null = null;
    _fallbackControlGeneration: number | null = null;
    _fallbackControlTarget: { trackId: string; deviceId: string; parameterIds: readonly string[] } | null = null;
    _lastFallbackControlSequence = 0;
    // Cached WASM linear-memory views — reused across render quanta so process()
    // performs no per-block Float32Array allocation (audit RT-1); each revalidates
    // on a memory.grow() buffer-identity change (audit RT-7). See wasmView.ts.
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
                        throw new TypeError('ProofProcessor requires a compiled WASM module');
                    }
                    this._initWasm(wasmModule);
                    wasmModule = null;
                } else if (
                    msg.type === 'init-sab' &&
                    msg.sab instanceof SharedArrayBuffer &&
                    typeof msg.byteOffset === 'number'
                ) {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                    // Int32 view over the same slot bytes for the seqlock counter.
                    this._sabSeqView = new Int32Array(msg.sab, msg.byteOffset, 32);
                } else if (this._initializeFallbackControl(msg)) {
                    return;
                } else if (this._instance !== null && !this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (error) {
                // Same policy as the process() catch below. A throw at the wasm
                // boundary may leave the instance trapped, and a trap carries no
                // message, so it cannot be told apart from a recoverable error.
                // Reporting only while `!_ready` left a post-startup fault in a
                // worklet console, with the device still accepting work after.
                console.error('ProofProcessor error:', error);
                this._faulted = true;
                this.port.postMessage({
                    type: 'error',
                    message: error instanceof Error ? error.message : String(error),
                });
            }
        };
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const wasmExports = initSync({ module: wasmModule });
        this._memory = wasmExports.memory;
        this._instance = new ProofInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready', latency: this._instance.get_latency_samples() });
    }

    _initializeFallbackControl(msg: UnknownRecord): boolean {
        if (
            this._fallbackControlGeneration !== null ||
            !only(msg, ['schemaVersion', 'command', 'target', 'correlation']) ||
            msg.schemaVersion !== 1 ||
            msg.command !== 'initialize-fallback-control' ||
            !isRecord(msg.target) ||
            !only(msg.target, ['trackId', 'deviceId', 'deviceType', 'parameterIds']) ||
            !boundedId(msg.target.trackId) ||
            !boundedId(msg.target.deviceId) ||
            msg.target.deviceType !== 'proof' ||
            !Array.isArray(msg.target.parameterIds) ||
            msg.target.parameterIds.length !== PROOF_RUNTIME_PARAMETER_COUNT ||
            !msg.target.parameterIds.every(isProofRuntimeParameterId) ||
            new Set(msg.target.parameterIds).size !== msg.target.parameterIds.length ||
            !isRecord(msg.correlation) ||
            !only(msg.correlation, ['workletGeneration']) ||
            !positive(msg.correlation.workletGeneration)
        ) {
            return false;
        }
        this._fallbackControlTarget = Object.freeze({
            trackId: msg.target.trackId,
            deviceId: msg.target.deviceId,
            parameterIds: Object.freeze([...msg.target.parameterIds]),
        });
        this._fallbackControlGeneration = msg.correlation.workletGeneration;
        return true;
    }

    _handleMessage(msg: UnknownRecord): void {
        const inst = this._instance;
        if (!inst) {
            return;
        }

        if (this._fallbackControlGeneration !== null) {
            const target = this._fallbackControlTarget;
            const correlation = isRecord(msg.correlation) ? msg.correlation : null;
            const order = Array.isArray(msg.order) ? msg.order : null;
            const validIdentity = (command: unknown): boolean =>
                !!target &&
                isRecord(msg.target) &&
                only(msg.target, ['trackId', 'deviceId', 'deviceType']) &&
                boundedId(msg.target.trackId) &&
                boundedId(msg.target.deviceId) &&
                isRecord(msg.correlation) &&
                only(msg.correlation, ['workletGeneration', 'controlSequence']) &&
                isRecord(msg.scheduling) &&
                only(msg.scheduling, ['targetFrame', 'deadlineFrame']) &&
                msg.schemaVersion === 1 &&
                command === msg.command &&
                msg.target.trackId === target.trackId &&
                msg.target.deviceId === target.deviceId &&
                msg.target.deviceType === 'proof' &&
                correlation?.workletGeneration === this._fallbackControlGeneration &&
                positive(correlation.controlSequence) &&
                correlation.controlSequence > this._lastFallbackControlSequence &&
                msg.scheduling.targetFrame === null &&
                msg.scheduling.deadlineFrame === null;
            if (
                msg.command === 'reset-integrated' &&
                only(msg, ['schemaVersion', 'command', 'target', 'correlation', 'scheduling']) &&
                validIdentity('reset-integrated')
            ) {
                this._lastFallbackControlSequence = correlation!.controlSequence as number;
                inst.reset_integrated();
                return;
            }
            if (
                msg.command === 'reorder-modules' &&
                only(msg, ['schemaVersion', 'command', 'target', 'order', 'correlation', 'scheduling']) &&
                order &&
                order.length === 5 &&
                order.every(
                    (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 5
                ) &&
                order.every((value, index) => order.indexOf(value) === index) &&
                validIdentity('reorder-modules')
            ) {
                this._lastFallbackControlSequence = correlation!.controlSequence as number;
                inst.reorder(
                    order[0] as number,
                    order[1] as number,
                    order[2] as number,
                    order[3] as number,
                    order[4] as number
                );
                return;
            }
            if (
                !only(msg, ['schemaVersion', 'command', 'target', 'value', 'correlation', 'scheduling']) ||
                msg.schemaVersion !== 1 ||
                msg.command !== 'set-fallback-param' ||
                !isRecord(msg.target) ||
                !only(msg.target, ['trackId', 'deviceId', 'deviceType', 'parameterId']) ||
                !isProofRuntimeParameterId(msg.target.parameterId) ||
                typeof msg.value !== 'number' ||
                !Number.isFinite(msg.value) ||
                !isRecord(msg.correlation) ||
                !only(msg.correlation, ['workletGeneration', 'controlSequence']) ||
                !positive(msg.correlation.workletGeneration) ||
                !positive(msg.correlation.controlSequence) ||
                !isRecord(msg.scheduling) ||
                !only(msg.scheduling, ['targetFrame', 'deadlineFrame']) ||
                msg.scheduling.targetFrame !== null ||
                msg.scheduling.deadlineFrame !== null
            ) {
                return;
            }
            if (
                !target ||
                msg.correlation.workletGeneration !== this._fallbackControlGeneration ||
                msg.correlation.controlSequence <= this._lastFallbackControlSequence ||
                msg.target.trackId !== target.trackId ||
                msg.target.deviceId !== target.deviceId ||
                msg.target.deviceType !== 'proof' ||
                !target.parameterIds.includes(msg.target.parameterId)
            ) {
                return;
            }
            this._lastFallbackControlSequence = msg.correlation.controlSequence;
            const oldLatency = inst.get_latency_samples();
            inst.set_param(msg.target.parameterId, msg.value);
            const newLatency = inst.get_latency_samples();
            if (newLatency !== oldLatency) {
                this.port.postMessage({ type: 'latency-changed', latency: newLatency });
            }
            return;
        }

        const oldLatency = inst.get_latency_samples();

        switch ((msg as ProofMsg).type) {
            case 'init-sab':
            case 'init':
                break;
            case 'param':
                inst.set_param(
                    (msg as Extract<ProofMsg, { type: 'param' }>).name,
                    (msg as Extract<ProofMsg, { type: 'param' }>).value
                );
                break;
            case 'reorder':
                {
                    const order = (msg as Extract<ProofMsg, { type: 'reorder' }>).order;
                    inst.reorder(order[0], order[1], order[2], order[3], order[4]);
                }
                break;
            case 'reset_integrated':
                inst.reset_integrated();
                break;
        }

        const newLatency = inst.get_latency_samples();
        if (newLatency !== oldLatency) {
            this.port.postMessage({ type: 'latency-changed', latency: newLatency });
        }
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

            // Re-read the live buffer AFTER process(): a Rust-side allocation can
            // grow the linear memory mid-call and detach the buffer the inputs were
            // written into, so output views must map the post-grow buffer (audit
            // RT-7). Reusing the pre-call `mem` here would let the cache hand back a
            // view over a detached (zero-length) buffer and silently emit stale
            // samples. Steady state (no grow) leaves the identity unchanged and
            // reuses the cached view with no allocation.
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
                    // Seqlock publish (audit RT-2): bump the counter odd (write in
                    // progress), write the 25 fields, then bump it even (write
                    // complete). A reader that samples an odd or changed counter
                    // around its read retries, so it never consumes a snapshot torn
                    // across these non-atomic float writes.
                    beginTelemetryPublish(this._sabSeqView);
                    this._sabView[0] = inst.get_input_lufs();
                    this._sabView[1] = inst.get_output_lufs();
                    this._sabView[2] = inst.get_output_st_lufs();
                    this._sabView[3] = inst.get_integrated_lufs();
                    this._sabView[4] = inst.get_true_peak_db();
                    this._sabView[5] = inst.get_lra();
                    this._sabView[6] = inst.get_correlation();
                    this._sabView[7] = inst.get_limiter_gr_db();
                    this._sabView[8] = inst.get_dynamics_gr(0);
                    this._sabView[9] = inst.get_dynamics_gr(1);
                    this._sabView[10] = inst.get_dynamics_gr(2);
                    this._sabView[11] = inst.get_dynamics_gr(3);
                    this._sabView[12] = inst.get_tap_peak_l(0);
                    this._sabView[13] = inst.get_tap_peak_r(0);
                    this._sabView[14] = inst.get_tap_peak_l(1);
                    this._sabView[15] = inst.get_tap_peak_r(1);
                    this._sabView[16] = inst.get_tap_peak_l(2);
                    this._sabView[17] = inst.get_tap_peak_r(2);
                    this._sabView[18] = inst.get_tap_peak_l(3);
                    this._sabView[19] = inst.get_tap_peak_r(3);
                    this._sabView[20] = inst.get_tap_peak_l(4);
                    this._sabView[21] = inst.get_tap_peak_r(4);
                    this._sabView[22] = inst.get_tap_peak_l(5);
                    this._sabView[23] = inst.get_tap_peak_r(5);
                    this._sabView[24] = inst.get_latency_samples();
                    // Close the seqlock: counter back to even (write complete).
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

registerProcessor('proof-processor', ProofProcessor);
