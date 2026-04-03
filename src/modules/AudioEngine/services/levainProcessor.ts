// @ts-nocheck
/**
 * AudioWorkletProcessor for the Levain suite engine.
 *
 * Calls the raw wasm-bindgen WASM exports directly — no glue JS, no TextDecoder,
 * no eval. Works in AudioWorklet scope on all browsers including Safari/WKWebView.
 *
 * Messages from main thread:
 *   { type: 'init', wasmBytes: ArrayBuffer }
 *   { type: 'noteOn', note, velocity }
 *   { type: 'noteOff', note }
 *   { type: 'param', name, value }
 *   { type: 'cc', cc, value }
 *   { type: 'bypass', bypassed }
 *   { type: 'loadSample', sampleId, data, frameCount, channels, sampleRate }
 */

/**
 * Map TypeScript camelCase param names to Rust snake_case names
 * used by OrchestraEngine::set_param.
 */
const PARAM_MAP = {
    masterGain: 'master_gain',
    humanize: 'humanize',
    legatoEnabled: 'legato_enabled',
    vibratoDepth: 'vibrato_depth',
    autoDivisi: 'auto_divisi',
    autoDivisiSize: 'auto_divisi_size',
    autoArticulation: 'auto_articulation',
    ensembleTiming: 'ensemble_timing',
    attackSpread: 'attack_spread',
    pitchConvergence: 'pitch_convergence',
};

class LevainProcessor extends AudioWorkletProcessor {
    _wasm = null;      // WASM exports
    _mem = null;       // WebAssembly.Memory
    _ptr = 0;          // OrchestraInstance pointer
    _ready = false;
    _bypassed = false;
    _pendingMessages = [];

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) return;
                    this._initWasm(msg.wasmBytes);
                } else if (!this._ready) {
                    this._pendingMessages.push(msg);
                } else {
                    this._handleMessage(msg);
                }
            } catch (err) {
                console.error('LevainProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _handleMessage(msg) {
        switch (msg.type) {
            case 'noteOn': {
                this._wasm.levaininstance_note_on(this._ptr, msg.note, msg.velocity);
                const voices = this._wasm.levaininstance_active_voices(this._ptr);
                console.log(`[Orchestra] noteOn ${msg.note} vel=${msg.velocity} → ${voices} active voices`);
                break;
            }
            case 'noteOff':
                this._wasm.levaininstance_note_off(this._ptr, msg.note);
                break;
            case 'param': {
                const rustName = PARAM_MAP[msg.name] ?? msg.name;
                this._setParam(rustName, msg.value);
                break;
            }
            case 'cc':
                this._wasm.levaininstance_handle_cc(this._ptr, msg.cc, msg.value);
                break;
            case 'bypass':
                this._bypassed = msg.bypassed;
                break;
            case 'addSample':
                this._addSample(msg);
                console.log(`[Orchestra] addSample id=${msg.sampleId} frames=${msg.frameCount} ch=${msg.channels}`);
                break;
            case 'addZone':
                this._addZone(msg);
                console.log(`[Orchestra] addZone id=${msg.zoneId} sample=${msg.sampleId} root=${msg.rootNote} keys=${msg.loKey}-${msg.hiKey}`);
                break;
            case 'buildZoneMap':
                this._wasm.levaininstance_build_zone_map(
                    this._ptr, msg.numArticulations, msg.numMics
                );
                console.log(`[Orchestra] buildZoneMap arts=${msg.numArticulations} mics=${msg.numMics}`);
                break;
            case 'clearZones':
                this._wasm.levaininstance_clear_zones(this._ptr);
                console.log(`[Orchestra] clearZones`);
                break;
        }
    }

    _addSample(msg) {
        const w = this._wasm;
        const data = msg.data; // Float32Array
        const len = data.length;
        // Allocate WASM memory and copy sample data.
        const byteLen = len * 4;
        const ptr = w.__wbindgen_malloc(byteLen, 4) >>> 0;
        const wasmView = new Float32Array(w.memory.buffer, ptr, len);
        wasmView.set(data);
        w.levaininstance_add_sample(
            this._ptr, ptr, len, msg.frameCount, msg.channels, msg.sampleRate
        );
    }

    _addZone(msg) {
        const w = this._wasm;
        const loopMode = msg.loopMode === 'forward' ? 1 : msg.loopMode === 'pingpong' ? 2 : 0;
        w.levaininstance_add_zone(
            this._ptr,
            msg.zoneId,
            msg.sampleId,
            msg.articulationId,
            msg.rootNote,
            msg.loKey,
            msg.hiKey,
            msg.loVel,
            msg.hiVel,
            msg.rrPos,
            msg.rrLen,
            msg.micId,
            msg.isRelease ? 1 : 0,
            loopMode,
            msg.loopStart,
            msg.loopEnd,
            msg.loopCrossfade,
            msg.gainDb,
            msg.attack,
            msg.decay,
            msg.sustain,
            msg.release
        );
    }

    _initWasm(wasmBytes) {
        const mod = new WebAssembly.Module(wasmBytes);
        const importInfo = WebAssembly.Module.imports(mod);
        const bgImports = {};
        
        let instance; // captured securely

        for (const imp of importInfo) {
            if (imp.module === './daw_dsp_bg.js' || imp.module === './levain_bg.js') {
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
            './levain_bg.js': bgImports,
        };

        instance = new WebAssembly.Instance(mod, imports);
        const w = instance.exports;

        // Run wasm-bindgen init
        if (w.__wbindgen_start) {
            w.__wbindgen_start();
        }

        this._wasm = w;
        this._mem = w.memory;

        // Create levain engine: 64 voices at worklet sample rate
        this._ptr = w.levaininstance_new(sampleRate, 64) >>> 0;
        this._ready = true;

        // Flush pending messages
        for (const msg of this._pendingMessages) {
            this._handleMessage(msg);
        }
        this._pendingMessages = [];

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
        w.levaininstance_set_param(this._ptr, strPtr, len, value);
        w.__wbindgen_free(strPtr, len, 1);
    }

    process(_inputs, outputs) {
        if (!this._ready || this._bypassed) return true;

        const output = outputs[0];
        if (!output || output.length < 2) return true;

        const frames = output[0].length;
        const processFrames = Math.min(frames, 4096);
        const w = this._wasm;

        // Run DSP — returns pointer to left channel buffer
        const leftPtr = w.levaininstance_process(this._ptr, processFrames) >>> 0;
        const rightPtr = w.levaininstance_get_right_ptr(this._ptr) >>> 0;

        // Read from WASM linear memory into output
        const mem = w.memory.buffer;
        output[0].set(new Float32Array(mem, leftPtr, processFrames));
        if (output[1]) {
            output[1].set(new Float32Array(mem, rightPtr, processFrames));
        }

        return true;
    }
}

registerProcessor('levain-processor', LevainProcessor);
