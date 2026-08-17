/**
 * AudioWorkletProcessor for the Grinder amp simulator.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 */

import { resolveProcessorWasmModule } from '../transformers/resolveProcessorWasmModule';
import { initSync, GrinderInstance } from '../wasm/daw_dsp.js';

import grinderAudioParamContract from './grinderAudioParamContract.json';
import { beginTelemetryPublish, endTelemetryPublish } from './telemetrySeqlock';

type GrinderAudioParamDescriptor = {
    name: string;
    defaultValue: number;
    minValue: number;
    maxValue: number;
    automationRate: 'a-rate';
};

const GRINDER_AUDIO_PARAM_DESCRIPTORS: readonly GrinderAudioParamDescriptor[] = grinderAudioParamContract.map(
    ({ name, defaultValue, minValue, maxValue }) => ({
        name,
        defaultValue,
        minValue,
        maxValue,
        automationRate: 'a-rate',
    })
);

const PARAM_MAP: Record<string, string> = {
    engineMode: 'engineMode',
    gain: 'gain',
    bass: 'bass',
    mid: 'mid',
    treble: 'treble',
    master: 'master',
    presence: 'presence',
    resonance: 'resonance',
    inputGain: 'inputGain',
    outputGain: 'outputGain',
    channel: 'channel',
    bright: 'bright',
    fat: 'fat',
    tubeBias: 'tubeBias',
    tubeAge: 'tubeAge',
    millerCapacitance: 'millerCapacitance',
    gridConduction: 'gridConduction',
    couplingCapCharge: 'couplingCapCharge',
    sagAmount: 'sagAmount',
    sagRecovery: 'sagRecovery',
    negFeedback: 'negFeedback',
    powerAmpBias: 'powerAmpBias',
    transformerDrive: 'transformerDrive',
    transformerHysteresis: 'transformerHysteresis',
    transformerLfSaturation: 'transformerLfSaturation',
    cabType: 'cabType',
    cabIrSlot: 'cabIrSlot',
    routingMode: 'routingMode',
    cabEnabled: 'cabEnabled',
    cabResonanceFreq: 'cabResonanceFreq',
    cabDamping: 'cabDamping',
    coneBreakup: 'coneBreakup',
    backEmf: 'backEmf',
    outputMix: 'outputMix',
    cleanBlend: 'cleanBlend',
    limiterThreshold: 'limiterThreshold',
    neuralEnabled: 'neuralEnabled',
    neuralPlacement: 'neuralPlacement',
    neuralMix: 'neuralMix',
    neuralCpuBudget: 'neuralCpuBudget',
    gateEnabled: 'gateEnabled',
    gateThreshold: 'gateThreshold',
    bypass: 'bypass',

    // Pre-pedals
    preCompressorEnabled: 'preCompressorEnabled',
    preCompressorThreshold: 'preCompressorThreshold',
    preCompressorRatio: 'preCompressorRatio',
    preCompressorAttack: 'preCompressorAttack',
    preCompressorRelease: 'preCompressorRelease',
    preCompressorOrder: 'preCompressorOrder',
    preOverdriveEnabled: 'preOverdriveEnabled',
    preOverdriveDrive: 'preOverdriveDrive',
    preOverdriveTone: 'preOverdriveTone',
    preOverdriveLevel: 'preOverdriveLevel',
    preOverdriveOrder: 'preOverdriveOrder',
    preDistortionEnabled: 'preDistortionEnabled',
    preDistortionDrive: 'preDistortionDrive',
    preDistortionTone: 'preDistortionTone',
    preDistortionLevel: 'preDistortionLevel',
    preDistortionOrder: 'preDistortionOrder',
    preFuzzEnabled: 'preFuzzEnabled',
    preFuzzFuzz: 'preFuzzFuzz',
    preFuzzTone: 'preFuzzTone',
    preFuzzLevel: 'preFuzzLevel',
    preFuzzOrder: 'preFuzzOrder',

    // Post-pedals
    postCompressorEnabled: 'postCompressorEnabled',
    postCompressorThreshold: 'postCompressorThreshold',
    postCompressorRatio: 'postCompressorRatio',
    postCompressorAttack: 'postCompressorAttack',
    postCompressorRelease: 'postCompressorRelease',
    postCompressorOrder: 'postCompressorOrder',
    postOverdriveEnabled: 'postOverdriveEnabled',
    postOverdriveDrive: 'postOverdriveDrive',
    postOverdriveTone: 'postOverdriveTone',
    postOverdriveLevel: 'postOverdriveLevel',
    postOverdriveOrder: 'postOverdriveOrder',
    postDistortionEnabled: 'postDistortionEnabled',
    postDistortionDrive: 'postDistortionDrive',
    postDistortionTone: 'postDistortionTone',
    postDistortionLevel: 'postDistortionLevel',
    postDistortionOrder: 'postDistortionOrder',
    postFuzzEnabled: 'postFuzzEnabled',
    postFuzzFuzz: 'postFuzzFuzz',
    postFuzzTone: 'postFuzzTone',
    postFuzzLevel: 'postFuzzLevel',
    postFuzzOrder: 'postFuzzOrder',

    // Mics
    mic1Enabled: 'mic1Enabled',
    mic1PositionX: 'mic1PositionX',
    mic1PositionY: 'mic1PositionY',
    mic1Distance: 'mic1Distance',
    mic1Gain: 'mic1Gain',
    mic2Enabled: 'mic2Enabled',
    mic2PositionX: 'mic2PositionX',
    mic2PositionY: 'mic2PositionY',
    mic2Distance: 'mic2Distance',
    mic2Gain: 'mic2Gain',
    micBlend: 'micBlend',
    roomAmount: 'roomAmount',
};

