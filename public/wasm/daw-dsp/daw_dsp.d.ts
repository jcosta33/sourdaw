// @wasm-bindgen-dts crate-source: sha256:37b94ed179f2441f375bb42a7e3aa0c4a0f0803b87fddda6425aa70c7829c6a7
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
 * WASM-exported Crumbs instance for AudioWorklet rendering.
 *
 * Crumbs' native host reaches `CrumbsEngine` over an SPSC command ring from
 * the native command layer. A worklet has no such ring — messages already
 * arrive one at a time on the port — so this wrapper calls `handle_command`
 * directly, which is the same entry point the native host's drain loop calls.
 *
 * ## Disk streaming is deliberately absent
 *
 * `crumbs::streaming` schedules reads the native integration layer performs;
 * an `AudioWorkletGlobalScope` has no file or network API at all, so nothing
 * inside a worklet could service those reads. For rendering that costs
 * nothing: an `OfflineAudioContext` has no realtime deadline to stream
 * against, so the correct answer is a preloaded in-memory pool, which is
 * exactly what `add_sample` builds. Sample sets larger than the worklet's heap
 * are the limit of this build, not a bug in it.
 */
export class CrumbsInstance {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Voices sounding as of the last rendered block, counting stolen notes
     * that are still running their de-click fade. Can exceed the 128-slot
     * pool; see `CrumbsEngine::read_active_voice_count`.
     */
    active_voices(): number;
    /**
     * Copy interleaved PCM into the in-memory pool and return its sample id.
     *
     * Mirrors `LevainInstance::add_sample`: the caller transfers a
     * `Float32Array` across the worklet port because a wasm instance cannot
     * read a file. De-interleaving it into per-channel storage allocates, so
     * call this during setup, never from `process`. Filing the finished
     * `Arc` in the pool — which is what `CrumbsCommand::AddSample` does on the
     * audio thread — allocates nothing.
     */
    add_sample(data: Float32Array, channels: number, sample_rate: number): number;
    /**
     * Release all held voices into their amp-envelope release stage.
     */
    all_notes_off(): void;
    /**
     * Cut every voice immediately with a short de-click fade.
     */
    all_sound_off(): void;
    /**
     * Non-finite output samples scrubbed to silence since construction.
     * Non-zero means a poisoned block was caught at the wasm boundary.
     */
    get_nan_flush_count(): number;
    /**
     * Pointer to the right channel buffer (valid after `process`).
     */
    get_right_ptr(): number;
    constructor(sample_rate: number);
    /**
     * Release every voice sounding at `note`.
     */
    note_off(note: number): void;
    /**
     * Trigger a note. Pitch is derived from the active sample's root note.
     */
    note_on(note: number, velocity: number): void;
    /**
     * Render a block. Returns a pointer to the left channel; the right channel
     * is at `get_right_ptr()`.
     *
     * `CrumbsEngine::process_block` *adds* into its output slices, so the
     * block is zeroed first — the native host slot does the same. Skipping it
     * would accumulate the previous block forever.
     */
    process(block_size: number): number;
    /**
     * Select which pooled sample subsequent notes play.
     */
    set_active_sample(sample_id: number): void;
    /**
     * Set the operating mode by name (`quick`, `drum`, `slice`, `warp`,
     * `record`).
     */
    set_mode(mode: string): void;
    /**
     * Set a global parameter by its `CrumbsDescriptor` id. Unknown ids are
     * ignored rather than trapping — a project may carry a parameter this
     * build no longer has.
     */
    set_param(name: string, value: number): void;
}

/**
 * WASM-exported Crust instance for AudioWorklet. An *effect*: it processes
 * input audio rather than generating it.
 */
