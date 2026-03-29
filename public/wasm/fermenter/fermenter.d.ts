/* tslint:disable */
/* eslint-disable */

/**
 * WASM-exported Fermenter instance for AudioWorklet.
 */
export class FermenterInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get number of currently sounding voices.
     */
    active_voices(): number;
    /**
     * Get pointer to right channel buffer (call after process).
     */
    get_right_ptr(): number;
    constructor(sample_rate: number, max_voices: number);
    /**
     * Process a MIDI note off event.
     */
    note_off(note: number): void;
    /**
     * Process a MIDI note on event.
     */
    note_on(note: number, velocity: number): void;
    /**
     * Process a block of 128 samples. Returns pointer to left channel.
     * Caller reads left + right from WASM memory.
     */
    process(block_size: number): number;
    /**
     * Set a named parameter value.
     */
    set_param(name: string, value: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_fermenterinstance_free: (a: number, b: number) => void;
    readonly fermenterinstance_active_voices: (a: number) => number;
    readonly fermenterinstance_get_right_ptr: (a: number) => number;
    readonly fermenterinstance_new: (a: number, b: number) => number;
    readonly fermenterinstance_note_off: (a: number, b: number) => void;
    readonly fermenterinstance_note_on: (a: number, b: number, c: number) => void;
    readonly fermenterinstance_process: (a: number, b: number) => number;
    readonly fermenterinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
