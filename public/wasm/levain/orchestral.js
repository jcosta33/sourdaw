/* @ts-self-types="./orchestral.d.ts" */

/**
 * WASM-exported Orchestral instance for AudioWorklet.
 */
export class OrchestraInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OrchestraInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_orchestrainstance_free(ptr, 0);
    }
    /**
     * Get number of currently sounding voices.
     * @returns {number}
     */
    active_voices() {
        const ret = wasm.orchestrainstance_active_voices(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Add a sample to the pool. `data` is interleaved f32 PCM.
     * Returns the SampleId.
     * @param {Float32Array} data
     * @param {number} frame_count
     * @param {number} channels
     * @param {number} sample_rate
     * @returns {number}
     */
    add_sample(data, frame_count, channels, sample_rate) {
        const ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.orchestrainstance_add_sample(this.__wbg_ptr, ptr0, len0, frame_count, channels, sample_rate);
        return ret >>> 0;
    }
    /**
     * Add a zone to the zone map. Call build_zone_map() after all zones are added.
     * @param {number} zone_id
     * @param {number} sample_id
     * @param {number} articulation_id
     * @param {number} root_note
     * @param {number} lo_key
     * @param {number} hi_key
     * @param {number} lo_vel
     * @param {number} hi_vel
     * @param {number} rr_pos
     * @param {number} rr_len
     * @param {number} mic_id
     * @param {boolean} is_release
     * @param {number} loop_mode
     * @param {number} loop_start
     * @param {number} loop_end
     * @param {number} loop_crossfade
     * @param {number} gain_db
     * @param {number} attack
     * @param {number} decay
     * @param {number} sustain
     * @param {number} release
     */
    add_zone(zone_id, sample_id, articulation_id, root_note, lo_key, hi_key, lo_vel, hi_vel, rr_pos, rr_len, mic_id, is_release, loop_mode, loop_start, loop_end, loop_crossfade, gain_db, attack, decay, sustain, release) {
        wasm.orchestrainstance_add_zone(this.__wbg_ptr, zone_id, sample_id, articulation_id, root_note, lo_key, hi_key, lo_vel, hi_vel, rr_pos, rr_len, mic_id, is_release, loop_mode, loop_start, loop_end, loop_crossfade, gain_db, attack, decay, sustain, release);
    }
    /**
     * Build the zone lookup table after all zones and samples are loaded.
     * @param {number} num_articulations
     * @param {number} num_mics
     */
    build_zone_map(num_articulations, num_mics) {
        wasm.orchestrainstance_build_zone_map(this.__wbg_ptr, num_articulations, num_mics);
    }
    /**
     * Get pointer to right channel buffer (call after process).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.orchestrainstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Process a MIDI CC event.
     * @param {number} cc
     * @param {number} value
     */
    handle_cc(cc, value) {
        wasm.orchestrainstance_handle_cc(this.__wbg_ptr, cc, value);
    }
    /**
     * @param {number} sample_rate
     * @param {number} max_voices
     */
    constructor(sample_rate, max_voices) {
        const ret = wasm.orchestrainstance_new(sample_rate, max_voices);
        this.__wbg_ptr = ret >>> 0;
        OrchestraInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Process a MIDI note off event.
     * @param {number} note
     */
    note_off(note) {
        wasm.orchestrainstance_note_off(this.__wbg_ptr, note);
    }
    /**
     * Process a MIDI note on event.
     * @param {number} note
     * @param {number} velocity
     */
    note_on(note, velocity) {
        wasm.orchestrainstance_note_on(this.__wbg_ptr, note, velocity);
    }
    /**
     * Process a block of audio. Returns pointer to left channel.
     * Caller reads left + right from WASM memory.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.orchestrainstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Set a named parameter value.
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.orchestrainstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) OrchestraInstance.prototype[Symbol.dispose] = OrchestraInstance.prototype.free;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_6ddd609b62940d55: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./orchestral_bg.js": import0,
    };
}

const OrchestraInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_orchestrainstance_free(ptr >>> 0, 1));

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasm;
function __wbg_finalize_init(instance, module) {
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('orchestral_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
