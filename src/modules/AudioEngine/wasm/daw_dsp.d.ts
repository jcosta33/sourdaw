/** TypeScript declarations for daw_dsp.js (wasm-bindgen generated). */

export type InitSyncInput = BufferSource | WebAssembly.Module;

export type InitSyncModule = { module: InitSyncInput };

/** Returned by initSync — subset of WebAssembly exports used by processors. */
export type WasmExports = {
    memory: WebAssembly.Memory;
};

export declare function initSync(input: InitSyncInput | InitSyncModule): WasmExports;
export declare function default_init(
    module_or_path?:
        InitSyncInput | string | URL | Response | { module_or_path?: InitSyncInput | string | URL | Response }
): Promise<WasmExports>;

export declare class BacteriaInstance {
    constructor(sample_rate: number);
    free(): void;
    [Symbol.dispose](): void;
    add_macro_mapping(macro_index: number, target_param: number, min_value: number, max_value: number): void;
    add_mod_assignment(source_id: number, target_param: number, amount: number): void;
    get_band_levels_ptr(): number;
    get_input_db(): number;
    get_input_left_ptr(): number;
    get_input_right_ptr(): number;
    get_latency_samples(): number;
    get_output_db(): number;
    get_right_ptr(): number;
    process(block_size: number): number;
    set_param(name: string, value: number): void;
}

export declare class FermenterInstance {
    constructor(sample_rate: number, max_voices: number);
    free(): void;
    [Symbol.dispose](): void;
    active_voices(): number;
    get_right_ptr(): number;
    note_off(note: number): void;
    note_on(note: number, velocity: number): void;
    process(block_size: number): number;
    set_param(name: string, value: number): void;
}

export declare class GlutenInstance {
    constructor(sample_rate: number);
    free(): void;
    [Symbol.dispose](): void;
    get_crest(): number;
    get_gr_db(): number;
    get_input_db(): number;
    get_input_left_ptr(): number;
    get_input_right_ptr(): number;
    get_latency_samples(): number;
    get_output_db(): number;
    get_phase_corr(): number;
    get_right_ptr(): number;
    get_sc_left_ptr(): number;
    get_sc_right_ptr(): number;
    process(block_size: number): number;
    set_param(name: string, value: number): void;
}

export declare class GrandBouleInstance {
    constructor(sample_rate: number, voice_count: number);
    free(): void;
    [Symbol.dispose](): void;
    all_notes_off(): void;
    get_right_ptr(): number;
    load_attack_clip(key: number, samples: Float32Array): void;
    note_off(midi_note: number): void;
    note_on(midi_note: number, velocity: number): void;
    note_on_midi2(midi_note: number, velocity_16bit: number, pitch_offset_q24: number): void;
    process(block_size: number): number;
    set_param(name: string, value: number): void;
    set_sostenuto(engaged: boolean): void;
    set_sustain(position: number): void;
    set_temperament(index: number): void;
    set_una_corda(engaged: boolean): void;
}

export declare class GrinderInstance {
    constructor(sample_rate: number);
    free(): void;
    [Symbol.dispose](): void;
    get_automation_values_ptr(): number;
    get_gate_envelope_db(): number;
    get_gate_open(): number;
    get_input_db(): number;
    get_input_left_ptr(): number;
    get_input_right_ptr(): number;
    get_latency_samples(): number;
    get_neural_cpu_percent(): number;
    get_neural_warmup_progress(): number;
    get_output_db(): number;
    get_output_left_ptr(): number;
    get_power_amp_db(): number;
    get_preamp_db(): number;
    get_right_ptr(): number;
    get_sag_voltage(): number;
    process(block_size: number): number;
    process_automated(block_size: number): number;
    set_param(name: string, value: number): void;
}

export declare class KneadInstance {
    constructor(sample_rate: number);
    free(): void;
    [Symbol.dispose](): void;
    get_f0(): number;
    get_input_left_ptr(): number;
    get_input_right_ptr(): number;
    get_periodicity(): number;
    is_voiced(): boolean;
    process(frames: number): number;
}

export declare class LevainInstance {
    constructor(sample_rate: number, max_voices: number);
    free(): void;
    [Symbol.dispose](): void;
    active_voices(): number;
    add_sample(data: Float32Array, frame_count: number, channels: number, sample_rate: number): number;
    add_zone(
        zone_id: number,
        sample_id: number,
        articulation_id: number,
        root_note: number,
        lo_key: number,
        hi_key: number,
        lo_vel: number,
        hi_vel: number,
        rr_pos: number,
        rr_len: number,
        mic_id: number,
        is_release: boolean,
        loop_mode: number,
        loop_start: number,
        loop_end: number,
        loop_crossfade: number,
        gain_db: number,
        attack: number,
        decay: number,
        sustain: number,
        release: number
    ): void;
    all_notes_off(): void;
    build_zone_map(num_articulations: number, num_mics: number): void;
    clear_zones(): void;
    get_right_ptr(): number;
    handle_cc(cc: number, value: number): void;
    note_off(note: number): void;
    note_on(note: number, velocity: number): void;
    process(block_size: number): number;
    set_instrument(instrument_id: string): void;
    set_param(name: string, value: number): void;
}

export declare class ProofInstance {
    constructor(sample_rate: number);
    free(): void;
    [Symbol.dispose](): void;
    get_ab_gain_offset(): number;
    get_correlation(): number;
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
    get_tap_peak_l(tap_idx: number): number;
    get_tap_peak_r(tap_idx: number): number;
    get_true_peak_db(): number;
    process(block_size: number): number;
    reorder(m0: number, m1: number, m2: number, m3: number, m4: number): void;
    reset_integrated(): void;
    set_param(name: string, value: number): void;
}

export declare class ToasterInstance {
    constructor(sample_rate: number, num_pads: number);
    free(): void;
    [Symbol.dispose](): void;
    get_right_ptr(): number;
    note_off(pad: number): void;
    note_on(pad: number, velocity: number, midi_note: number): void;
    process(block_size: number): number;
    reset_pad_dry_routing(): void;
    set_pad_dry_routed(pad: number, routed: boolean): void;
    set_pad_param(pad: number, name: string, value: number): void;
    set_param(name: string, value: number): void;
}

export declare function analyze_pitch_wasm(samples: Float32Array, sample_rate: number): string;
export declare function commit_pitch_edit_wasm(
    samples: Float32Array,
    sample_rate: number,
    segments_json: string,
    contour_json: string
): Float32Array<ArrayBuffer>;
