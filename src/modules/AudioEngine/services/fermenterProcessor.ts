// @ts-nocheck
/**
 * AudioWorkletProcessor for the Fermenter synthesizer.
 *
 * Uses the generated wasm-bindgen JS bindings (daw_dsp.js) via initSync so all
 * WASM memory management is handled by the generated glue — no manual malloc/free.
 *
 * Messages from main thread:
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'noteOn', note, velocity, sampleFrame? }
 *   { type: 'noteOff', note, sampleFrame? }
 *   { type: 'param', name, value }
 */

import '../wasm/workletPolyfill.js';
import { initSync, FermenterInstance } from '../wasm/daw_dsp.js';

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
    _instance = null; // FermenterInstance (generated wasm-bindgen class)
    _memory = null; // WebAssembly.Memory (for direct buffer access in process())
    _ready = false;
    _faulted = false;
    _queue = []; // Sorted by sampleFrame (integer sample count)

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) {return;}
                    this._initWasm(msg.wasmBytes);
                } else if (this._ready && !this._faulted) {
                    this._handleMessage(msg);
                }
            } catch (err) {
                console.error('FermenterProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const wasmExports = initSync({ module: new WebAssembly.Module(wasmBytes) });
        this._memory = wasmExports.memory;
        this._instance = new FermenterInstance(sampleRate, 32);
        this._ready = true;
        this.port.postMessage({ type: 'ready' });
    }

    _enqueue(msg) {
        let lo = 0,
            hi = this._queue.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this._queue[mid].sampleFrame <= msg.sampleFrame) {lo = mid + 1;}
            else {hi = mid;}
        }
        this._queue.splice(lo, 0, msg);
    }

    _handleMessage(msg) {
        if (msg.sampleFrame !== undefined) {
            if (msg.sampleFrame > currentFrame) {
                this._enqueue(msg);
                return;
            }
        }
        this._dispatch(msg);
    }

    _dispatch(msg) {
        const inst = this._instance;
        switch (msg.type) {
            case 'noteOn':
                inst.note_on(msg.note, msg.velocity);
                break;
            case 'noteOff':
                inst.note_off(msg.note);
                break;
            case 'param': {
                const rustName = PARAM_MAP[msg.name] ?? msg.name;
                inst.set_param(rustName, msg.value);
                break;
            }
        }
    }

    _drainQueue(blockEndFrame) {
        // Audio-thread: drain with index + single splice instead of per-element shift() (O(n²))
        let drained = 0;
        while (drained < this._queue.length && this._queue[drained].sampleFrame <= blockEndFrame) {
            this._dispatch(this._queue[drained]);
            drained++;
        }
        if (drained > 0) {this._queue.splice(0, drained);}
    }

    process(_inputs, outputs) {
        if (!this._ready || this._faulted) {return true;}

        const output = outputs[0];
        if (!output || output.length < 2) {return true;}

        const frames = output[0].length;

        const blockEndFrame = currentFrame + frames;
        this._drainQueue(blockEndFrame);

        try {
            const leftPtr = this._instance.process(frames);
            const rightPtr = this._instance.get_right_ptr();

            const mem = this._memory.buffer;
            output[0].set(new Float32Array(mem, leftPtr, frames));
            if (output[1]) {
                output[1].set(new Float32Array(mem, rightPtr, frames));
            }
        } catch (err) {
            this._faulted = true;
            this.port.postMessage({ type: 'error', message: String(err) });
        }

        return true;
    }
}

registerProcessor('fermenter-processor', FermenterProcessor);
