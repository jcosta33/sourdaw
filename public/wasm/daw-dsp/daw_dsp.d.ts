/* tslint:disable */
/* eslint-disable */

/**
 * WASM-exported Bacteria instance for AudioWorklet.
 */
export class BacteriaInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get per-band levels packed as: [band0_db, band1_db, ... band5_db].
     */
    get_band_levels_ptr(): number;
    /**
     * Get current input level in dB (for metering).
     */
    get_input_db(): number;
    /**
     * Get pointer to input left buffer — caller writes input audio here.
     */
    get_input_left_ptr(): number;
    /**
     * Get pointer to input right buffer.
     */
    get_input_right_ptr(): number;
    /**
     * Get reported latency in samples.
     */
    get_latency_samples(): number;
    /**
     * Get current output level in dB (for metering).
     */
    get_output_db(): number;
    /**
     * Get pointer to output right buffer (call after process).
     */
    get_right_ptr(): number;
    constructor(sample_rate: number);
    /**
     * Process a block. Input must already be written to input buffers.
     * Returns pointer to output left buffer.
     */
    process(block_size: number): number;
    /**
     * Set a parameter by name.
     */
    set_param(name: string, value: number): void;
}

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

/**
 * WASM-exported Gluten instance for AudioWorklet.
 * Unlike instruments, this is an *effect* — it processes input audio.
 */
export class GlutenInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get crest factor (peak/RMS ratio in dB).
     */
    get_crest(): number;
    /**
     * Get current gain reduction in dB (for metering).
     */
    get_gr_db(): number;
    /**
     * Get current input level in dB (for metering).
     */
    get_input_db(): number;
    /**
     * Get pointer to input left buffer — caller writes input audio here.
     */
    get_input_left_ptr(): number;
    /**
     * Get pointer to input right buffer.
     */
    get_input_right_ptr(): number;
    /**
     * Get latency in samples (lookahead delay) for host compensation.
     */
    get_latency_samples(): number;
    /**
     * Get current output level in dB (for metering).
     */
    get_output_db(): number;
    /**
     * Get phase correlation (-1 to +1).
     */
    get_phase_corr(): number;
    /**
     * Get pointer to output right buffer (call after process).
     */
    get_right_ptr(): number;
    /**
     * Get pointer to external sidechain left buffer.
     */
    get_sc_left_ptr(): number;
    /**
     * Get pointer to external sidechain right buffer.
     */
    get_sc_right_ptr(): number;
    constructor(sample_rate: number);
    /**
     * Process a block. Input must already be written to input buffers.
     * Returns pointer to output left buffer.
     */
    process(block_size: number): number;
    /**
     * Set a parameter by name.
     */
    set_param(name: string, value: number): void;
}

/**
 * WASM-exported Grinder instance for AudioWorklet.
 */
export class GrinderInstance {
    free(): void;
    [Symbol.dispose](): void;
    get_input_db(): number;
    get_input_left_ptr(): number;
    get_input_right_ptr(): number;
    get_latency_samples(): number;
    get_output_db(): number;
    get_power_amp_db(): number;
    get_preamp_db(): number;
    get_right_ptr(): number;
    get_sag_voltage(): number;
    constructor(sample_rate: number);
    process(block_size: number): number;
    set_param(name: string, value: number): void;
}

export class KneadInstance {
    free(): void;
    [Symbol.dispose](): void;
    constructor(sample_rate: number);
    process(frames: number): number;
}

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
     * Clear all loaded zones and samples from the engine.
     */
    clear_zones(): void;
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

export class ProofChamberEngine {
    free(): void;
    [Symbol.dispose](): void;
    constructor(sample_rate: number);
    process_block(in_l: Float32Array, in_r: Float32Array, out_l: Float32Array, out_r: Float32Array): void;
    /**
     * Update internal Dattorro plate parameters smoothly
     */
    set_parameters(mix: number, pre_delay_ms: number, decay: number, bandwidth: number, damping: number, diffusion: number, excursion_samples: number): void;
    mix: number;
    pre_delay_ms: number;
}

/**
 * WASM-exported Proof mastering suite instance for AudioWorklet.
 */
