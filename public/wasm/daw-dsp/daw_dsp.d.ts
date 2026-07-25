// @wasm-bindgen-dts crate-source: sha256:83b7631ac246867175a23c5faedf1f9f0425288c85aa9daee5faf8405dc0f3ff
/* tslint:disable */
/* eslint-disable */

/**
 * WASM-exported Bacteria instance for AudioWorklet.
 */
export class BacteriaInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add a macro mapping: macro `macro_index` (0-7) → `target_param`, remapped
     * from the macro's 0-1 range into `[min_value, max_value]`.
     */
    add_macro_mapping(macro_index: number, target_param: number, min_value: number, max_value: number): void;
    /**
     * Add a modulation assignment: `source_id` → `target_param` with scalar `amount`.
     *
     * Source IDs: 0=LFO1, 1=LFO2, 2=envelope follower, 3=Lorenz X, 4=Lorenz Z,
     * 5=step sequencer, 6-13=macros 0-7.
     *
     * Target param IDs: 0=global mix, 1-6=band 0-5 gain (linear offset).
     */
    add_mod_assignment(source_id: number, target_param: number, amount: number): void;
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
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
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
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
    /**
     * Get pointer to right channel buffer (call after process).
     */
    get_right_ptr(): number;
    constructor(sample_rate: number, max_voices: number);
    /**
     * Apply MPE per-note expression to the voices held on `channel` at `note`
     * (audit MD-2).
     *
     * `bend_semitones` is the member-channel pitch bend already resolved
     * against the controller's bend range; `pressure` is 0..1; `slide` is the
     * CC74 timbre as -1..1 with 0 neutral. Normalisation from wire units lives
     * on the TypeScript side so the live and scheduled paths share one
     * conversion.
     */
    note_expression(note: number, channel: number, bend_semitones: number, pressure: number, slide: number): void;
    /**
     * Process a MIDI note off event. Releases every voice at that pitch.
     */
    note_off(note: number): void;
    /**
     * Note-off narrowed to one MPE member channel, so releasing a note on one
     * member channel cannot silence a different note sounding the same pitch
     * on another (audit MD-2).
     */
    note_off_on_channel(note: number, channel: number): void;
    /**
     * Process a MIDI note on event.
     */
    note_on(note: number, velocity: number): void;
    /**
     * Process a MIDI note on carrying its MPE member channel.
     */
    note_on_with_channel(note: number, velocity: number, channel: number): void;
    /**
     * Process a block of 128 samples. Returns pointer to left channel.
     * Caller reads left + right from WASM memory.
     */
    process(block_size: number): number;
    /**
     * Set a named parameter value.
     */
    set_param(name: string, value: number): void;
    /**
     * Set a supported automation parameter without crossing the WASM string bridge.
     */
    set_param_by_id(param_id: number, value: number): void;
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
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
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
 * WASM-exported Grand Boule instance for AudioWorklet integration.
 */
export class GrandBouleInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Panic: silence every voice immediately.
     */
    all_notes_off(): void;
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
    /**
     * Pointer to the right channel buffer (call after `process`).
     */
    get_right_ptr(): number;
    /**
     * Load an attack-sample clip into the hybrid sampled-attack set.
     */
    load_attack_clip(key: number, samples: Float32Array): void;
    constructor(sample_rate: number, voice_count: number);
    /**
     * Apply MPE per-note expression to the voice held on `channel` at
     * `midi_note` (audit MD-2).
     *
     * Grand Boule sounds `bend_semitones` only: the ringing modal strings are
     * retuned in place. `pressure` and `slide` have no physical counterpart on
     * a struck string and are dropped — the expression registry advertises
     * pitch bend alone, so the editor never offers those lanes for this device.
     */
    note_expression(midi_note: number, channel: number, bend_semitones: number, pressure: number, slide: number): void;
    /**
     * Begin the release phase for any voice holding this note.
     */
    note_off(midi_note: number): void;
    /**
     * Note-off narrowed to one MPE member channel (audit MD-2).
     */
    note_off_on_channel(midi_note: number, channel: number): void;
    /**
     * Trigger a note. `midi_note` covers the full MIDI range; out-of-piano
     * notes are silently ignored.
     */
    note_on(midi_note: number, velocity: number): void;
    /**
     * Trigger a MIDI 2.0 note-on with 16-bit velocity and Q24 pitch offset.
     */
    note_on_midi2(midi_note: number, velocity_16bit: number, pitch_offset_q24: number): void;
    /**
     * Trigger a note carrying its MPE member channel.
     */
    note_on_with_channel(midi_note: number, velocity: number, channel: number): void;
    /**
     * Render a block of audio and return a pointer to the left channel.
     * The caller reads both channels from WASM memory.
     */
    process(block_size: number): number;
    /**
     * Set a global parameter (`master_gain`, `soundboard_send`,
     * `sympathetic_send`).
     */
    set_param(name: string, value: number): void;
    /**
     * Set the sostenuto pedal state.
     */
    set_sostenuto(engaged: boolean): void;
    /**
     * Set the sustain pedal position (0..1).
     */
    set_sustain(position: number): void;
    /**
     * Set the historical temperament (0 = Equal, 1 = Werckmeister III,
     * 2 = Kirnberger III, 3 = Vallotti, 4 = Young II, 5 = Meantone ¼-comma).
     */
    set_temperament(index: number): void;
    /**
     * Set the una-corda pedal state.
     */
    set_una_corda(engaged: boolean): void;
}

