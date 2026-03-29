/* tslint:disable */
/* eslint-disable */

/**
 * WASM-exported Grinder instance for AudioWorklet.
 */
export class ToasterInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get pointer to right channel buffer (call after process).
     */
    get_right_ptr(): number;
    constructor(sample_rate: number, num_pads: number);
    /**
     * Release a pad (for sustained sounds like open hi-hat).
     */
    note_off(pad: number): void;
    /**
     * Trigger a drum pad. `midi_note` controls pitch (60 = default/center pitch).
     */
    note_on(pad: number, velocity: number, midi_note: number): void;
    /**
     * Process a block of audio. Returns pointer to left channel buffer.
     * Caller reads left + right from WASM memory.
     */
    process(block_size: number): number;
    /**
     * Set a per-pad parameter (volume, pan, tune, filter_cutoff, etc.).
     */
    set_pad_param(pad: number, name: string, value: number): void;
    /**
     * Set a global parameter (master_gain, reverb_*, delay_*).
     */
    set_param(name: string, value: number): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_toasterinstance_free: (a: number, b: number) => void;
    readonly toasterinstance_get_right_ptr: (a: number) => number;
    readonly toasterinstance_new: (a: number, b: number) => number;
    readonly toasterinstance_note_off: (a: number, b: number) => void;
    readonly toasterinstance_note_on: (a: number, b: number, c: number, d: number) => void;
    readonly toasterinstance_process: (a: number, b: number) => number;
    readonly toasterinstance_set_pad_param: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly toasterinstance_set_param: (a: number, b: number, c: number, d: number) => void;
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
