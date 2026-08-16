// @wasm-bindgen-dts crate-source: sha256:2fe2c58ee9070732ec8d79ca7605f31d9303a1e3bbe65344528ae8585405dfd8
/* tslint:disable */
/* eslint-disable */

export class ScoringInstance {
    free(): void;
    [Symbol.dispose](): void;
    get_cents(): number;
    get_confidence(): number;
    get_frequency(): number;
    get_midi_note(): number;
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
    get_note_index(): number;
    get_octave(): number;
    get_poly_string_cents(idx: number): number;
    get_poly_string_confidence(idx: number): number;
    get_poly_string_count(): number;
    get_right_ptr(): number;
    /**
     * Import a Scala .scl file and apply as tuning offsets.
     */
    import_scala(scl_text: string): void;
    /**
     * Import an AnaMark .tun file and apply as tuning offsets.
     */
    import_tun(tun_text: string): void;
    is_active(): boolean;
    is_poly_string_active(idx: number): boolean;
    constructor(sample_rate: number);
    process(left_in: Float32Array, right_in: Float32Array, frames: number): number;
    set_param(name: string, value: number): void;
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
    readonly __wbg_scoringinstance_free: (a: number, b: number) => void;
    readonly init_panic_hook: () => void;
    readonly scoringinstance_get_cents: (a: number) => number;
    readonly scoringinstance_get_confidence: (a: number) => number;
    readonly scoringinstance_get_frequency: (a: number) => number;
    readonly scoringinstance_get_midi_note: (a: number) => number;
    readonly scoringinstance_get_nan_flush_count: (a: number) => number;
    readonly scoringinstance_get_note_index: (a: number) => number;
    readonly scoringinstance_get_octave: (a: number) => number;
    readonly scoringinstance_get_poly_string_cents: (a: number, b: number) => number;
    readonly scoringinstance_get_poly_string_confidence: (a: number, b: number) => number;
    readonly scoringinstance_get_poly_string_count: (a: number) => number;
    readonly scoringinstance_get_right_ptr: (a: number) => number;
    readonly scoringinstance_import_scala: (a: number, b: number, c: number) => void;
    readonly scoringinstance_import_tun: (a: number, b: number, c: number) => void;
    readonly scoringinstance_is_active: (a: number) => number;
    readonly scoringinstance_is_poly_string_active: (a: number, b: number) => number;
    readonly scoringinstance_new: (a: number) => number;
    readonly scoringinstance_process: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly scoringinstance_set_param: (a: number, b: number, c: number, d: number) => void;
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
