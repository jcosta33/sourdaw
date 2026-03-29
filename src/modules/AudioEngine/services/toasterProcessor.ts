// @ts-nocheck
/**
 * AudioWorkletProcessor for the Toaster drum machine.
 *
 * Calls raw wasm-bindgen WASM exports directly — same pattern as fermenterProcessor.
 * Handles noteOn (pad trigger), noteOff, param, and pad_param messages.
 */

/** Map camelCase pad param names from TypeScript to snake_case for Rust. */
const PAD_PARAM_MAP = {
    volume: 'volume',
    pan: 'pan',
    muted: 'muted',
    tune: 'tune',
    decay: 'decay',
    tone: 'tone',
    drive: 'drive',
    filterCutoff: 'filter_cutoff',
    filterResonance: 'filter_resonance',
    sendReverb: 'send_reverb',
    sendDelay: 'send_delay',
    transientAttack: 'transient_attack',
    transientSustain: 'transient_sustain',
    busRoute: 'bus_route',
    engineType: 'engine_type',
};

/** Map camelCase kit param names to snake_case. */
const KIT_PARAM_MAP = {
    masterGain: 'master_gain',
    reverbMix: 'reverb_mix',
    reverbDecay: 'reverb_decay',
    delayTime: 'delay_time',
    delayFeedback: 'delay_feedback',
    delayMix: 'delay_mix',
    swing: 'swing',
    lofiBits: 'lofi_bits',
    lofiRate: 'lofi_rate',
    lofiMix: 'lofi_mix',
};

class ToasterProcessor extends AudioWorkletProcessor {
    _wasm = null;
    _mem = null;
    _ptr = 0;
    _ready = false;

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) { return; }
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'noteOn' && this._ready) {
                    this._wasm.toasterinstance_note_on(this._ptr, msg.pad, msg.velocity, msg.note ?? 60);
                } else if (msg.type === 'noteOff' && this._ready) {
                    this._wasm.toasterinstance_note_off(this._ptr, msg.pad);
                } else if (msg.type === 'param' && this._ready) {
                    this._setParam(KIT_PARAM_MAP[msg.name] ?? msg.name, msg.value);
                } else if (msg.type === 'padParam' && this._ready) {
                    this._setPadParam(msg.pad, PAD_PARAM_MAP[msg.name] ?? msg.name, msg.value);
                }
            } catch (err) {
                console.error('ToasterProcessor error:', err);
            }
        };
    }

    _initWasm(wasmBytes) {
        const mod = new WebAssembly.Module(wasmBytes);
        const importInfo = WebAssembly.Module.imports(mod);
        const bgImports = {};
        
        let instance; // captured securely

        for (const imp of importInfo) {
            if (imp.module === './daw_dsp_bg.js' || imp.module === './toaster_bg.js') {
                if (imp.name.startsWith('__wbg___wbindgen_throw_')) {
                    bgImports[imp.name] = function(ptr, len) {
                        throw new Error('WASM error at ptr ' + ptr + ' len ' + len);
                    };
                } else if (imp.name === '__wbindgen_init_externref_table') {
                    bgImports[imp.name] = function() {
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
                } else if (imp.name.startsWith('__wbg___wbindgen_copy_to_typed_array_')) {
                    bgImports[imp.name] = function(arg0, arg1, arg2) {
                        // Minimal emulation: arg2 is a fat pointer to JS object, arg0/arg1 is WASM slice
                        // Realistically Worklets don't pass JS objects back and forth, so empty stub works 
                        // as long as it doesn't crash initialization
                    };
                } else {
                    bgImports[imp.name] = function() {};
                }
            }
        }

        const imports = {
            './daw_dsp_bg.js': bgImports,
            './toaster_bg.js': bgImports,
        };

        instance = new WebAssembly.Instance(mod, imports);
        const w = instance.exports;

        if (w.__wbindgen_start) {
            w.__wbindgen_start();
        }

        this._wasm = w;
        this._mem = w.memory;

        // Create drum machine: 16 pads at worklet sample rate
        this._ptr = w.toasterinstance_new(sampleRate, 16) >>> 0;
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
        w.toasterinstance_set_param(this._ptr, strPtr, len, value);
    }

    _setPadParam(pad, name, value) {
        const w = this._wasm;
        const len = name.length;
        const strPtr = w.__wbindgen_malloc(len, 1) >>> 0;
        const buf = new Uint8Array(w.memory.buffer, strPtr, len);
        for (let i = 0; i < len; i++) {
            buf[i] = name.charCodeAt(i);
        }
        w.toasterinstance_set_pad_param(this._ptr, pad, strPtr, len, value);
    }

    process(_inputs, outputs) {
        if (!this._ready) { return true; }

        const output = outputs[0];
        if (!output || output.length < 2) { return true; }

        const frames = output[0].length;
        const w = this._wasm;

        const leftPtr = w.toasterinstance_process(this._ptr, frames) >>> 0;
        const rightPtr = w.toasterinstance_get_right_ptr(this._ptr) >>> 0;

        const mem = w.memory.buffer;
        output[0].set(new Float32Array(mem, leftPtr, frames));
        if (output[1]) {
            output[1].set(new Float32Array(mem, rightPtr, frames));
        }

        return true;
    }
}

registerProcessor('toaster-processor', ToasterProcessor);
