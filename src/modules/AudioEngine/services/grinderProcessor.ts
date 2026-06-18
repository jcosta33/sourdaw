/**
 * AudioWorkletProcessor for the Grinder amp simulator.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 */

import { initSync, GrinderInstance } from '../wasm/daw_dsp.js';

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

type GrinderMsg =
    | { type: 'init'; wasmBytes: BufferSource }
    | { type: 'init-sab'; sab: SharedArrayBuffer; byteOffset: number }
    | { type: 'param'; name: string; value: number }
    | { type: 'patch'; patch: Record<string, unknown> };

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
        return [
            { name: 'gain', defaultValue: 5, minValue: 0, maxValue: 10 },
            { name: 'bass', defaultValue: 5, minValue: 0, maxValue: 10 },
            { name: 'mid', defaultValue: 5, minValue: 0, maxValue: 10 },
            { name: 'treble', defaultValue: 5, minValue: 0, maxValue: 10 },
            { name: 'presence', defaultValue: 5, minValue: 0, maxValue: 10 },
            { name: 'resonance', defaultValue: 5, minValue: 0, maxValue: 10 },
            { name: 'master', defaultValue: 5, minValue: 0, maxValue: 10 },
            { name: 'inputGain', defaultValue: 0, minValue: -24, maxValue: 24 },
            { name: 'outputGain', defaultValue: 0, minValue: -24, maxValue: 24 },
        ];
    }

    _instance: GrinderInstance | null = null;
    _memory: WebAssembly.Memory | null = null;
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView: Float32Array | null = null;

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<GrinderMsg>) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'init-sab') {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                } else if (msg.type === 'param' && this._instance !== null && !this._faulted) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    const oldLatency = this._instance.get_latency_samples();
                    this._instance.set_param(rustName, msg.value);
                    const newLatency = this._instance.get_latency_samples();
                    if (newLatency !== oldLatency) {
                        this.port.postMessage({ type: 'latency-changed', latency: newLatency });
                    }
                } else if (msg.type === 'patch' && this._instance !== null && !this._faulted) {
                    const oldLatency = this._instance.get_latency_samples();
                    applyNeuralPatch(this._instance, msg.patch);
                    const newLatency = this._instance.get_latency_samples();
                    if (newLatency !== oldLatency) {
                        this.port.postMessage({ type: 'latency-changed', latency: newLatency });
                    }
                }
            } catch (error) {
                console.error('GrinderProcessor error:', error);
            }
        };
    }

    _initWasm(wasmBytes: BufferSource): void {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new GrinderInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready', latency: this._instance.get_latency_samples() });
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
            const inst = this._instance;
            const mem = this._memory?.buffer;
            if (!inst || !mem) {
                return true;
            }

            for (const name in parameters) {
                const values = parameters[name];
                if (!values || values.length === 0) {
                    continue;
                }
                const value = values.length > 1 ? (values[frames - 1] ?? 0) : (values[0] ?? 0);
                const rustName = PARAM_MAP[name] ?? name;
                inst.set_param(rustName, value);
            }

            const in0 = input[0];
            if (!in0) {
                this._passthrough(input, output);
                return true;
            }

            const inLeftPtr = inst.get_input_left_ptr();
            const inRightPtr = inst.get_input_right_ptr();
            if (!inLeftPtr || !inRightPtr) {
                this._passthrough(input, output);
                return true;
            }

            new Float32Array(mem, inLeftPtr, frames).set(in0);
            new Float32Array(mem, inRightPtr, frames).set(input[1] ?? in0);

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();
            if (!outLeftPtr || !outRightPtr) {
                this._passthrough(input, output);
                return true;
            }

            out0.set(new Float32Array(mem, outLeftPtr, frames));
            const out1 = output[1];
            if (out1) {
                out1.set(new Float32Array(mem, outRightPtr, frames));
            }

            this._meterCounter++;
            if (this._meterCounter >= 8) {
                this._meterCounter = 0;
                if (this._sabView) {
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