export class ProofInstance {
    free(): void;
    [Symbol.dispose](): void;
    get_ab_gain_offset(): number;
    get_correlation(): number;
    /**
     * Get per-band dynamics gain reduction. Returns 4 values.
     */
    get_dynamics_gr(band: number): number;
    get_input_left_ptr(): number;
    get_input_lufs(): number;
    get_input_right_ptr(): number;
    get_integrated_lufs(): number;
    get_latency_samples(): number;
    get_limiter_gr_db(): number;
    get_lra(): number;
    get_module_order(): Uint8Array;
    get_output_lufs(): number;
    get_output_st_lufs(): number;
    get_right_ptr(): number;
    /**
     * Get inline meter tap data. tap_idx 0 = input, 1-5 = after each module.
     */
    get_tap_peak_l(tap_idx: number): number;
    get_tap_peak_r(tap_idx: number): number;
    get_true_peak_db(): number;
    constructor(sample_rate: number);
    /**
     * Process a block. Input must already be written to input buffers.
     */
    process(block_size: number): number;
    /**
     * Reorder the processing chain. Pass 5 module IDs (0=EQ, 1=Dyn, 2=Img, 3=Exc, 4=Lim).
     */
    reorder(m0: number, m1: number, m2: number, m3: number, m4: number): void;
    reset_integrated(): void;
    set_param(name: string, value: number): void;
}