const MAX_GRINDER_BLOCK_SIZE = 2048;

/**
 * Shared-layout constant for the automation SAB, and **not** a loop bound.
 *
 * The automation buffer is one flat `f32` region with two parts: a header of
 * one value-count per parameter, then a value region of one
 * `MAX_GRINDER_BLOCK_SIZE`-wide block per parameter. Both sides compute the
 * start of the value region as *the number of automatable parameters* —
 * `GRINDER_AUTOMATABLE_PARAM_COUNT + index * stride`, here in `process()` and
 * in `apply_automatable_constants` / `apply_automatable_frame`
 * (`crates/daw-dsp/src/grinder/engine.rs`). Rust derives its copy from
 * `GRINDER_AUTOMATABLE_PARAM_CONTRACT.len()`
 * (`crates/daw-dsp/src/grinder/params.rs`), which a crate test pins against
 * this very JSON file via `include_str!` (`grinder/mod.rs`).
 *
 * This used to be a literal `11` restating `grinderAudioParamContract.json`,
 * which is imported at the top of this file. That is worse than an off-by-one
 * loop bound: a twelfth contract entry moves Rust's base to 12 while a pinned
 * TS base stays at 11, so every parameter's value would be written one float
 * short of where Rust reads it. Rust then reads whatever sits in the slot it
 * *does* index — for the constant (`valueCount === 1`) case that is an untouched
 * `0.0`, which `clamp` accepts, so every knob silently collapses to its minimum
 * and the amp renders near-silent. Nothing traps: the TS view is *smaller* than
 * Rust's `Vec`, so the write stays comfortably in bounds.
 *
 * Deriving it means the two bases cannot drift apart in the first place, and
 * `wasm/__tests__/dawDspGrinderAutomationLayout.spec.ts` welds this derivation
 * to the shipped binary — it drives every contract entry through this exact
 * layout and requires the render to match the engine's own by-name path.
 */
const GRINDER_AUTOMATABLE_PARAM_COUNT = GRINDER_AUDIO_PARAM_DESCRIPTORS.length;
const GRINDER_AUTOMATION_BUFFER_SIZE =
    GRINDER_AUTOMATABLE_PARAM_COUNT + GRINDER_AUTOMATABLE_PARAM_COUNT * MAX_GRINDER_BLOCK_SIZE;

const MAX_PENDING_FALLBACK_CONTROLS = 32;
const MAX_RUNTIME_CONTROL_ID_LENGTH = 128;

type UnknownRecord = Record<string, unknown>;

type ScheduledFallbackControl = {
    parameterId: string;
    value: number;
    targetFrame: number;
    deadlineFrame: number;
};

type FallbackControlTarget = {
    trackId: string;
    deviceId: string;
    deviceType: string;
    parameterIds: readonly string[];
};

type GrinderNeuralProfilePatch = {
    neuralModelMode?: unknown;
    profile?: {
        preferredTier?: unknown;
        inputDrive?: unknown;
        asymmetry?: unknown;
        outputTrim?: unknown;
        contourMix?: unknown;
        recurrentBias?: unknown;
        convWeights?: unknown;
    };
};

const NEURAL_TIER_INDEX: Record<string, number> = {
    standard: 0,
    lite: 1,
    nano: 2,
    recurrent: 3,
};

