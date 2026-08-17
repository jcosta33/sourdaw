// @wasm-bindgen-dts crate-source: sha256:3c536560d8ce2b2c68cf2f67843edef245113c3464d30093028c36df6b0d48be
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
     * Import a Scala .scl file and apply it as tuning offsets. Returns whether
     * the file was applied: a malformed scale, or one that is not 12 degrees,
     * changes nothing. The offsets table is one entry per 12-TET pitch class,
     * so a scale of any other size cannot be represented and is refused rather
     * than truncated into a different tuning.
     */
    import_scala(scl_text: string): boolean;
    /**
     * Import an AnaMark .tun file and apply it as tuning offsets. Returns
     * whether the file was applied. A file that declares no `BaseFreq` leaves
     * the current concert-A reference alone — silence about the reference is
     * not a request to reset it to 440.
     *
     * `BaseFreq` is the frequency of MIDI note 0, not concert A: the default
     * is 8.1757989156 Hz, which is A440. It is converted, not clamped. Running
     * it through `set_param` would fold every out-of-range value into
     * 400..=490 and silently retune a 415 or 432 session while reporting
     * success, so a converted reference outside that range fails the whole
     * import and nothing is applied — a declared-but-unusable reference is
     * corruption, not absence.
     */
    import_tun(tun_text: string): boolean;
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
    readonly scoringinstance_import_scala: (a: number, b: number, c: number) => number;
    readonly scoringinstance_import_tun: (a: number, b: number, c: number) => number;
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
