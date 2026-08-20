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

/**
 * Telemetry slot geometry, mirroring `engine/telemetryAllocator.ts`. The slot
 * is read as both `Float32Array` and `Int32Array`, so its start must carry
 * 4-byte alignment and the whole slot must sit inside the shared buffer.
 */
const TELEMETRY_SLOT_FLOATS = 32;
const TELEMETRY_SLOT_ALIGNMENT = Float32Array.BYTES_PER_ELEMENT;
const TELEMETRY_SLOT_BYTES = TELEMETRY_SLOT_FLOATS * TELEMETRY_SLOT_ALIGNMENT;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * True when `value` carries exactly `keys` as own enumerable properties.
 *
 * Deliberately array-free. `Object.keys(value).every(...)` materialized a key
 * array for every inbound record, on the AudioWorklet thread, and enumerated
 * the whole record before judging it — so a malformed message carrying
 * thousands of properties bought proportional enumeration and allocation
 * there, and every accepted control allocated several key arrays per change.
 * `for…in` allocates nothing, and the first unexpected key exits, so any
 * record costs at most `keys.length + 1` iterations however large it is. An
 * inherited enumerable key is rejected rather than skipped, which keeps that
 * bound true against a hostile prototype as well.
 */
function only(value: UnknownRecord, keys: readonly string[]): boolean {
    let matched = 0;
    for (const key in value) {
        if (!Object.hasOwn(value, key) || !keys.includes(key)) {
            return false;
        }
        matched += 1;
    }
    return matched === keys.length;
}

function positive(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function boundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_RUNTIME_ID_LENGTH;
}

/** Reorderable chain modules: EQ, Dynamics, Imager, Exciter, Limiter. */
const MODULE_COUNT = 5;
type ModuleOrder = [number, number, number, number, number];

/**
 * True when `value` is a genuine permutation of the chain module indices —
 * exactly `MODULE_COUNT` integer entries in `[0, MODULE_COUNT)` with no
 * duplicate and therefore no gap.
 *
 * Both halves matter and for different reasons. Reading `value[0]` off a
 * non-indexable `order` throws a `TypeError` before the call ever reaches
 * wasm, and that throw lands in the onmessage catch, which marks the processor
 * faulted for the rest of its life: one malformed message left the musician a
 * dead Proof device for the session. A duplicate index needs no throw to do
 * damage — it describes a chain with a module used twice and another dropped,
 * which is a corrupt processing order rather than a crash.
 *
 * The membership test is a bitmask rather than a `Set` or an `indexOf` scan:
 * it allocates nothing and exits on the first bad entry, which is what the
 * render thread needs.
 */
function isModuleOrder(value: unknown): value is ModuleOrder {
    if (!Array.isArray(value) || value.length !== MODULE_COUNT) {
        return false;
    }
    let seen = 0;
    for (const entry of value) {
        if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry >= MODULE_COUNT) {
            return false;
        }
        const bit = 1 << entry;
        if ((seen & bit) !== 0) {
            return false;
        }
        seen |= bit;
    }
    return true;
}

type ParameterRange = readonly [min: number, max: number];

const TOGGLE: ParameterRange = [0, 1];
const AUDIO_FREQ: ParameterRange = [20, 20_000];
const GAIN_DB: ParameterRange = [-24, 24];

/**
 * Declared inclusive range of every parameter in the live wire namespace,
 * mirroring the clamps the Rust engine applies in `crates/daw-dsp/src/proof/`.
 * Both sides hold the range: the wire boundary rejects an out-of-range value
 * so it never reaches wasm, and the engine clamps so it never trusts a caller
 * that skipped this check.
 */
function buildParameterRanges(): ReadonlyMap<string, ParameterRange> {
    const ranges = new Map<string, ParameterRange>([
        ['bypass', TOGGLE],
        ['ab_bypass', TOGGLE],
        ['input_gain', GAIN_DB],
        ['output_gain', GAIN_DB],
        ['eq_bypass', TOGGLE],
        ['eq_linear_phase', TOGGLE],
        ['dyn_bypass', TOGGLE],
        ['img_bypass', TOGGLE],
        ['img_auto_mono_bass', TOGGLE],
        ['img_mono_bass_freq', [40, 200]],
        ['exc_bypass', TOGGLE],
        ['lim_bypass', TOGGLE],
        ['lim_ceiling', [-12, 0]],
        ['lim_release', [10, 500]],
        ['lim_lookahead', [0.5, 10]],
        ['dither_mode', [0, 2]],
        ['dither_bits', [16, 24]],
    ]);
    for (let band = 0; band < 8; band += 1) {
        ranges.set(`eq_band${band}_freq`, AUDIO_FREQ);
        ranges.set(`eq_band${band}_gain`, [-18, 18]);
        ranges.set(`eq_band${band}_q`, [0.1, 10]);
        ranges.set(`eq_band${band}_type`, [0, 4]);
        ranges.set(`eq_band${band}_channel`, [0, 2]);
        ranges.set(`eq_band${band}_enabled`, TOGGLE);
    }
    for (let crossover = 0; crossover < 3; crossover += 1) {
        ranges.set(`dyn_xover${crossover}`, AUDIO_FREQ);
    }
    for (let band = 0; band < 4; band += 1) {
        ranges.set(`dyn_band${band}_threshold`, [-60, 0]);
        ranges.set(`dyn_band${band}_ratio`, [1, 20]);
        ranges.set(`dyn_band${band}_attack`, [1, 200]);
        ranges.set(`dyn_band${band}_release`, [10, 2_000]);
        ranges.set(`dyn_band${band}_knee`, [0, 12]);
        ranges.set(`dyn_band${band}_makeup`, [-12, 24]);
        ranges.set(`dyn_band${band}_auto_makeup`, TOGGLE);
        ranges.set(`dyn_band${band}_bypass`, TOGGLE);
        ranges.set(`img_width${band}`, [0, 2]);
        ranges.set(`exc_band${band}_type`, [0, 3]);
        ranges.set(`exc_band${band}_drive`, [0, 1]);
        ranges.set(`exc_band${band}_blend`, [0, 1]);
        ranges.set(`exc_band${band}_enabled`, TOGGLE);
    }
    return ranges;
}
const PARAMETER_RANGES = buildParameterRanges();

