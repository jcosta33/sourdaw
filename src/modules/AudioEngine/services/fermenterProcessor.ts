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
    filterModel: 'filter_model',
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
    msegToFilter: 'mseg_to_filter',
    seqRate: 'seq_rate',
    seqToPitch: 'seq_to_pitch',
    portamentoTime: 'portamento',
    portamentoMode: 'portamento_mode',
    reverbType: 'reverb_type',
    reverbMix: 'reverb_mix',
    reverbDecay: 'reverb_decay',
    delayTime: 'delay_time',
    delayFeedback: 'delay_feedback',
    delayMix: 'delay_mix',
    chorusRate: 'chorus_rate',
    chorusDepth: 'chorus_depth',
    chorusMix: 'chorus_mix',
    phaserRate: 'phaser_rate',
    phaserDepth: 'phaser_depth',
    phaserMix: 'phaser_mix',
    distDrive: 'dist_drive',
    distTone: 'dist_tone',
    distMix: 'dist_mix',
    oscDrift: 'drift',
    warpMode: 'warp_mode',
    warpAmount: 'warp_amount',
    audioModRate: 'audio_mod_rate',
    audioModDepth: 'audio_mod_depth',
    audioModTarget: 'audio_mod_target',
    additivePartials: 'additive_partials',
    additiveTilt: 'additive_tilt',
    additiveOdd: 'additive_odd',
    additiveInharm: 'additive_inharm',
    samplerMode: 'sampler_mode',
    samplerStart: 'sampler_start',
    samplerEnd: 'sampler_end',
    voiceDrive: 'voice_drive',
    ksDamping: 'ks_damping',
    ksBrightness: 'ks_brightness',
    grainDensity: 'grain_density',
    grainSize: 'grain_size',
    grainPosition: 'grain_position',
    grainSpray: 'grain_spray',
    grainPitchVar: 'grain_pitch_var',
    grainPanSpread: 'grain_pan_spread',
    compThreshold: 'comp_threshold',
    compRatio: 'comp_ratio',
    compAttack: 'comp_attack',
    compRelease: 'comp_release',
    compMix: 'comp_mix',
    stereoWidth: 'stereo_width',
    activeLayer: 'active_layer',
    numLayers: 'num_layers',
    layerLevel: 'layer_level',
    layerPan: 'layer_pan',
    eqLowFreq: 'eq_low_freq',
    eqLowGain: 'eq_low_gain',
    eqLowQ: 'eq_low_q',
    eqMidFreq: 'eq_mid_freq',
    eqMidGain: 'eq_mid_gain',
    eqMidQ: 'eq_mid_q',
    eqHighFreq: 'eq_high_freq',
    eqHighGain: 'eq_high_gain',
    eqHighQ: 'eq_high_q',
    chaosAmount: 'chaos_amount',
    chaosSpeed: 'chaos_speed',
    masterGain: 'master_gain',
    fmAlgorithm: 'fm_algorithm',
    fmRatio1: 'fm_ratio1',
    fmRatio2: 'fm_ratio2',
    fmRatio3: 'fm_ratio3',
    fmRatio4: 'fm_ratio4',
    fmLevel1: 'fm_level1',
    fmLevel2: 'fm_level2',
    fmLevel3: 'fm_level3',
    fmLevel4: 'fm_level4',
    fmFeedback: 'fm_feedback',
    fmModAmount: 'fm_mod_amount',
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
                    if (this._ready) return; // Guard against double-init
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
        const mod = new WebAssembly.Module(wasmBytes);
        const importInfo = WebAssembly.Module.imports(mod);
        const bgImports = {};
        
        let instance; // captured securely

        for (const imp of importInfo) {
            if (imp.module === './daw_dsp_bg.js' || imp.module === './fermenter_bg.js') {
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
                        // Minimal emulation
                    };
                } else {
                    bgImports[imp.name] = function() {};
                }
            }
        }

        const imports = {
            './daw_dsp_bg.js': bgImports,
            './fermenter_bg.js': bgImports,
        };

        instance = new WebAssembly.Instance(mod, imports);
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
