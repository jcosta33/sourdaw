// @ts-nocheck
/**
 * AudioWorkletProcessor for the Fermenter synthesizer.
 *
 * Calls the raw wasm-bindgen WASM exports directly — no glue JS, no TextDecoder,
 * no eval. Works in AudioWorklet scope on all browsers including Safari/WKWebView.
 *
 * Messages from main thread:
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'noteOn', note, velocity }
 *   { type: 'noteOff', note }
 *   { type: 'param', name, value }
 */

/**
 * Map TypeScript camelCase param names (from FermenterPatch) to
 * Rust snake_case names (used by MasterSynth::set_param).
 */
const PARAM_MAP = {
    oscEngine: 'engine',
    oscWaveform: 'osc_waveform',
    oscLevel: 'osc_level',
    oscCoarse: 'osc_coarse',
    oscFine: 'osc_fine',
    pulseWidth: 'pulse_width',
    unisonVoices: 'unison_voices',
    unisonDetune: 'unison_detune',
    unisonSpread: 'unison_spread',
    noiseLevel: 'noise_level',
    noiseColor: 'noise_color',
    filterMode: 'filter_mode',
    filterCutoff: 'cutoff',
    filterResonance: 'resonance',
    filterDrive: 'filter_drive',
    filterKeytrack: 'filter_keytrack',
    ampAttack: 'amp_attack',
    ampDecay: 'amp_decay',
    ampSustain: 'amp_sustain',
    ampRelease: 'amp_release',
    filterAttack: 'filter_attack',
    filterDecay: 'filter_decay',
    filterSustain: 'filter_sustain',
    filterRelease: 'filter_release',
    filterEnvAmount: 'mod_env_to_filter',
    lfoRate: 'lfo_rate',
    lfoShape: 'lfo_shape',
    lfoPitchAmount: 'mod_lfo_to_pitch',
    lfoFilterAmount: 'lfo_filter_amount',
    portamentoTime: 'portamento',
    portamentoMode: 'portamento_mode',
    reverbMix: 'reverb_mix',
    reverbDecay: 'reverb_decay',
    delayTime: 'delay_time',
    delayFeedback: 'delay_feedback',
    delayMix: 'delay_mix',
    chorusRate: 'chorus_rate',
    chorusDepth: 'chorus_depth',
    chorusMix: 'chorus_mix',
    masterGain: 'master_gain',
};

class FermenterProcessor extends AudioWorkletProcessor {
    _wasm = null;      // WASM exports
    _mem = null;       // WebAssembly.Memory
    _ptr = 0;          // FermenterInstance pointer
    _ready = false;

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'noteOn' && this._ready) {
                    this._wasm.fermenterinstance_note_on(this._ptr, msg.note, msg.velocity);
                } else if (msg.type === 'noteOff' && this._ready) {
                    this._wasm.fermenterinstance_note_off(this._ptr, msg.note);
                } else if (msg.type === 'param' && this._ready) {
                    const rustName = PARAM_MAP[msg.name] ?? msg.name;
                    this._setParam(rustName, msg.value);
                }
            } catch (err) {
                console.error('FermenterProcessor error:', err);
            }
        };
    }

    _initWasm(wasmBytes) {
        // Provide the two imports wasm-bindgen needs
        const imports = {
            './fermenter_bg.js': {
                __wbg___wbindgen_throw_6ddd609b62940d55(ptr, len) {
                    // Read error string from WASM memory and throw
                    throw new Error('WASM error at ' + ptr + ' len ' + len);
                },
                __wbindgen_init_externref_table() {
                    const table = instance.exports.__wbindgen_externrefs;
                    if (table) {
                        const offset = table.grow(4);
                        table.set(0, undefined);
                        table.set(offset + 0, undefined);
                        table.set(offset + 1, null);
                        table.set(offset + 2, true);
                        table.set(offset + 3, false);
                    }
                },
            },
        };

        const mod = new WebAssembly.Module(wasmBytes);
        const instance = new WebAssembly.Instance(mod, imports);
        const w = instance.exports;

        // Run wasm-bindgen init
        if (w.__wbindgen_start) {
            w.__wbindgen_start();
        }

        this._wasm = w;
        this._mem = w.memory;

        // Create synth: 32 voices at worklet sample rate
        this._ptr = w.fermenterinstance_new(sampleRate, 32) >>> 0;
        this._ready = true;

        this.port.postMessage({ type: 'ready' });
    }

    /**
     * Write an ASCII param name into WASM linear memory and call set_param.
     * No TextEncoder needed — param names are always ASCII.
     */
    _setParam(name, value) {
        const w = this._wasm;
        const len = name.length;
        const strPtr = w.__wbindgen_malloc(len, 1) >>> 0;
        const buf = new Uint8Array(w.memory.buffer, strPtr, len);
        for (let i = 0; i < len; i++) {
            buf[i] = name.charCodeAt(i);
        }
        w.fermenterinstance_set_param(this._ptr, strPtr, len, value);
    }

    process(_inputs, outputs) {
        if (!this._ready) return true;

        const output = outputs[0];
        if (!output || output.length < 2) return true;

        const frames = output[0].length;
        const w = this._wasm;

        // Run DSP — returns pointer to left channel buffer
        const leftPtr = w.fermenterinstance_process(this._ptr, frames) >>> 0;
        const rightPtr = w.fermenterinstance_get_right_ptr(this._ptr) >>> 0;

        // Read from WASM linear memory into output
        const mem = w.memory.buffer;
        output[0].set(new Float32Array(mem, leftPtr, frames));
        if (output[1]) {
            output[1].set(new Float32Array(mem, rightPtr, frames));
        }

        return true;
    }
}

registerProcessor('fermenter-processor', FermenterProcessor);