function to_finite_number(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, keys: readonly string[]): boolean {
    const actualKeys = Object.keys(value);
    return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isBoundedId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= MAX_RUNTIME_CONTROL_ID_LENGTH;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return isNonNegativeSafeInteger(value) && value > 0;
}

function applyNeuralPatch(instance: GrinderInstance, patch: Record<string, unknown>): void {
    const neural_patch = patch as GrinderNeuralProfilePatch;
    if (neural_patch.neuralModelMode === 'builtin') {
        instance.set_param('neuralModelMode', 0);
        return;
    }

    if (
        neural_patch.neuralModelMode !== 'imported' ||
        !neural_patch.profile ||
        typeof neural_patch.profile !== 'object'
    ) {
        return;
    }

    const profile = neural_patch.profile;
    const conv_weights: unknown[] = Array.isArray(profile.convWeights) ? profile.convWeights : [];

    const preferred_tier =
        typeof profile.preferredTier === 'string' ? (NEURAL_TIER_INDEX[profile.preferredTier] ?? 0) : 0;
    instance.set_param('neuralCustomTier', preferred_tier);

    const input_drive = to_finite_number(profile.inputDrive);
    if (input_drive !== null) {
        instance.set_param('neuralCustomInputDrive', input_drive);
    }

    const asymmetry = to_finite_number(profile.asymmetry);
    if (asymmetry !== null) {
        instance.set_param('neuralCustomAsymmetry', asymmetry);
    }

    const output_trim = to_finite_number(profile.outputTrim);
    if (output_trim !== null) {
        instance.set_param('neuralCustomOutputTrim', output_trim);
    }

    const contour_mix = to_finite_number(profile.contourMix);
    if (contour_mix !== null) {
        instance.set_param('neuralCustomContourMix', contour_mix);
    }

    const recurrent_bias = to_finite_number(profile.recurrentBias);
    if (recurrent_bias !== null) {
        instance.set_param('neuralCustomLstmBias', recurrent_bias);
    }

    for (let layer_index = 0; layer_index < conv_weights.length; layer_index++) {
        const weights = conv_weights[layer_index];
        if (!Array.isArray(weights) || weights.length < 3) {
            continue;
        }
        for (let weight_index = 0; weight_index < 3; weight_index++) {
            const value = to_finite_number(weights[weight_index]);
            if (value !== null) {
                instance.set_param(`neuralCustomConvWeight${layer_index}_${weight_index}`, value);
            }
        }
    }

    instance.set_param('neuralModelMode', 1);
}

class GrinderProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return GRINDER_AUDIO_PARAM_DESCRIPTORS;
    }

    _instance: GrinderInstance | null = null;
    _wasmInputLeft: Float32Array | null = null;
    _wasmInputRight: Float32Array | null = null;
    _wasmOutputLeft: Float32Array | null = null;
    _wasmOutputRight: Float32Array | null = null;
    _wasmAutomationValues: Float32Array | null = null;
    _wasmMemory: WebAssembly.Memory | null = null;
    _wasmMemoryBuffer: ArrayBuffer | null = null;
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView: Float32Array | null = null;
    /** Int32 view over the same slot bytes — carries the seqlock counter (RT-2). */
    _sabSeqView: Int32Array | null = null;
    _fallbackControlGeneration: number | null = null;
    _fallbackControlTarget: FallbackControlTarget | null = null;
    _lastFallbackControlSequence = 0;
    _pendingFallbackControls: Array<ScheduledFallbackControl | null> = Array.from(
        { length: MAX_PENDING_FALLBACK_CONTROLS },
        () => null
    );

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
                        throw new TypeError('GrinderProcessor requires a compiled WASM module');
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
                } else if (this._handleFallbackControl(msg)) {
                    return;
                } else if (msg.type === 'patch' && isRecord(msg.patch) && this._instance !== null && !this._faulted) {
                    const oldLatency = this._instance.get_latency_samples();
                    applyNeuralPatch(this._instance, msg.patch);
                    const newLatency = this._instance.get_latency_samples();
                    this._refreshWasmViewsIfMemoryChanged();
                    if (newLatency !== oldLatency) {
                        this.port.postMessage({ type: 'latency-changed', latency: newLatency });
                    }
                }
            } catch (error) {
                // Same policy as the process() catch below. A throw at the wasm
                // boundary may leave the instance trapped, and a trap carries no
                // message, so it cannot be told apart from a recoverable error.
                // Report it and stop taking work; a worklet console reaches nobody.
                console.error('GrinderProcessor error:', error);
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
        const controlTarget = this._fallbackControlTarget;
        if (
            this._fallbackControlGeneration === null ||
            controlTarget === null ||
            message.correlation.workletGeneration !== this._fallbackControlGeneration ||
            message.correlation.controlSequence <= this._lastFallbackControlSequence ||
            message.target.trackId !== controlTarget.trackId ||
            message.target.deviceId !== controlTarget.deviceId ||
            message.target.deviceType !== controlTarget.deviceType ||
            !controlTarget.parameterIds.includes(message.target.parameterId)
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
            if (slot === -1) {
                return true;
            }
            this._pendingFallbackControls[slot] = {
                parameterId: message.target.parameterId,
                value: message.value,
                targetFrame,
                deadlineFrame,
            };
            return true;
        }
        this._applyFallbackControl(message.target.parameterId, message.value);
        return true;
    }

    _applyFallbackControl(parameterId: string, value: number): void {
        if (this._instance === null || this._faulted) {
            return;
        }
        const rustName = PARAM_MAP[parameterId] ?? parameterId;
        const oldLatency = this._instance.get_latency_samples();
        this._instance.set_param(rustName, value);
        const newLatency = this._instance.get_latency_samples();
        if (newLatency !== oldLatency) {
            this.port.postMessage({ type: 'latency-changed', latency: newLatency });
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
                continue;
            }
            if (currentFrame >= pending.targetFrame) {
                this._pendingFallbackControls[index] = null;
                this._applyFallbackControl(pending.parameterId, pending.value);
            }
        }
    }

    _initWasm(wasmModule: WebAssembly.Module): void {
        const wasmExports = initSync({ module: wasmModule });
        this._instance = new GrinderInstance(sampleRate);
        this._wasmMemory = wasmExports.memory;
        this._cacheWasmViews();
        this._ready = true;
        this.port.postMessage({ type: 'ready', latency: this._instance.get_latency_samples() });
    }

    _cacheWasmViews(): void {
        const instance = this._instance;
        const memory = this._wasmMemory;
        if (!instance || !memory) {
            throw new Error('Grinder WASM instance is unavailable');
        }

        const inputLeftPtr = instance.get_input_left_ptr();
        const inputRightPtr = instance.get_input_right_ptr();
        const outputLeftPtr = instance.get_output_left_ptr();
        const outputRightPtr = instance.get_right_ptr();
        const automationValuesPtr = instance.get_automation_values_ptr();
        if (!inputLeftPtr || !inputRightPtr || !outputLeftPtr || !outputRightPtr || !automationValuesPtr) {
            throw new Error('Grinder WASM buffers are unavailable');
        }

        const memoryBuffer = memory.buffer;
        this._wasmInputLeft = new Float32Array(memoryBuffer, inputLeftPtr, MAX_GRINDER_BLOCK_SIZE);
        this._wasmInputRight = new Float32Array(memoryBuffer, inputRightPtr, MAX_GRINDER_BLOCK_SIZE);
        this._wasmOutputLeft = new Float32Array(memoryBuffer, outputLeftPtr, MAX_GRINDER_BLOCK_SIZE);
        this._wasmOutputRight = new Float32Array(memoryBuffer, outputRightPtr, MAX_GRINDER_BLOCK_SIZE);
        this._wasmAutomationValues = new Float32Array(
            memoryBuffer,
            automationValuesPtr,
            GRINDER_AUTOMATION_BUFFER_SIZE
        );
        this._wasmMemoryBuffer = memoryBuffer;
    }

    _refreshWasmViewsIfMemoryChanged(): void {
        if (this._wasmMemory?.buffer !== this._wasmMemoryBuffer) {
            this._cacheWasmViews();
        }
    }

    _passthrough(input: Float32Array[], output: Float32Array[]): void {
        const leftIn = input[0];
        const rightIn = input[1] ?? leftIn;
        if (output[0] && leftIn) {
            output[0].set(leftIn);
        }
        if (output[1] && rightIn) {
            output[1].set(rightIn);
        }
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
        const input = inputs[0];
        const output = outputs[0];

        if (!this._ready || this._faulted) {
            if (input && output) {
                this._passthrough(input, output);
            }
            return true;
        }
        if (!input || input.length === 0 || !output || output.length === 0) {
            return true;
        }

        const out0 = output[0];
        if (!out0) {
            return true;
        }
        const frames = out0.length;
        if (frames > MAX_GRINDER_BLOCK_SIZE) {
            this._passthrough(input, output);
            return true;
        }

        try {
            // Revalidate cached WASM-memory views each quantum: a Rust-side
            // allocation can grow the linear memory and detach the old buffer,
            // leaving the init-time views zero-length (audit RT-7). This is a
            // buffer-identity compare in steady state — no allocation — and only
            // rebuilds on an actual growth event. The message-path refresh above
            // does not cover growth that happens purely from process() DSP.
            this._refreshWasmViewsIfMemoryChanged();
            const inst = this._instance;
            const wasmInputLeft = this._wasmInputLeft;
            const wasmInputRight = this._wasmInputRight;
            const wasmOutputLeft = this._wasmOutputLeft;
            const wasmOutputRight = this._wasmOutputRight;
            const wasmAutomationValues = this._wasmAutomationValues;
            if (
                !inst ||
                !wasmInputLeft ||
                !wasmInputRight ||
                !wasmOutputLeft ||
                !wasmOutputRight ||
                !wasmAutomationValues
            ) {
                return true;
            }

            this._applyDueFallbackControls();

            const in0 = input[0];
            if (!in0) {
                this._passthrough(input, output);
                return true;
            }

            const in1 = input[1] ?? in0;
            const out1 = output[1];
            wasmInputLeft.set(in0);
            wasmInputRight.set(in1);

            for (let paramIndex = 0; paramIndex < GRINDER_AUTOMATABLE_PARAM_COUNT; paramIndex++) {
                const descriptor = GRINDER_AUDIO_PARAM_DESCRIPTORS[paramIndex];
                const values = descriptor ? parameters[descriptor.name] : undefined;
                if (!values || values.length === 0) {
                    wasmAutomationValues[paramIndex] = 0;
                    continue;
                }

                const valueCount = values.length === 1 ? 1 : Math.min(values.length, frames);
                wasmAutomationValues[paramIndex] = valueCount;
                const valueOffset = GRINDER_AUTOMATABLE_PARAM_COUNT + paramIndex * MAX_GRINDER_BLOCK_SIZE;
                if (valueCount === 1) {
                    wasmAutomationValues[valueOffset] = values[0] ?? 0;
                    continue;
                }
                for (let frame = 0; frame < valueCount; frame++) {
                    wasmAutomationValues[valueOffset + frame] = values[frame] ?? 0;
                }
            }

            if (!inst.process_automated(frames)) {
                this._passthrough(input, output);
                return true;
            }

            // process_automated() may have grown WASM memory and detached the
            // buffer the cached output views map (audit RT-7): the pre-call refresh
            // above cannot see growth that happens inside the DSP call itself.
            // Revalidate and re-read the output views before copying out, or we
            // would read from a detached, zero-length view and emit silence.
            this._refreshWasmViewsIfMemoryChanged();
            const outLeft = this._wasmOutputLeft;
            const outRight = this._wasmOutputRight;
            if (!outLeft || !outRight) {
                this._passthrough(input, output);
                return true;
            }

            for (let frame = 0; frame < frames; frame++) {
                out0[frame] = outLeft[frame] ?? 0;
                if (out1) {
                    out1[frame] = outRight[frame] ?? 0;
                }
            }

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                if (this._sabView) {
                    // Seqlock publish (audit RT-2): counter odd, ten non-atomic
                    // float stores, counter even. Prevents a poll from pairing a
                    // gate state with a latency from a different quantum.
                    beginTelemetryPublish(this._sabSeqView);
                    this._sabView[0] = inst.get_input_db();
                    this._sabView[1] = inst.get_preamp_db();
                    this._sabView[2] = inst.get_power_amp_db();
                    this._sabView[3] = inst.get_output_db();
                    this._sabView[4] = inst.get_gate_open();
                    this._sabView[5] = inst.get_gate_envelope_db();
                    this._sabView[6] = inst.get_sag_voltage();
                    this._sabView[7] = inst.get_latency_samples();
                    this._sabView[8] = inst.get_neural_cpu_percent();
                    this._sabView[9] = inst.get_neural_warmup_progress();
                    endTelemetryPublish(this._sabSeqView);
                }
            }
        } catch (error) {
            // A WASM panic leaves WasmRefCell borrow counts corrupted — mark
            // faulted so we stop calling into WASM and fall back to passthrough.
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(error) });
            this._passthrough(input, output);
        }

        return true;
    }
}

registerProcessor('grinder-processor', GrinderProcessor);
