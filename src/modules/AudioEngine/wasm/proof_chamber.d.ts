// @wasm-bindgen-dts crate-source: sha256:1b369aa35aec6274e79f6a94e122c3dc57695176867509b11e6b60101d40e50c
/* tslint:disable */
/* eslint-disable */

export class ProofChamberInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Report plugin latency in samples for PDC (delay compensation).
     * The convolution wet path is aligned so every IR tap lands at its
     * absolute index plus HEAD_SIZE: tail-stage inputs are delayed to their
     * segment offsets, and the head/dry reference takes the remaining 128.
     */
    get_latency(): number;
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
    get_param_names(): string;
    get_right_ptr(): number;
    /**
     * Load an IR for the convolution engine.
     */
    load_ir(ir_data: Float32Array, channels: number): void;
    constructor(sample_rate: number);
    process(left_in: Float32Array, right_in: Float32Array, frames: number): number;
    set_param(name: string, value: number): void;
    set_param_by_id(param_id: number, value: number): void;
}

/**
 * Install `console_error_panic_hook` once at wasm module init so a Rust panic
 * surfaces a readable message on the JS console instead of an opaque
 * `unreachable` trap that silently poisons the AudioWorklet instance (WB-6).
 * Wasm-only by construction; the native build is unaffected.
 */
export function init_panic_hook(): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_proofchamberinstance_free: (a: number, b: number) => void;
    readonly init_panic_hook: () => void;
    readonly proofchamberinstance_get_latency: (a: number) => number;
    readonly proofchamberinstance_get_nan_flush_count: (a: number) => number;
    readonly proofchamberinstance_get_param_names: (a: number) => [number, number];
    readonly proofchamberinstance_get_right_ptr: (a: number) => number;
    readonly proofchamberinstance_load_ir: (a: number, b: number, c: number, d: number) => void;
    readonly proofchamberinstance_new: (a: number) => number;
    readonly proofchamberinstance_process: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly proofchamberinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly proofchamberinstance_set_param_by_id: (a: number, b: number, c: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
