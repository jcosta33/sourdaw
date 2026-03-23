/* tslint:disable */
/* eslint-disable */

export class WasmPluginInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Create a new plugin instance by type name.
     * Valid types: "eq", "compressor", "limiter", "reverb", "delay", "gate", "gain"
     */
    constructor(plugin_type: string, sample_rate: number);
    /**
     * Set a named parameter on the plugin.
     */
    set_param(name: string, value: number): void;
    /**
     * Set bypass state.
     */
    set_bypass(bypassed: boolean): void;
    /**
     * Process stereo audio. Returns pointer to left channel output.
     */
    process_stereo(left_in: Float32Array, right_in: Float32Array, frames: number): number;
    /**
     * Get pointer to right channel output (call after process_stereo).
     */
    get_right_ptr(): number;
    /**
     * Get the names of all parameters for this plugin type, as JSON array.
     */
    get_param_names(): string;
}

export class WasmAudioProcessor {
    free(): void;
    [Symbol.dispose](): void;
    constructor(sample_rate: number);
    /**
     * Process a block of frames and return the pointer so JS can read it.
     */
    process_and_get_ptr(frames: number): number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
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
