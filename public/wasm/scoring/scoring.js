/* @ts-self-types="./scoring.d.ts" */

export class ScoringInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ScoringInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_scoringinstance_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get_cents() {
        const ret = wasm.scoringinstance_get_cents(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_confidence() {
        const ret = wasm.scoringinstance_get_confidence(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_frequency() {
        const ret = wasm.scoringinstance_get_frequency(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_midi_note() {
        const ret = wasm.scoringinstance_get_midi_note(this.__wbg_ptr);
        return ret;
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.scoringinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_note_index() {
        const ret = wasm.scoringinstance_get_note_index(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_octave() {
        const ret = wasm.scoringinstance_get_octave(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} idx
     * @returns {number}
     */
    get_poly_string_cents(idx) {
        const ret = wasm.scoringinstance_get_poly_string_cents(this.__wbg_ptr, idx);
        return ret;
    }
    /**
     * @param {number} idx
     * @returns {number}
     */
    get_poly_string_confidence(idx) {
        const ret = wasm.scoringinstance_get_poly_string_confidence(this.__wbg_ptr, idx);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_poly_string_count() {
        const ret = wasm.scoringinstance_get_poly_string_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.scoringinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Import a Scala .scl file and apply it as tuning offsets. Returns whether
     * the file was applied: a malformed scale, or one that is not 12 degrees,
     * changes nothing. The offsets table is one entry per 12-TET pitch class,
     * so a scale of any other size cannot be represented and is refused rather
     * than truncated into a different tuning.
     * @param {string} scl_text
     * @returns {boolean}
     */
    import_scala(scl_text) {
        const ptr0 = passStringToWasm0(scl_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.scoringinstance_import_scala(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Import an AnaMark .tun file and apply it as tuning offsets. Returns
     * whether the file was applied. A file that declares no `BaseFreq` leaves
     * the current concert-A reference alone — silence about the reference is
     * not a request to reset it to 440. A declared reference goes through
     * `set_param` so it lands inside the same range the reference knob
     * enforces.
     * @param {string} tun_text
     * @returns {boolean}
     */
    import_tun(tun_text) {
        const ptr0 = passStringToWasm0(tun_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.scoringinstance_import_tun(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    is_active() {
        const ret = wasm.scoringinstance_is_active(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} idx
     * @returns {boolean}
     */
    is_poly_string_active(idx) {
        const ret = wasm.scoringinstance_is_poly_string_active(this.__wbg_ptr, idx);
        return ret !== 0;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.scoringinstance_new(sample_rate);
        this.__wbg_ptr = ret;
        ScoringInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {Float32Array} left_in
     * @param {Float32Array} right_in
     * @param {number} frames
     * @returns {number}
     */
    process(left_in, right_in, frames) {
        const ptr0 = passArrayF32ToWasm0(left_in, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayF32ToWasm0(right_in, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.scoringinstance_process(this.__wbg_ptr, ptr0, len0, ptr1, len1, frames);
        return ret >>> 0;
    }
    /**
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.scoringinstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) ScoringInstance.prototype[Symbol.dispose] = ScoringInstance.prototype.free;

/**
 * Install `console_error_panic_hook` once at wasm module init so a Rust panic
 * surfaces a readable message on the JS console instead of an opaque
 * `unreachable` trap that silently poisons the AudioWorklet instance (WB-6).
 * Wasm-only by construction; the native build is unaffected.
 */
export function init_panic_hook() {
    wasm.init_panic_hook();
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
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
        "./scoring_bg.js": import0,
    };
}

const ScoringInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_scoringinstance_free(ptr, 1));

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
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

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
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
        module_or_path = new URL('scoring_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