/**
 * WASM-exported Toaster instance for AudioWorklet.
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
    readonly __wbg_gluteninstance_free: (a: number, b: number) => void;
    readonly __wbg_levaininstance_free: (a: number, b: number) => void;
    readonly __wbg_proofinstance_free: (a: number, b: number) => void;
    readonly gluteninstance_get_crest: (a: number) => number;
    readonly gluteninstance_get_gr_db: (a: number) => number;
    readonly gluteninstance_get_input_db: (a: number) => number;
    readonly gluteninstance_get_input_left_ptr: (a: number) => number;
    readonly gluteninstance_get_input_right_ptr: (a: number) => number;
    readonly gluteninstance_get_latency_samples: (a: number) => number;
    readonly gluteninstance_get_output_db: (a: number) => number;
    readonly gluteninstance_get_phase_corr: (a: number) => number;
    readonly gluteninstance_get_right_ptr: (a: number) => number;
    readonly gluteninstance_get_sc_left_ptr: (a: number) => number;
    readonly gluteninstance_get_sc_right_ptr: (a: number) => number;
    readonly gluteninstance_new: (a: number) => number;
    readonly gluteninstance_process: (a: number, b: number) => number;
    readonly gluteninstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly levaininstance_active_voices: (a: number) => number;
    readonly levaininstance_add_sample: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly levaininstance_add_zone: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number) => void;
    readonly levaininstance_build_zone_map: (a: number, b: number, c: number) => void;
    readonly levaininstance_clear_zones: (a: number) => void;
    readonly levaininstance_get_right_ptr: (a: number) => number;
    readonly levaininstance_handle_cc: (a: number, b: number, c: number) => void;
    readonly levaininstance_new: (a: number, b: number) => number;
    readonly levaininstance_note_off: (a: number, b: number) => void;
    readonly levaininstance_note_on: (a: number, b: number, c: number) => void;
    readonly levaininstance_process: (a: number, b: number) => number;
    readonly levaininstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly proofinstance_get_ab_gain_offset: (a: number) => number;
    readonly proofinstance_get_correlation: (a: number) => number;
    readonly proofinstance_get_dynamics_gr: (a: number, b: number) => number;
    readonly proofinstance_get_input_left_ptr: (a: number) => number;
    readonly proofinstance_get_input_lufs: (a: number) => number;
    readonly proofinstance_get_input_right_ptr: (a: number) => number;
    readonly proofinstance_get_integrated_lufs: (a: number) => number;
    readonly proofinstance_get_latency_samples: (a: number) => number;
    readonly proofinstance_get_limiter_gr_db: (a: number) => number;
    readonly proofinstance_get_lra: (a: number) => number;
    readonly proofinstance_get_module_order: (a: number) => [number, number];
    readonly proofinstance_get_output_lufs: (a: number) => number;
    readonly proofinstance_get_output_st_lufs: (a: number) => number;
    readonly proofinstance_get_right_ptr: (a: number) => number;
    readonly proofinstance_get_tap_peak_l: (a: number, b: number) => number;
    readonly proofinstance_get_tap_peak_r: (a: number, b: number) => number;
    readonly proofinstance_get_true_peak_db: (a: number) => number;
    readonly proofinstance_new: (a: number) => number;
    readonly proofinstance_process: (a: number, b: number) => number;
    readonly proofinstance_reorder: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly proofinstance_reset_integrated: (a: number) => void;
    readonly proofinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly __wbg_fermenterinstance_free: (a: number, b: number) => void;
    readonly __wbg_kneadinstance_free: (a: number, b: number) => void;
    readonly fermenterinstance_active_voices: (a: number) => number;
    readonly fermenterinstance_get_right_ptr: (a: number) => number;
    readonly fermenterinstance_new: (a: number, b: number) => number;
    readonly fermenterinstance_note_off: (a: number, b: number) => void;
    readonly fermenterinstance_note_on: (a: number, b: number, c: number) => void;
    readonly fermenterinstance_process: (a: number, b: number) => number;
    readonly fermenterinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly kneadinstance_new: (a: number) => number;
    readonly kneadinstance_process: (a: number, b: number) => number;
    readonly __wbg_get_proofchamberengine_mix: (a: number) => number;
    readonly __wbg_get_proofchamberengine_pre_delay_ms: (a: number) => number;
    readonly __wbg_proofchamberengine_free: (a: number, b: number) => void;
    readonly __wbg_set_proofchamberengine_mix: (a: number, b: number) => void;
    readonly __wbg_set_proofchamberengine_pre_delay_ms: (a: number, b: number) => void;
    readonly __wbg_toasterinstance_free: (a: number, b: number) => void;
    readonly proofchamberengine_new: (a: number) => number;
    readonly proofchamberengine_process_block: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any, i: number, j: number, k: any) => void;
    readonly proofchamberengine_set_parameters: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly toasterinstance_get_right_ptr: (a: number) => number;
    readonly toasterinstance_new: (a: number, b: number) => number;
    readonly toasterinstance_note_off: (a: number, b: number) => void;
    readonly toasterinstance_note_on: (a: number, b: number, c: number, d: number) => void;
    readonly toasterinstance_process: (a: number, b: number) => number;
    readonly toasterinstance_set_pad_param: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly toasterinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly __wbg_bacteriainstance_free: (a: number, b: number) => void;
    readonly bacteriainstance_get_band_levels_ptr: (a: number) => number;
    readonly bacteriainstance_get_input_db: (a: number) => number;
    readonly bacteriainstance_get_input_left_ptr: (a: number) => number;
    readonly bacteriainstance_get_input_right_ptr: (a: number) => number;
    readonly bacteriainstance_get_latency_samples: (a: number) => number;
    readonly bacteriainstance_get_output_db: (a: number) => number;
    readonly bacteriainstance_get_right_ptr: (a: number) => number;
    readonly bacteriainstance_new: (a: number) => number;
    readonly bacteriainstance_process: (a: number, b: number) => number;
    readonly bacteriainstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly __wbg_grinderinstance_free: (a: number, b: number) => void;
    readonly grinderinstance_get_input_db: (a: number) => number;
    readonly grinderinstance_get_input_left_ptr: (a: number) => number;
    readonly grinderinstance_get_input_right_ptr: (a: number) => number;
    readonly grinderinstance_get_latency_samples: (a: number) => number;
    readonly grinderinstance_get_output_db: (a: number) => number;
    readonly grinderinstance_get_power_amp_db: (a: number) => number;
    readonly grinderinstance_get_preamp_db: (a: number) => number;
    readonly grinderinstance_get_right_ptr: (a: number) => number;
    readonly grinderinstance_get_sag_voltage: (a: number) => number;
    readonly grinderinstance_new: (a: number) => number;
    readonly grinderinstance_process: (a: number, b: number) => number;
    readonly grinderinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
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
