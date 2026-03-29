/* tslint:disable */
/* eslint-disable */

/**
 * WASM-exported Levain instance for AudioWorklet.
 */
export class LevainInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get number of currently sounding voices.
     */
    active_voices(): number;
    /**
     * Add a sample to the pool. `data` is interleaved f32 PCM.
     * Returns the SampleId.
     */
    add_sample(data: Float32Array, frame_count: number, channels: number, sample_rate: number): number;
    /**
     * Add a zone to the zone map. Call build_zone_map() after all zones are added.
     */
    add_zone(zone_id: number, sample_id: number, articulation_id: number, root_note: number, lo_key: number, hi_key: number, lo_vel: number, hi_vel: number, rr_pos: number, rr_len: number, mic_id: number, is_release: boolean, loop_mode: number, loop_start: number, loop_end: number, loop_crossfade: number, gain_db: number, attack: number, decay: number, sustain: number, release: number): void;
    /**
     * Build the zone lookup table after all zones and samples are loaded.
     */
    build_zone_map(num_articulations: number, num_mics: number): void;
    /**
     * Get pointer to right channel buffer (call after process).
     */
    get_right_ptr(): number;
    /**
     * Process a MIDI CC event.
     */
    handle_cc(cc: number, value: number): void;
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
     * Process a block of audio. Returns pointer to left channel.
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
    readonly __wbg_levaininstance_free: (a: number, b: number) => void;
    readonly levaininstance_active_voices: (a: number) => number;
    readonly levaininstance_add_sample: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly levaininstance_add_zone: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number) => void;
    readonly levaininstance_build_zone_map: (a: number, b: number, c: number) => void;
    readonly levaininstance_get_right_ptr: (a: number) => number;
    readonly levaininstance_handle_cc: (a: number, b: number, c: number) => void;
    readonly levaininstance_new: (a: number, b: number) => number;
    readonly levaininstance_note_off: (a: number, b: number) => void;
    readonly levaininstance_note_on: (a: number, b: number, c: number) => void;
    readonly levaininstance_process: (a: number, b: number) => number;
    readonly levaininstance_set_param: (a: number, b: number, c: number, d: number) => void;
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
