// @ts-nocheck
/**
 * AudioWorkletProcessor for Proof Chamber reverb.
 * Stereo in → stereo out effect processor.
 */

class ProofChamberProcessor extends AudioWorkletProcessor {
    _wasm = null;
    _mem = null;
    _ptr = 0;
    _ready = false;
    _bypassed = false;

    constructor() {
        super();
        this.port.onmessage = (e) => {
            const msg = e.data;
            try {
                if (msg.type === 'init') {
                    if (this._ready) return;
                    this._initWasm(msg.wasmBytes);
                } else if (msg.type === 'param' && this._ready) {
                    this._setParam(msg.name, msg.value);
                } else if (msg.type === 'bypass') {
                    this._bypassed = msg.bypassed;
                }
            } catch (err) {
                console.error('ProofChamberProcessor error:', err);
                if (!this._ready) {
                    this.port.postMessage({ type: 'error', message: err?.message ?? String(err) });
                }
            }
        };
    }

    _initWasm(wasmBytes) {
        const mod = new WebAssembly.Module(wasmBytes);
        const importInfo = WebAssembly.Module.imports(mod);
        const bgImports = {};
        
        let instance;

        for (const imp of importInfo) {
            if (imp.module === './proof_chamber_bg.js') {
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
                    bgImports[imp.name] = function() {};
                } else {
                    bgImports[imp.name] = function() {};
                }
            }
        }

        const imports = {
            './proof_chamber_bg.js': bgImports,
        };

        instance = new WebAssembly.Instance(mod, imports);
        const w = instance.exports;

        if (w.__wbindgen_start) {
            w.__wbindgen_start();
        }

        this._wasm = w;
        this._mem = w.memory;
        this._ptr = w.proofchamberinstance_new(sampleRate) >>> 0;
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
        w.proofchamberinstance_set_param(this._ptr, strPtr, len, value);
    }

    process(inputs, outputs) {
        if (!this._ready || this._bypassed) {
            // Pass through
            const input = inputs[0];
            const output = outputs[0];
            if (input && output) {
                for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
                    if (input[ch] && output[ch]) {
                        output[ch].set(input[ch]);
                    }
                }
            }
            return true;
        }

        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output || input.length < 2 || output.length < 2) return true;

        const frames = input[0].length;
        const w = this._wasm;

        // Copy input to WASM memory
        const inByteLen = frames * 4;
        const leftInPtr = w.__wbindgen_malloc(inByteLen, 4) >>> 0;
        const rightInPtr = w.__wbindgen_malloc(inByteLen, 4) >>> 0;

        new Float32Array(w.memory.buffer, leftInPtr, frames).set(input[0]);
        new Float32Array(w.memory.buffer, rightInPtr, frames).set(input[1]);

        // Process
        // Args: (self_ptr, left_ptr, left_len, right_ptr, right_len, frames)
        const leftOutPtr = w.proofchamberinstance_process(this._ptr, leftInPtr, frames, rightInPtr, frames, frames) >>> 0;
        // Note: left_len === right_len === frames since both are f32 arrays of `frames` elements
        const rightOutPtr = w.proofchamberinstance_get_right_ptr(this._ptr) >>> 0;

        // Copy output
        const mem = w.memory.buffer;
        output[0].set(new Float32Array(mem, leftOutPtr, frames));
        output[1].set(new Float32Array(mem, rightOutPtr, frames));

        return true;
    }
}

registerProcessor('proof-chamber-processor', ProofChamberProcessor);