export class CrustInstance {
    free(): void;
    [Symbol.dispose](): void;
    get_gr_db(): number;
    get_input_db(): number;
    /**
     * Pointer to the input left buffer — the caller writes input audio here.
     */
    get_input_left_ptr(): number;
    /**
     * Pointer to the input right buffer.
     */
    get_input_right_ptr(): number;
    /**
     * Delay imposed on the audio path, in samples, for host compensation.
     */
    get_latency_samples(): number;
    get_lra(): number;
    get_lufs_integrated(): number;
    get_lufs_momentary(): number;
    get_lufs_short_term(): number;
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction. Non-zero means a poisoned block was caught at the wasm
     * output boundary and surfaced for health telemetry.
     */
    get_nan_flush_count(): number;
    get_output_db(): number;
    /**
     * Pointer to the output right buffer (call after `process`).
     */
    get_right_ptr(): number;
    /**
     * 1.0 when the held true-peak maximum is above the configured ceiling.
     */
    get_true_peak_exceeded(): number;
    /**
     * Held true-peak maximum in dBTP.
     */
    get_true_peak_max(): number;
    constructor(sample_rate: number);
    /**
     * Process a block. Input must already be written to the input buffers.
     * Returns a pointer to the output left buffer.
     */
    process(block_size: number): number;
    /**
     * Clear the held true-peak maximum behind the panel's TP reset.
     */
    reset_true_peak(): void;
    /**
     * Set a parameter by its snake_case engine name.
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
     * Advance control-rate smoothing while DSP is asleep.
     */
    advance_silence(): void;
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
     * Stable numeric lifecycle code consumed by the AudioWorklet host.
     */
    lifecycle_state(): number;
    /**
     * `max_voices` is the instance-wide playable note-voice ceiling, clamped
     * to 1..=64 across all layers. Each voice can render up to 16 unison
     * oscillators; bounded steal tails overlap only for de-clicking.
     */
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
     *
     * Consumes every event queued since the last call, splitting the render at
     * each event's sample offset, and empties the list.
     */
    process(block_size: number): number;
    /**
     * Queue MPE per-note expression at `offset` samples into the next block.
     */
    push_note_expression(note: number, channel: number, bend_semitones: number, pressure: number, slide: number, offset: number): boolean;
    /**
     * Queue a note-off releasing every voice at `note`, at `offset` samples
     * into the next rendered block.
     */
    push_note_off(note: number, offset: number): boolean;
    /**
     * Queue a note-off narrowed to one MPE member channel (audit MD-2).
     */
    push_note_off_on_channel(note: number, channel: number, offset: number): boolean;
    /**
     * Queue a note-on at `offset` samples into the next rendered block.
     *
     * Returns `false` when the block's event list is full, so the caller can
     * hold the event back for the next block instead of losing it. Events must
     * be pushed in non-decreasing `offset` order — the engine applies them in
     * the order given and never sorts, so a note-off and a re-trigger of one
     * pitch on the same sample keep the sequence the caller intended.
     */
    push_note_on(note: number, velocity: number, channel: number, offset: number): boolean;
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
     * Current DSP-owned render lifecycle for the worker host.
     */
    lifecycle_state(): number;
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
    /**
     * Static per-tier CPU estimate for the selected neural tier and budget —
     * not a measurement of the running host. Present it as an expected cost,
     * never as observed load.
     */
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
    /**
     * Clear every amp stage's runtime state without disturbing parameters,
     * so filter memories, envelopes, cabinet ring buffers and meters do not
     * carry one playhead position into another on transport stop or seek.
     */
    reset(): void;
    set_param(name: string, value: number): void;
}