/**
 * WASM-exported Grinder instance for AudioWorklet.
 */
export class GrinderInstance {
    free(): void;
    [Symbol.dispose](): void;
    get_automation_values_ptr(): number;
    get_gate_envelope_db(): number;
    get_gate_open(): number;
    get_input_db(): number;
    get_input_left_ptr(): number;
    get_input_right_ptr(): number;
    get_latency_samples(): number;
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
    get_neural_cpu_percent(): number;
    get_neural_warmup_progress(): number;
    get_output_db(): number;
    get_output_left_ptr(): number;
    get_power_amp_db(): number;
    get_preamp_db(): number;
    get_right_ptr(): number;
    get_sag_voltage(): number;
    constructor(sample_rate: number);
    process(block_size: number): number;
    process_automated(block_size: number): number;
    set_param(name: string, value: number): void;
}

export class KneadInstance {
    free(): void;
    [Symbol.dispose](): void;
    get_f0(): number;
    get_input_left_ptr(): number;
    get_input_right_ptr(): number;
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
    get_periodicity(): number;
    /**
     * Right-channel output of the last `process` call (mirrors
     * `GlutenInstance::get_right_ptr`).
     */
    get_right_ptr(): number;
    is_voiced(): boolean;
    constructor(sample_rate: number);
    process(frames: number): number;
    /**
     * Set the real-time pitch shift in semitones. Without this export the
     * worklet's per-quantum `set_shift_semitones` call throws a TypeError
     * and the processor faults into permanent passthrough.
     */
    set_shift_semitones(semitones: number): void;
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
     * Silent all-notes-off. Releases every active voice without firing
     * per-note realism release transients. Used by the transport on stop
     * so we don't spawn a 128-note bow-lift noise burst.
     */
    all_notes_off(): void;
    /**
     * Build the zone lookup table after all zones and samples are loaded.
     */
    build_zone_map(num_articulations: number, num_mics: number): void;
    /**
     * Clear all loaded zones and samples from the engine.
     */
    clear_zones(): void;
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
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
     * Apply MPE per-note expression to the voices held on `channel` at `note`
     * (audit MD-2).
     *
     * `bend_semitones` is the member-channel pitch bend already resolved
     * against the controller's bend range; `pressure` is 0..1; `slide` is the
     * CC74 timbre as -1..1 with 0 neutral. Normalisation from wire units lives
     * on the TypeScript side so the live and scheduled paths share one
     * conversion.
     */
    note_expression(note: number, channel: number, bend_semitones: number, pressure: number, slide: number): void;
    /**
     * Process a MIDI note off event.
     */
    note_off(note: number): void;
    /**
     * Note-off narrowed to one MPE member channel, so releasing a note on one
     * member channel cannot silence a different note sounding the same pitch
     * on another (audit MD-2).
     */
    note_off_on_channel(note: number, channel: number): void;
    /**
     * Process a MIDI note on event.
     */
    note_on(note: number, velocity: number): void;
    /**
     * Process a MIDI note on carrying its MPE member channel.
     */
    note_on_with_channel(note: number, velocity: number, channel: number): void;
    /**
     * Process a block of audio. Returns pointer to left channel.
     * Caller reads left + right from WASM memory.
     */
    process(block_size: number): number;
    /**
     * Tell the engine which instrument id is now loaded (e.g. `violin-1`,
     * `cello`, `trumpet`). The realism layer uses this to pick its body
     * resonance modes, sympathetic strings, and breath/bow noise colour.
     */
    set_instrument(instrument_id: string): void;
    /**
     * Set a named parameter value.
     */
    set_param(name: string, value: number): void;
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
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
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
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Covers the main stereo pair and every pad output;
     * non-zero means a poisoned block was caught at the wasm output boundary.
     */
    get_nan_flush_count(): number;
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
     * Restore legacy parent-mix ownership for every pad.
     */
    reset_pad_dry_routing(): void;
    /**
     * Transfer or restore ownership of a pad's dry contribution to output 0.
     */
    set_pad_dry_routed(pad: number, routed: boolean): void;
    /**
     * Set a per-pad parameter (volume, pan, tune, filter_cutoff, etc.).
     */
    set_pad_param(pad: number, name: string, value: number): void;
    /**
     * Set a global parameter (master_gain, reverb_*, delay_*).
     */
    set_param(name: string, value: number): void;
    /**
     * Set an automatable global parameter without string marshaling.
     */
    set_param_by_id(param_id: number, value: number): void;
}

