// @ts-nocheck
/**
 * AudioWorkletProcessor for the Grinder amp simulator.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Effect processor: reads from inputs[0], writes to outputs[0].
 */

import { initSync, GrinderInstance } from '../wasm/daw_dsp.js';

const PARAM_MAP = {
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
    preOverdriveEnabled: 'preOverdriveEnabled',
    preOverdriveDrive: 'preOverdriveDrive',
    preOverdriveTone: 'preOverdriveTone',
    preOverdriveLevel: 'preOverdriveLevel',
    preDistortionEnabled: 'preDistortionEnabled',
    preDistortionDrive: 'preDistortionDrive',
    preDistortionTone: 'preDistortionTone',
    preDistortionLevel: 'preDistortionLevel',
    preFuzzEnabled: 'preFuzzEnabled',
    preFuzzFuzz: 'preFuzzFuzz',
    preFuzzTone: 'preFuzzTone',
    preFuzzLevel: 'preFuzzLevel',

    // Post-pedals
    postCompressorEnabled: 'postCompressorEnabled',
    postCompressorThreshold: 'postCompressorThreshold',
    postCompressorRatio: 'postCompressorRatio',
    postCompressorAttack: 'postCompressorAttack',
    postCompressorRelease: 'postCompressorRelease',
    postOverdriveEnabled: 'postOverdriveEnabled',
    postOverdriveDrive: 'postOverdriveDrive',
    postOverdriveTone: 'postOverdriveTone',
    postOverdriveLevel: 'postOverdriveLevel',
    postDistortionEnabled: 'postDistortionEnabled',
    postDistortionDrive: 'postDistortionDrive',
    postDistortionTone: 'postDistortionTone',
    postDistortionLevel: 'postDistortionLevel',
    postFuzzEnabled: 'postFuzzEnabled',
    postFuzzFuzz: 'postFuzzFuzz',
    postFuzzTone: 'postFuzzTone',
    postFuzzLevel: 'postFuzzLevel',

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

    _instance = null; // GrinderInstance (generated wasm-bindgen class)
    _memory = null; // WebAssembly.Memory (for direct buffer access in process())
    _ready = false;
    _faulted = false;
    _meterCounter = 0;
    _sabView = null; // Float32Array view into the telemetry SharedArrayBuffer slot

    constructor() {
        super();
        this.port.onmessage = (event) => {
            const msg = event.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'init-sab') {
                    this._sabView = new Float32Array(msg.sab, msg.byteOffset, 32);
                } else if (msg.type === 'param' && this._ready && !this._faulted) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    this._instance.set_param(rustName, msg.value);
                }
            } catch (error) {
                console.error('GrinderProcessor error:', error);
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new GrinderInstance(sampleRate);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _passthrough(input, output) {
        const leftIn = input[0];
        const rightIn = input[1] ?? leftIn;
        if (output[0] && leftIn) {
            output[0].set(leftIn);
        }
        if (output[1] && rightIn) {
            output[1].set(rightIn);
        }
    }

    process(inputs, outputs, parameters) {
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

        const frames = output[0].length;
        if (frames > MAX_GRINDER_BLOCK_SIZE) {
            this._passthrough(input, output);
            return true;
        }

        try {
            const inst = this._instance;
            const mem = this._memory.buffer;

            // Update AudioParams
            for (const name in parameters) {
                const values = parameters[name];
                if (values.length === 0) {
                    continue;
                }
                const value = values.length > 1 ? values[frames - 1] : values[0];
                const rustName = PARAM_MAP[name] ?? name;
                inst.set_param(rustName, value);
            }

            const inLeftPtr = inst.get_input_left_ptr();
            const inRightPtr = inst.get_input_right_ptr();
            if (!inLeftPtr || !inRightPtr) {
                this._passthrough(input, output);
                return true;
            }

            new Float32Array(mem, inLeftPtr, frames).set(input[0]);
            new Float32Array(mem, inRightPtr, frames).set(input[1] ?? input[0]);

            const outLeftPtr = inst.process(frames);
            const outRightPtr = inst.get_right_ptr();
            if (!outLeftPtr || !outRightPtr) {
                this._passthrough(input, output);
                return true;
            }

            output[0].set(new Float32Array(mem, outLeftPtr, frames));
            if (output[1]) {
                output[1].set(new Float32Array(mem, outRightPtr, frames));
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
