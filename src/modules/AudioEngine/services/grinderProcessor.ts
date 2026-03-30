// @ts-nocheck
/**
 * AudioWorkletProcessor for the Grinder amp simulator.
 * Effect processor: reads from inputs[0], writes to outputs[0].
 */

const PARAM_MAP = {
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
    neuralMix: 'neuralMix',
    neuralCpuBudget: 'neuralCpuBudget',
    gateEnabled: 'gateEnabled',
    gateThreshold: 'gateThreshold',
    bypass: 'bypass',
};

class GrinderProcessor extends AudioWorkletProcessor {
    _wasm = null;
    _mem = null;
    _ptr = 0;
    _ready = false;
    _inputLeftPtr = 0;
    _inputRightPtr = 0;
    _meterCounter = 0;

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {
                        return;
                    }
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'param' && this._ready) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    this._setParam(rustName, msg.value);
                }
            } catch (err) {
                console.error('GrinderProcessor error:', err);
            }
        };
    }

    _initWasm(wasmBytes) {
        const mod = new WebAssembly.Module(wasmBytes);
        const importInfo = WebAssembly.Module.imports(mod);
        const bgImports = {};

        let instance;

        for (const imp of importInfo) {
            if (imp.module === './daw_dsp_bg.js') {
                if (imp.name.startsWith('__wbg___wbindgen_throw_')) {
                    bgImports[imp.name] = function (ptr, len) {
                        throw new Error('WASM error at ptr ' + ptr + ' len ' + len);
                    };
                } else if (imp.name === '__wbindgen_init_externref_table') {
                    bgImports[imp.name] = function () {
                        const table = instance.exports.__wbindgen_externrefs;
                        if (table) {
                            const offset = table.grow(4);
                            table.set(0, undefined);
                            table.set(offset + 0, undefined);
                            table.set(offset + 1, null);
                            table.set(offset + 2, true);
                            table.set(offset + 3, false);
                        }
                    };
                } else {
                    bgImports[imp.name] = function () {};
                }
            }
        }

        const imports = {
            './daw_dsp_bg.js': bgImports,
        };

        instance = new WebAssembly.Instance(mod, imports);
        const w = instance.exports;

        if (w.__wbindgen_start) {
            w.__wbindgen_start();
        }

        this._wasm = w;
        this._mem = w.memory;

        this._ptr = w.grinderinstance_new(sampleRate) >>> 0;
        this._inputLeftPtr = w.grinderinstance_get_input_left_ptr(this._ptr) >>> 0;
        this._inputRightPtr = w.grinderinstance_get_input_right_ptr(this._ptr) >>> 0;

        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _setParam(name, value) {
        const w = this._wasm;
        const len = name.length;
        const strPtr = w.__wbindgen_malloc(len, 1) >>> 0;
        const buf = new Uint8Array(w.memory.buffer, strPtr, len);
        for (let i = 0; i < len; i++) {
            buf[i] = name.charCodeAt(i);
        }
        w.grinderinstance_set_param(this._ptr, strPtr, len, value);
    }

    process(inputs, outputs) {
        if (!this._ready) {
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || input.length < 2 || !output || output.length < 2) {
            return true;
        }

        const frames = output[0].length;
        const w = this._wasm;

        const inLeftPtr = w.grinderinstance_get_input_left_ptr(this._ptr) >>> 0;
        const inRightPtr = w.grinderinstance_get_input_right_ptr(this._ptr) >>> 0;

        const mem = w.memory.buffer;
        new Float32Array(mem, inLeftPtr, frames).set(input[0]);
        new Float32Array(mem, inRightPtr, frames).set(input[1] ?? input[0]);

        const outLeftPtr = w.grinderinstance_process(this._ptr, frames) >>> 0;
        const outRightPtr = w.grinderinstance_get_right_ptr(this._ptr) >>> 0;

        output[0].set(new Float32Array(mem, outLeftPtr, frames));
        if (output[1]) {
            output[1].set(new Float32Array(mem, outRightPtr, frames));
        }

        this._meterCounter++;
        if (this._meterCounter >= 8) {
            this._meterCounter = 0;
            this.port.postMessage({
                type: 'meters',
                inputDb: w.grinderinstance_get_input_db(this._ptr),
                preampDb: w.grinderinstance_get_preamp_db(this._ptr),
                powerAmpDb: w.grinderinstance_get_power_amp_db(this._ptr),
                outputDb: w.grinderinstance_get_output_db(this._ptr),
                sagVoltage: w.grinderinstance_get_sag_voltage(this._ptr),
                latency: w.grinderinstance_get_latency_samples(this._ptr),
            });
        }

        return true;
    }
}

registerProcessor('grinder-processor', GrinderProcessor);