export function analyze_pitch_wasm(samples: Float32Array, sample_rate: number): string;

export function commit_pitch_edit_wasm(samples: Float32Array, sample_rate: number, segments_json: string, contour_json: string): Float32Array;

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
    readonly __wbg_bacteriainstance_free: (a: number, b: number) => void;
    readonly __wbg_grinderinstance_free: (a: number, b: number) => void;
    readonly bacteriainstance_add_macro_mapping: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly bacteriainstance_add_mod_assignment: (a: number, b: number, c: number, d: number) => void;
    readonly bacteriainstance_get_band_levels_ptr: (a: number) => number;
    readonly bacteriainstance_get_input_db: (a: number) => number;
    readonly bacteriainstance_get_input_left_ptr: (a: number) => number;
    readonly bacteriainstance_get_input_right_ptr: (a: number) => number;
    readonly bacteriainstance_get_latency_samples: (a: number) => number;
    readonly bacteriainstance_get_nan_flush_count: (a: number) => number;
    readonly bacteriainstance_get_output_db: (a: number) => number;
    readonly bacteriainstance_get_right_ptr: (a: number) => number;
    readonly bacteriainstance_new: (a: number) => number;
    readonly bacteriainstance_process: (a: number, b: number) => number;
    readonly bacteriainstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly grinderinstance_get_automation_values_ptr: (a: number) => number;
    readonly grinderinstance_get_gate_envelope_db: (a: number) => number;
    readonly grinderinstance_get_gate_open: (a: number) => number;
    readonly grinderinstance_get_input_db: (a: number) => number;
    readonly grinderinstance_get_input_left_ptr: (a: number) => number;
    readonly grinderinstance_get_input_right_ptr: (a: number) => number;
    readonly grinderinstance_get_latency_samples: (a: number) => number;
    readonly grinderinstance_get_nan_flush_count: (a: number) => number;
    readonly grinderinstance_get_neural_cpu_percent: (a: number) => number;
    readonly grinderinstance_get_neural_warmup_progress: (a: number) => number;
    readonly grinderinstance_get_output_db: (a: number) => number;
    readonly grinderinstance_get_output_left_ptr: (a: number) => number;
    readonly grinderinstance_get_power_amp_db: (a: number) => number;
    readonly grinderinstance_get_preamp_db: (a: number) => number;
    readonly grinderinstance_get_right_ptr: (a: number) => number;
    readonly grinderinstance_get_sag_voltage: (a: number) => number;
    readonly grinderinstance_new: (a: number) => number;
    readonly grinderinstance_process: (a: number, b: number) => number;
    readonly grinderinstance_process_automated: (a: number, b: number) => number;
    readonly grinderinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly analyze_pitch_wasm: (a: number, b: number, c: number) => [number, number];
    readonly commit_pitch_edit_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly init_panic_hook: () => void;
    readonly __wbg_grandbouleinstance_free: (a: number, b: number) => void;
    readonly __wbg_kneadinstance_free: (a: number, b: number) => void;
    readonly grandbouleinstance_all_notes_off: (a: number) => void;
    readonly grandbouleinstance_get_nan_flush_count: (a: number) => number;
    readonly grandbouleinstance_get_right_ptr: (a: number) => number;
    readonly grandbouleinstance_load_attack_clip: (a: number, b: number, c: number, d: number) => void;
    readonly grandbouleinstance_new: (a: number, b: number) => number;
    readonly grandbouleinstance_note_expression: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly grandbouleinstance_note_off: (a: number, b: number) => void;
    readonly grandbouleinstance_note_off_on_channel: (a: number, b: number, c: number) => void;
    readonly grandbouleinstance_note_on: (a: number, b: number, c: number) => void;
    readonly grandbouleinstance_note_on_midi2: (a: number, b: number, c: number, d: number) => void;
    readonly grandbouleinstance_note_on_with_channel: (a: number, b: number, c: number, d: number) => void;
    readonly grandbouleinstance_process: (a: number, b: number) => number;
    readonly grandbouleinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly grandbouleinstance_set_sostenuto: (a: number, b: number) => void;
    readonly grandbouleinstance_set_sustain: (a: number, b: number) => void;
    readonly grandbouleinstance_set_temperament: (a: number, b: number) => void;
    readonly grandbouleinstance_set_una_corda: (a: number, b: number) => void;
    readonly kneadinstance_get_f0: (a: number) => number;
    readonly kneadinstance_get_input_left_ptr: (a: number) => number;
    readonly kneadinstance_get_input_right_ptr: (a: number) => number;
    readonly kneadinstance_get_nan_flush_count: (a: number) => number;
    readonly kneadinstance_get_periodicity: (a: number) => number;
    readonly kneadinstance_get_right_ptr: (a: number) => number;
    readonly kneadinstance_is_voiced: (a: number) => number;
    readonly kneadinstance_new: (a: number) => number;
    readonly kneadinstance_process: (a: number, b: number) => number;
    readonly kneadinstance_set_shift_semitones: (a: number, b: number) => void;
    readonly __wbg_toasterinstance_free: (a: number, b: number) => void;
    readonly toasterinstance_get_nan_flush_count: (a: number) => number;
    readonly toasterinstance_get_right_ptr: (a: number) => number;
    readonly toasterinstance_new: (a: number, b: number) => number;
    readonly toasterinstance_note_off: (a: number, b: number) => void;
    readonly toasterinstance_note_on: (a: number, b: number, c: number, d: number) => void;
    readonly toasterinstance_process: (a: number, b: number) => number;
    readonly toasterinstance_reset_pad_dry_routing: (a: number) => void;
    readonly toasterinstance_set_pad_dry_routed: (a: number, b: number, c: number) => void;
    readonly toasterinstance_set_pad_param: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly toasterinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly toasterinstance_set_param_by_id: (a: number, b: number, c: number) => void;
    readonly __wbg_fermenterinstance_free: (a: number, b: number) => void;
    readonly __wbg_gluteninstance_free: (a: number, b: number) => void;
    readonly __wbg_levaininstance_free: (a: number, b: number) => void;
    readonly __wbg_proofinstance_free: (a: number, b: number) => void;
    readonly fermenterinstance_active_voices: (a: number) => number;
    readonly fermenterinstance_get_nan_flush_count: (a: number) => number;
    readonly fermenterinstance_get_right_ptr: (a: number) => number;
    readonly fermenterinstance_new: (a: number, b: number) => number;
    readonly fermenterinstance_note_expression: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly fermenterinstance_note_off: (a: number, b: number) => void;
    readonly fermenterinstance_note_off_on_channel: (a: number, b: number, c: number) => void;
    readonly fermenterinstance_note_on: (a: number, b: number, c: number) => void;
    readonly fermenterinstance_note_on_with_channel: (a: number, b: number, c: number, d: number) => void;
    readonly fermenterinstance_process: (a: number, b: number) => number;
    readonly fermenterinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly fermenterinstance_set_param_by_id: (a: number, b: number, c: number) => void;
    readonly gluteninstance_get_crest: (a: number) => number;
    readonly gluteninstance_get_gr_db: (a: number) => number;
    readonly gluteninstance_get_input_db: (a: number) => number;
    readonly gluteninstance_get_input_left_ptr: (a: number) => number;
    readonly gluteninstance_get_input_right_ptr: (a: number) => number;
    readonly gluteninstance_get_latency_samples: (a: number) => number;
    readonly gluteninstance_get_nan_flush_count: (a: number) => number;
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
    readonly levaininstance_all_notes_off: (a: number) => void;
    readonly levaininstance_build_zone_map: (a: number, b: number, c: number) => void;
    readonly levaininstance_clear_zones: (a: number) => void;
    readonly levaininstance_get_nan_flush_count: (a: number) => number;
    readonly levaininstance_get_right_ptr: (a: number) => number;
    readonly levaininstance_handle_cc: (a: number, b: number, c: number) => void;
    readonly levaininstance_new: (a: number, b: number) => number;
    readonly levaininstance_note_expression: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly levaininstance_note_off: (a: number, b: number) => void;
    readonly levaininstance_note_off_on_channel: (a: number, b: number, c: number) => void;
    readonly levaininstance_note_on: (a: number, b: number, c: number) => void;
    readonly levaininstance_note_on_with_channel: (a: number, b: number, c: number, d: number) => void;
    readonly levaininstance_process: (a: number, b: number) => number;
    readonly levaininstance_set_instrument: (a: number, b: number, c: number) => void;
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
    readonly proofinstance_get_nan_flush_count: (a: number) => number;
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