/**
 * True when `value` still exists as a finite number *after* the f64 → f32
 * narrowing the wasm boundary performs.
 *
 * `Number.isFinite(value)` on its own validated the JavaScript f64 and not the
 * f32 actually handed to wasm: `Number.MAX_VALUE` passed it and arrived as f32
 * `Infinity`.
 */
function representableF32(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && Number.isFinite(Math.fround(value));
}

/**
 * True when `value` is a representable f32 that also honours `parameterId`'s
 * declared range. The range is checked against the *narrowed* value, because
 * that is the number the engine sees.
 *
 * A parameter with no declared range is rejected, so a namespace entry added
 * without a range fails closed rather than reaching wasm unchecked;
 * `proofProcessor.spec.ts` pins that every live parameter declares one.
 */
function inParameterRange(parameterId: string, value: unknown): value is number {
    if (!representableF32(value)) {
        return false;
    }
    const range = PARAMETER_RANGES.get(parameterId);
    if (range === undefined) {
        return false;
    }
    const narrowed = Math.fround(value);
    return narrowed >= range[0] && narrowed <= range[1];
}

/**
 * The same check for the legacy `{ type: 'param' }` message, which addresses
 * engine parameters by raw name rather than by the live namespace. A name the
 * namespace does not declare is inert in the engine (`_ => {}` in every Rust
 * `set_param`), so it only has to survive the f32 narrowing; a declared one
 * carries its range here too.
 */
function acceptableLegacyParam(name: string, value: unknown): value is number {
    if (!representableF32(value)) {
        return false;
    }
    const range = PARAMETER_RANGES.get(name);
    if (range === undefined) {
        return true;
    }
    const narrowed = Math.fround(value);
    return narrowed >= range[0] && narrowed <= range[1];
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
                } else if (msg.type === 'init-sab') {
                    this._initTelemetrySlot(msg.sab, msg.byteOffset);
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

    /**
     * Map the telemetry slot that starts at `byteOffset` inside `sab`.
     *
     * A malformed slot description is ignored, never thrown on. `typeof
     * byteOffset === 'number'` was the whole guard, so a negative, fractional,
     * non-finite, misaligned or out-of-bounds offset made `new Float32Array`
     * throw into the onmessage catch — which marks the processor faulted for
     * the rest of its life. A bad initialization message must cost telemetry,
     * not the audio the device was passing perfectly well. Both views must fit
     * whole, so the offset is bounded by the buffer minus one complete slot.
     */
    _initTelemetrySlot(sab: unknown, byteOffset: unknown): void {
        if (
            !(sab instanceof SharedArrayBuffer) ||
            typeof byteOffset !== 'number' ||
            !Number.isSafeInteger(byteOffset) ||
            byteOffset < 0 ||
            byteOffset % TELEMETRY_SLOT_ALIGNMENT !== 0 ||
            byteOffset > sab.byteLength - TELEMETRY_SLOT_BYTES
        ) {
            return;
        }
        this._sabView = new Float32Array(sab, byteOffset, TELEMETRY_SLOT_FLOATS);
        // Int32 view over the same slot bytes for the seqlock counter.
        this._sabSeqView = new Int32Array(sab, byteOffset, TELEMETRY_SLOT_FLOATS);
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
            const order = isModuleOrder(msg.order) ? msg.order : null;
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
                validIdentity('reorder-modules')
            ) {
                this._lastFallbackControlSequence = correlation!.controlSequence as number;
                inst.reorder(order[0], order[1], order[2], order[3], order[4]);
                return;
            }
            if (
                !only(msg, ['schemaVersion', 'command', 'target', 'value', 'correlation', 'scheduling']) ||
                msg.schemaVersion !== 1 ||
                msg.command !== 'set-fallback-param' ||
                !isRecord(msg.target) ||
                !only(msg.target, ['trackId', 'deviceId', 'deviceType', 'parameterId']) ||
                !isProofRuntimeParameterId(msg.target.parameterId) ||
                !inParameterRange(msg.target.parameterId, msg.value) ||
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
            case 'param': {
                // The legacy message reaches the same wasm setter the live
                // namespace does, so it takes the same f32 and range check.
                const name = msg.name;
                if (boundedId(name) && acceptableLegacyParam(name, msg.value)) {
                    inst.set_param(name, msg.value);
                }
                break;
            }
            case 'reorder': {
                // Same shape check the live namespace applies. Indexing an
                // `order` that is missing, null or not an array threw a
                // TypeError into the onmessage catch and faulted the device
                // permanently.
                const order = msg.order;
                if (isModuleOrder(order)) {
                    inst.reorder(order[0], order[1], order[2], order[3], order[4]);
                }
                break;
            }
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