export class KneadInstance {
    free(): void;
    [Symbol.dispose](): void;
    get_f0(): number;
    get_input_left_ptr(): number;
    get_input_right_ptr(): number;
    /**
     * Samples of group delay this instance imposes, for plugin delay
     * compensation. Mirrors `GlutenInstance::get_latency_samples`; the worklet
     * forwards it on the ready handshake so PDC can offset the track.
     */
    get_latency_samples(): number;
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
     * Formant correction. `true` (the default) keeps the spectral envelope
     * where the singer put it while the fundamental moves; `false` lets the
     * envelope track the pitch, the varispeed relation.
     */
    set_formant_preserve(preserve: boolean): void;
    /**
     * Retune speed in milliseconds: how long the rendered shift takes to
     * arrive at a new blob's target. `0` snaps, which is what the engine did
     * unconditionally before this export existed.
     */
    set_retune_speed_ms(ms: number): void;
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
     * Discard a failed staged bank without changing the sounding bank.
     */
    abort_sample_bank(): void;
    /**
     * Get number of currently sounding voices.
     */
    active_voices(): number;
    /**
     * Register a recorded true-legato transition sample (audit F7). Bank
     * loading calls this once per authored transition; the engine looks
     * these up by (interval, dynamic, transition type) when a note-on
     * overlaps a held note closely enough to classify as legato.
     */
    add_legato_transition(interval: number, transition_type: number, dynamic: number, sample_id: number, crossfade_out_ms: number): void;
    /**
     * Add a sample to the uniquely-owned loading bank. `data` is interleaved
     * f32 PCM. Returns `None` if the bank is already shared or exceeds limits.
     */
    add_sample(data: Float32Array, frame_count: number, channels: number, sample_rate: number): number | undefined;
    /**
     * Add a zone to the zone map. Call build_zone_map() after all zones are added.
     *
     * `tune_cents` is the zone's authored fine tuning, in cents against
     * `root_note`. It crosses the boundary as an `f32` because that is the
     * widest numeric the worklet port hands over without a lossy narrowing on
     * the JS side, and is rounded into `SampleRef`'s `i16` here — the engine's
     * own unit. Hardcoding it to zero here dropped every detuned zone's tuning
     * on the floor: `LevainVoice::start` is the only reader and it reads the
     * `SampleRef` field, so a bank that tuned a zone played at the untuned
     * pitch in the browser while the native path honoured it.
     */
    add_zone(zone_id: number, sample_id: number, articulation_id: number, root_note: number, tune_cents: number, lo_key: number, hi_key: number, lo_vel: number, hi_vel: number, rr_pos: number, rr_len: number, mic_id: number, is_release: boolean, loop_mode: number, loop_start: number, loop_end: number, loop_crossfade: number, gain_db: number, attack: number, decay: number, sustain: number, release: number): void;
    /**
     * Silent all-notes-off. Releases every active voice without firing
     * per-note realism release transients. Used by the transport on stop
     * so we don't spawn a 128-note bow-lift noise burst.
     */
    all_notes_off(): void;
    /**
     * Attach an immutable PCM bank published in this rendering thread.
     */
    attach_sample_bank(bank_key: string): boolean;
    /**
     * Reset this device to a uniquely-owned empty loading bank.
     */
    begin_sample_bank(instrument_id: string): void;
    /**
     * Build the zone lookup table after all zones and samples are loaded.
     */
    build_zone_map(num_articulations: number, num_mics: number): boolean;
    /**
     * Clear all loaded zones and samples from the engine.
     */
    clear_zones(): void;
    /**
     * Atomically activate a successfully built staged PCM bank and zone map.
     */
    commit_sample_bank(): boolean;
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
     * Process a MIDI note on with an immutable per-note articulation id.
     */
    note_on_with_channel_and_articulation(note: number, velocity: number, channel: number, articulation: number): void;
    /**
     * Process a block of audio. Returns pointer to left channel.
     * Caller reads left + right from WASM memory.
     */
    process(block_size: number): number;
    /**
     * Publish the complete immutable PCM bank for sibling Levain instances.
     */
    publish_sample_bank(bank_key: string): boolean;
    /**
     * Decoded PCM bytes retained by this instance's current shared bank.
     */
    sample_bank_bytes(): number;
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
     * Advance control-rate state while the processor is intentionally asleep.
     */
    advance_silence(block_size: number): void;
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
    /**
     * Stable processor lifecycle code shared with the AudioWorklet host.
     */
    lifecycle_state(): number;
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
    readonly __wbg_fermenterinstance_free: (a: number, b: number) => void;
    readonly __wbg_grinderinstance_free: (a: number, b: number) => void;
    readonly fermenterinstance_active_voices: (a: number) => number;
    readonly fermenterinstance_advance_silence: (a: number) => void;
    readonly fermenterinstance_get_nan_flush_count: (a: number) => number;
    readonly fermenterinstance_get_right_ptr: (a: number) => number;
    readonly fermenterinstance_lifecycle_state: (a: number) => number;
    readonly fermenterinstance_new: (a: number, b: number) => number;
    readonly fermenterinstance_note_expression: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly fermenterinstance_note_off: (a: number, b: number) => void;
    readonly fermenterinstance_note_off_on_channel: (a: number, b: number, c: number) => void;
    readonly fermenterinstance_note_on: (a: number, b: number, c: number) => void;
    readonly fermenterinstance_note_on_with_channel: (a: number, b: number, c: number, d: number) => void;
    readonly fermenterinstance_process: (a: number, b: number) => number;
    readonly fermenterinstance_push_note_expression: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly fermenterinstance_push_note_off: (a: number, b: number, c: number) => number;
    readonly fermenterinstance_push_note_off_on_channel: (a: number, b: number, c: number, d: number) => number;
    readonly fermenterinstance_push_note_on: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly fermenterinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly fermenterinstance_set_param_by_id: (a: number, b: number, c: number) => void;
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
    readonly grinderinstance_reset: (a: number) => void;
    readonly grinderinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly __wbg_bacteriainstance_free: (a: number, b: number) => void;
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
    readonly __wbg_crustinstance_free: (a: number, b: number) => void;
    readonly __wbg_grandbouleinstance_free: (a: number, b: number) => void;
    readonly analyze_pitch_wasm: (a: number, b: number, c: number) => [number, number];
    readonly commit_pitch_edit_wasm: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly crustinstance_get_gr_db: (a: number) => number;
    readonly crustinstance_get_input_db: (a: number) => number;
    readonly crustinstance_get_input_left_ptr: (a: number) => number;
    readonly crustinstance_get_input_right_ptr: (a: number) => number;
    readonly crustinstance_get_latency_samples: (a: number) => number;
    readonly crustinstance_get_lra: (a: number) => number;
    readonly crustinstance_get_lufs_integrated: (a: number) => number;
    readonly crustinstance_get_lufs_momentary: (a: number) => number;
    readonly crustinstance_get_lufs_short_term: (a: number) => number;
    readonly crustinstance_get_nan_flush_count: (a: number) => number;
    readonly crustinstance_get_output_db: (a: number) => number;
    readonly crustinstance_get_right_ptr: (a: number) => number;
    readonly crustinstance_get_true_peak_exceeded: (a: number) => number;
    readonly crustinstance_get_true_peak_max: (a: number) => number;
    readonly crustinstance_new: (a: number) => number;
    readonly crustinstance_process: (a: number, b: number) => number;
    readonly crustinstance_reset_true_peak: (a: number) => void;
    readonly crustinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly grandbouleinstance_all_notes_off: (a: number) => void;
    readonly grandbouleinstance_get_nan_flush_count: (a: number) => number;
    readonly grandbouleinstance_get_right_ptr: (a: number) => number;
    readonly grandbouleinstance_lifecycle_state: (a: number) => number;
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
    readonly __wbg_kneadinstance_free: (a: number, b: number) => void;
    readonly kneadinstance_get_f0: (a: number) => number;
    readonly kneadinstance_get_input_left_ptr: (a: number) => number;
    readonly kneadinstance_get_input_right_ptr: (a: number) => number;
    readonly kneadinstance_get_latency_samples: (a: number) => number;
    readonly kneadinstance_get_nan_flush_count: (a: number) => number;
    readonly kneadinstance_get_periodicity: (a: number) => number;
    readonly kneadinstance_get_right_ptr: (a: number) => number;
    readonly kneadinstance_is_voiced: (a: number) => number;
    readonly kneadinstance_new: (a: number) => number;
    readonly kneadinstance_process: (a: number, b: number) => number;
    readonly kneadinstance_set_formant_preserve: (a: number, b: number) => void;
    readonly kneadinstance_set_retune_speed_ms: (a: number, b: number) => void;
    readonly kneadinstance_set_shift_semitones: (a: number, b: number) => void;
    readonly __wbg_crumbsinstance_free: (a: number, b: number) => void;
    readonly __wbg_levaininstance_free: (a: number, b: number) => void;
    readonly __wbg_proofinstance_free: (a: number, b: number) => void;
    readonly __wbg_toasterinstance_free: (a: number, b: number) => void;
    readonly crumbsinstance_active_voices: (a: number) => number;
    readonly crumbsinstance_add_sample: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly crumbsinstance_all_notes_off: (a: number) => void;
    readonly crumbsinstance_all_sound_off: (a: number) => void;
    readonly crumbsinstance_get_nan_flush_count: (a: number) => number;
    readonly crumbsinstance_get_right_ptr: (a: number) => number;
    readonly crumbsinstance_new: (a: number) => number;
    readonly crumbsinstance_note_off: (a: number, b: number) => void;
    readonly crumbsinstance_note_on: (a: number, b: number, c: number) => void;
    readonly crumbsinstance_process: (a: number, b: number) => number;
    readonly crumbsinstance_set_active_sample: (a: number, b: number) => void;
    readonly crumbsinstance_set_mode: (a: number, b: number, c: number) => void;
    readonly crumbsinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly levaininstance_abort_sample_bank: (a: number) => void;
    readonly levaininstance_active_voices: (a: number) => number;
    readonly levaininstance_add_legato_transition: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly levaininstance_add_sample: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly levaininstance_add_zone: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number) => void;
    readonly levaininstance_all_notes_off: (a: number) => void;
    readonly levaininstance_attach_sample_bank: (a: number, b: number, c: number) => number;
    readonly levaininstance_begin_sample_bank: (a: number, b: number, c: number) => void;
    readonly levaininstance_build_zone_map: (a: number, b: number, c: number) => number;
    readonly levaininstance_clear_zones: (a: number) => void;
    readonly levaininstance_commit_sample_bank: (a: number) => number;
    readonly levaininstance_get_nan_flush_count: (a: number) => number;
    readonly levaininstance_get_right_ptr: (a: number) => number;
    readonly levaininstance_handle_cc: (a: number, b: number, c: number) => void;
    readonly levaininstance_new: (a: number, b: number) => number;
    readonly levaininstance_note_expression: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly levaininstance_note_off: (a: number, b: number) => void;
    readonly levaininstance_note_off_on_channel: (a: number, b: number, c: number) => void;
    readonly levaininstance_note_on: (a: number, b: number, c: number) => void;
    readonly levaininstance_note_on_with_channel: (a: number, b: number, c: number, d: number) => void;
    readonly levaininstance_note_on_with_channel_and_articulation: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly levaininstance_process: (a: number, b: number) => number;
    readonly levaininstance_publish_sample_bank: (a: number, b: number, c: number) => number;
    readonly levaininstance_sample_bank_bytes: (a: number) => number;
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
    readonly toasterinstance_advance_silence: (a: number, b: number) => void;
    readonly toasterinstance_get_nan_flush_count: (a: number) => number;
    readonly toasterinstance_get_right_ptr: (a: number) => number;
    readonly toasterinstance_lifecycle_state: (a: number) => number;
    readonly toasterinstance_new: (a: number, b: number) => number;
    readonly toasterinstance_note_off: (a: number, b: number) => void;
    readonly toasterinstance_note_on: (a: number, b: number, c: number, d: number) => void;
    readonly toasterinstance_process: (a: number, b: number) => number;
    readonly toasterinstance_reset_pad_dry_routing: (a: number) => void;
    readonly toasterinstance_set_pad_dry_routed: (a: number, b: number, c: number) => void;
    readonly toasterinstance_set_pad_param: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly toasterinstance_set_param: (a: number, b: number, c: number, d: number) => void;
    readonly toasterinstance_set_param_by_id: (a: number, b: number, c: number) => void;
    readonly init_panic_hook: () => void;
    readonly __wbg_gluteninstance_free: (a: number, b: number) => void;
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
