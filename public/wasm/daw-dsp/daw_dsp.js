/* @ts-self-types="./daw_dsp.d.ts" */

/**
 * WASM-exported Bacteria instance for AudioWorklet.
 */
export class BacteriaInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BacteriaInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_bacteriainstance_free(ptr, 0);
    }
    /**
     * Add a macro mapping: macro `macro_index` (0-7) → `target_param`, remapped
     * from the macro's 0-1 range into `[min_value, max_value]`.
     * @param {number} macro_index
     * @param {number} target_param
     * @param {number} min_value
     * @param {number} max_value
     */
    add_macro_mapping(macro_index, target_param, min_value, max_value) {
        wasm.bacteriainstance_add_macro_mapping(this.__wbg_ptr, macro_index, target_param, min_value, max_value);
    }
    /**
     * Add a modulation assignment: `source_id` → `target_param` with scalar `amount`.
     *
     * Source IDs: 0=LFO1, 1=LFO2, 2=envelope follower, 3=Lorenz X, 4=Lorenz Z,
     * 5=step sequencer, 6-13=macros 0-7.
     *
     * Target param IDs: 0=global mix, 1-6=band 0-5 gain (linear offset).
     * @param {number} source_id
     * @param {number} target_param
     * @param {number} amount
     */
    add_mod_assignment(source_id, target_param, amount) {
        wasm.bacteriainstance_add_mod_assignment(this.__wbg_ptr, source_id, target_param, amount);
    }
    /**
     * Get per-band levels packed as: [band0_db, band1_db, ... band5_db].
     * @returns {number}
     */
    get_band_levels_ptr() {
        const ret = wasm.bacteriainstance_get_band_levels_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get current input level in dB (for metering).
     * @returns {number}
     */
    get_input_db() {
        const ret = wasm.bacteriainstance_get_input_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get pointer to input left buffer — caller writes input audio here.
     * @returns {number}
     */
    get_input_left_ptr() {
        const ret = wasm.bacteriainstance_get_input_left_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to input right buffer.
     * @returns {number}
     */
    get_input_right_ptr() {
        const ret = wasm.bacteriainstance_get_input_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get reported latency in samples.
     * @returns {number}
     */
    get_latency_samples() {
        const ret = wasm.bacteriainstance_get_latency_samples(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.bacteriainstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get current output level in dB (for metering).
     * @returns {number}
     */
    get_output_db() {
        const ret = wasm.bacteriainstance_get_output_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get pointer to output right buffer (call after process).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.bacteriainstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.bacteriainstance_new(sample_rate);
        this.__wbg_ptr = ret;
        BacteriaInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Process a block. Input must already be written to input buffers.
     * Returns pointer to output left buffer.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.bacteriainstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Set a parameter by name.
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.bacteriainstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) BacteriaInstance.prototype[Symbol.dispose] = BacteriaInstance.prototype.free;

/**
 * WASM-exported Crumbs instance for AudioWorklet rendering.
 *
 * Crumbs' native host reaches `CrumbsEngine` over an SPSC command ring from
 * the Tauri command layer. A worklet has no such ring — messages already
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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CrumbsInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_crumbsinstance_free(ptr, 0);
    }
    /**
     * Voices sounding as of the last rendered block, counting stolen notes
     * that are still running their de-click fade. Can exceed the 128-slot
     * pool; see `CrumbsEngine::read_active_voice_count`.
     * @returns {number}
     */
    active_voices() {
        const ret = wasm.crumbsinstance_active_voices(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Copy interleaved PCM into the in-memory pool and return its sample id.
     *
     * Mirrors `LevainInstance::add_sample`: the caller transfers a
     * `Float32Array` across the worklet port because a wasm instance cannot
     * read a file. Not RT-safe — call it during setup, never from `process`.
     * @param {Float32Array} data
     * @param {number} channels
     * @param {number} sample_rate
     * @returns {number}
     */
    add_sample(data, channels, sample_rate) {
        const ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.crumbsinstance_add_sample(this.__wbg_ptr, ptr0, len0, channels, sample_rate);
        return ret >>> 0;
    }
    /**
     * Release all held voices into their amp-envelope release stage.
     */
    all_notes_off() {
        wasm.crumbsinstance_all_notes_off(this.__wbg_ptr);
    }
    /**
     * Cut every voice immediately with a short de-click fade.
     */
    all_sound_off() {
        wasm.crumbsinstance_all_sound_off(this.__wbg_ptr);
    }
    /**
     * Non-finite output samples scrubbed to silence since construction.
     * Non-zero means a poisoned block was caught at the wasm boundary.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.crumbsinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * Pointer to the right channel buffer (valid after `process`).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.crumbsinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.crumbsinstance_new(sample_rate);
        this.__wbg_ptr = ret;
        CrumbsInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Release every voice sounding at `note`.
     * @param {number} note
     */
    note_off(note) {
        wasm.crumbsinstance_note_off(this.__wbg_ptr, note);
    }
    /**
     * Trigger a note. Pitch is derived from the active sample's root note.
     * @param {number} note
     * @param {number} velocity
     */
    note_on(note, velocity) {
        wasm.crumbsinstance_note_on(this.__wbg_ptr, note, velocity);
    }
    /**
     * Render a block. Returns a pointer to the left channel; the right channel
     * is at `get_right_ptr()`.
     *
     * `CrumbsEngine::process_block` *adds* into its output slices, so the
     * block is zeroed first — the native host slot does the same. Skipping it
     * would accumulate the previous block forever.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.crumbsinstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Select which pooled sample subsequent notes play.
     * @param {number} sample_id
     */
    set_active_sample(sample_id) {
        wasm.crumbsinstance_set_active_sample(this.__wbg_ptr, sample_id);
    }
    /**
     * Set the operating mode by name (`quick`, `drum`, `slice`, `warp`,
     * `record`).
     * @param {string} mode
     */
    set_mode(mode) {
        const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.crumbsinstance_set_mode(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Set a global parameter by its `CrumbsDescriptor` id. Unknown ids are
     * ignored rather than trapping — a project may carry a parameter this
     * build no longer has.
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.crumbsinstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) CrumbsInstance.prototype[Symbol.dispose] = CrumbsInstance.prototype.free;

/**
 * WASM-exported Crust instance for AudioWorklet. An *effect*: it processes
 * input audio rather than generating it.
 */
export class CrustInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        CrustInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_crustinstance_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get_gr_db() {
        const ret = wasm.crustinstance_get_gr_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_input_db() {
        const ret = wasm.crustinstance_get_input_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * Pointer to the input left buffer — the caller writes input audio here.
     * @returns {number}
     */
    get_input_left_ptr() {
        const ret = wasm.crustinstance_get_input_left_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Pointer to the input right buffer.
     * @returns {number}
     */
    get_input_right_ptr() {
        const ret = wasm.crustinstance_get_input_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Delay imposed on the audio path, in samples, for host compensation.
     * @returns {number}
     */
    get_latency_samples() {
        const ret = wasm.crustinstance_get_latency_samples(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_lra() {
        const ret = wasm.crustinstance_get_lra(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_lufs_integrated() {
        const ret = wasm.crustinstance_get_lufs_integrated(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_lufs_momentary() {
        const ret = wasm.crustinstance_get_lufs_momentary(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_lufs_short_term() {
        const ret = wasm.crustinstance_get_lufs_short_term(this.__wbg_ptr);
        return ret;
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction. Non-zero means a poisoned block was caught at the wasm
     * output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.crustinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_output_db() {
        const ret = wasm.crustinstance_get_output_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * Pointer to the output right buffer (call after `process`).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.crustinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * 1.0 when the held true-peak maximum is above the configured ceiling.
     * @returns {number}
     */
    get_true_peak_exceeded() {
        const ret = wasm.crustinstance_get_true_peak_exceeded(this.__wbg_ptr);
        return ret;
    }
    /**
     * Held true-peak maximum in dBTP.
     * @returns {number}
     */
    get_true_peak_max() {
        const ret = wasm.crustinstance_get_true_peak_max(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.crustinstance_new(sample_rate);
        this.__wbg_ptr = ret;
        CrustInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Process a block. Input must already be written to the input buffers.
     * Returns a pointer to the output left buffer.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.crustinstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Clear the held true-peak maximum behind the panel's TP reset.
     */
    reset_true_peak() {
        wasm.crustinstance_reset_true_peak(this.__wbg_ptr);
    }
    /**
     * Set a parameter by its snake_case engine name.
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.crustinstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) CrustInstance.prototype[Symbol.dispose] = CrustInstance.prototype.free;

/**
 * WASM-exported Fermenter instance for AudioWorklet.
 */
export class FermenterInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        FermenterInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_fermenterinstance_free(ptr, 0);
    }
    /**
     * Get number of currently sounding voices.
     * @returns {number}
     */
    active_voices() {
        const ret = wasm.fermenterinstance_active_voices(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Advance control-rate smoothing while DSP is asleep.
     */
    advance_silence() {
        wasm.fermenterinstance_advance_silence(this.__wbg_ptr);
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.fermenterinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get pointer to right channel buffer (call after process).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.fermenterinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Stable numeric lifecycle code consumed by the AudioWorklet host.
     * @returns {number}
     */
    lifecycle_state() {
        const ret = wasm.fermenterinstance_lifecycle_state(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * `max_voices` is the instance-wide playable note-voice ceiling, clamped
     * to 1..=64 across all layers. Each voice can render up to 16 unison
     * oscillators; bounded steal tails overlap only for de-clicking.
     * @param {number} sample_rate
     * @param {number} max_voices
     */
    constructor(sample_rate, max_voices) {
        const ret = wasm.fermenterinstance_new(sample_rate, max_voices);
        this.__wbg_ptr = ret;
        FermenterInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Apply MPE per-note expression to the voices held on `channel` at `note`
     * (audit MD-2).
     *
     * `bend_semitones` is the member-channel pitch bend already resolved
     * against the controller's bend range; `pressure` is 0..1; `slide` is the
     * CC74 timbre as -1..1 with 0 neutral. Normalisation from wire units lives
     * on the TypeScript side so the live and scheduled paths share one
     * conversion.
     * @param {number} note
     * @param {number} channel
     * @param {number} bend_semitones
     * @param {number} pressure
     * @param {number} slide
     */
    note_expression(note, channel, bend_semitones, pressure, slide) {
        wasm.fermenterinstance_note_expression(this.__wbg_ptr, note, channel, bend_semitones, pressure, slide);
    }
    /**
     * Process a MIDI note off event. Releases every voice at that pitch.
     * @param {number} note
     */
    note_off(note) {
        wasm.fermenterinstance_note_off(this.__wbg_ptr, note);
    }
    /**
     * Note-off narrowed to one MPE member channel, so releasing a note on one
     * member channel cannot silence a different note sounding the same pitch
     * on another (audit MD-2).
     * @param {number} note
     * @param {number} channel
     */
    note_off_on_channel(note, channel) {
        wasm.fermenterinstance_note_off_on_channel(this.__wbg_ptr, note, channel);
    }
    /**
     * Process a MIDI note on event.
     * @param {number} note
     * @param {number} velocity
     */
    note_on(note, velocity) {
        wasm.fermenterinstance_note_on(this.__wbg_ptr, note, velocity);
    }
    /**
     * Process a MIDI note on carrying its MPE member channel.
     * @param {number} note
     * @param {number} velocity
     * @param {number} channel
     */
    note_on_with_channel(note, velocity, channel) {
        wasm.fermenterinstance_note_on_with_channel(this.__wbg_ptr, note, velocity, channel);
    }
    /**
     * Process a block of 128 samples. Returns pointer to left channel.
     * Caller reads left + right from WASM memory.
     *
     * Consumes every event queued since the last call, splitting the render at
     * each event's sample offset, and empties the list.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.fermenterinstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Queue MPE per-note expression at `offset` samples into the next block.
     * @param {number} note
     * @param {number} channel
     * @param {number} bend_semitones
     * @param {number} pressure
     * @param {number} slide
     * @param {number} offset
     * @returns {boolean}
     */
    push_note_expression(note, channel, bend_semitones, pressure, slide, offset) {
        const ret = wasm.fermenterinstance_push_note_expression(this.__wbg_ptr, note, channel, bend_semitones, pressure, slide, offset);
        return ret !== 0;
    }
    /**
     * Queue a note-off releasing every voice at `note`, at `offset` samples
     * into the next rendered block.
     * @param {number} note
     * @param {number} offset
     * @returns {boolean}
     */
    push_note_off(note, offset) {
        const ret = wasm.fermenterinstance_push_note_off(this.__wbg_ptr, note, offset);
        return ret !== 0;
    }
    /**
     * Queue a note-off narrowed to one MPE member channel (audit MD-2).
     * @param {number} note
     * @param {number} channel
     * @param {number} offset
     * @returns {boolean}
     */
    push_note_off_on_channel(note, channel, offset) {
        const ret = wasm.fermenterinstance_push_note_off_on_channel(this.__wbg_ptr, note, channel, offset);
        return ret !== 0;
    }
    /**
     * Queue a note-on at `offset` samples into the next rendered block.
     *
     * Returns `false` when the block's event list is full, so the caller can
     * hold the event back for the next block instead of losing it. Events must
     * be pushed in non-decreasing `offset` order — the engine applies them in
     * the order given and never sorts, so a note-off and a re-trigger of one
     * pitch on the same sample keep the sequence the caller intended.
     * @param {number} note
     * @param {number} velocity
     * @param {number} channel
     * @param {number} offset
     * @returns {boolean}
     */
    push_note_on(note, velocity, channel, offset) {
        const ret = wasm.fermenterinstance_push_note_on(this.__wbg_ptr, note, velocity, channel, offset);
        return ret !== 0;
    }
    /**
     * Set a named parameter value.
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.fermenterinstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
    /**
     * Set a supported automation parameter without crossing the WASM string bridge.
     * @param {number} param_id
     * @param {number} value
     */
    set_param_by_id(param_id, value) {
        wasm.fermenterinstance_set_param_by_id(this.__wbg_ptr, param_id, value);
    }
}
if (Symbol.dispose) FermenterInstance.prototype[Symbol.dispose] = FermenterInstance.prototype.free;

/**
 * WASM-exported Gluten instance for AudioWorklet.
 * Unlike instruments, this is an *effect* — it processes input audio.
 */
export class GlutenInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GlutenInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gluteninstance_free(ptr, 0);
    }
    /**
     * Get crest factor (peak/RMS ratio in dB).
     * @returns {number}
     */
    get_crest() {
        const ret = wasm.gluteninstance_get_crest(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get current gain reduction in dB (for metering).
     * @returns {number}
     */
    get_gr_db() {
        const ret = wasm.gluteninstance_get_gr_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get current input level in dB (for metering).
     * @returns {number}
     */
    get_input_db() {
        const ret = wasm.gluteninstance_get_input_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get pointer to input left buffer — caller writes input audio here.
     * @returns {number}
     */
    get_input_left_ptr() {
        const ret = wasm.gluteninstance_get_input_left_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to input right buffer.
     * @returns {number}
     */
    get_input_right_ptr() {
        const ret = wasm.gluteninstance_get_input_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get latency in samples (lookahead delay) for host compensation.
     * @returns {number}
     */
    get_latency_samples() {
        const ret = wasm.gluteninstance_get_latency_samples(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.gluteninstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get current output level in dB (for metering).
     * @returns {number}
     */
    get_output_db() {
        const ret = wasm.gluteninstance_get_output_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get phase correlation (-1 to +1).
     * @returns {number}
     */
    get_phase_corr() {
        const ret = wasm.gluteninstance_get_phase_corr(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get pointer to output right buffer (call after process).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.gluteninstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to external sidechain left buffer.
     * @returns {number}
     */
    get_sc_left_ptr() {
        const ret = wasm.gluteninstance_get_sc_left_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get pointer to external sidechain right buffer.
     * @returns {number}
     */
    get_sc_right_ptr() {
        const ret = wasm.gluteninstance_get_sc_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.gluteninstance_new(sample_rate);
        this.__wbg_ptr = ret;
        GlutenInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Process a block. Input must already be written to input buffers.
     * Returns pointer to output left buffer.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.gluteninstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Set a parameter by name.
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.gluteninstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) GlutenInstance.prototype[Symbol.dispose] = GlutenInstance.prototype.free;

/**
 * WASM-exported Grand Boule instance for AudioWorklet integration.
 */
export class GrandBouleInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GrandBouleInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_grandbouleinstance_free(ptr, 0);
    }
    /**
     * Panic: silence every voice immediately.
     */
    all_notes_off() {
        wasm.grandbouleinstance_all_notes_off(this.__wbg_ptr);
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.grandbouleinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * Pointer to the right channel buffer (call after `process`).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.grandbouleinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Current DSP-owned render lifecycle for the worker host.
     * @returns {number}
     */
    lifecycle_state() {
        const ret = wasm.grandbouleinstance_lifecycle_state(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Load an attack-sample clip into the hybrid sampled-attack set.
     * @param {number} key
     * @param {Float32Array} samples
     */
    load_attack_clip(key, samples) {
        const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.grandbouleinstance_load_attack_clip(this.__wbg_ptr, key, ptr0, len0);
    }
    /**
     * @param {number} sample_rate
     * @param {number} voice_count
     */
    constructor(sample_rate, voice_count) {
        const ret = wasm.grandbouleinstance_new(sample_rate, voice_count);
        this.__wbg_ptr = ret;
        GrandBouleInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Apply MPE per-note expression to the voice held on `channel` at
     * `midi_note` (audit MD-2).
     *
     * Grand Boule sounds `bend_semitones` only: the ringing modal strings are
     * retuned in place. `pressure` and `slide` have no physical counterpart on
     * a struck string and are dropped — the expression registry advertises
     * pitch bend alone, so the editor never offers those lanes for this device.
     * @param {number} midi_note
     * @param {number} channel
     * @param {number} bend_semitones
     * @param {number} pressure
     * @param {number} slide
     */
    note_expression(midi_note, channel, bend_semitones, pressure, slide) {
        wasm.grandbouleinstance_note_expression(this.__wbg_ptr, midi_note, channel, bend_semitones, pressure, slide);
    }
    /**
     * Begin the release phase for any voice holding this note.
     * @param {number} midi_note
     */
    note_off(midi_note) {
        wasm.grandbouleinstance_note_off(this.__wbg_ptr, midi_note);
    }
    /**
     * Note-off narrowed to one MPE member channel (audit MD-2).
     * @param {number} midi_note
     * @param {number} channel
     */
    note_off_on_channel(midi_note, channel) {
        wasm.grandbouleinstance_note_off_on_channel(this.__wbg_ptr, midi_note, channel);
    }
    /**
     * Trigger a note. `midi_note` covers the full MIDI range; out-of-piano
     * notes are silently ignored.
     * @param {number} midi_note
     * @param {number} velocity
     */
    note_on(midi_note, velocity) {
        wasm.grandbouleinstance_note_on(this.__wbg_ptr, midi_note, velocity);
    }
    /**
     * Trigger a MIDI 2.0 note-on with 16-bit velocity and Q24 pitch offset.
     * @param {number} midi_note
     * @param {number} velocity_16bit
     * @param {number} pitch_offset_q24
     */
    note_on_midi2(midi_note, velocity_16bit, pitch_offset_q24) {
        wasm.grandbouleinstance_note_on_midi2(this.__wbg_ptr, midi_note, velocity_16bit, pitch_offset_q24);
    }
    /**
     * Trigger a note carrying its MPE member channel.
     * @param {number} midi_note
     * @param {number} velocity
     * @param {number} channel
     */
    note_on_with_channel(midi_note, velocity, channel) {
        wasm.grandbouleinstance_note_on_with_channel(this.__wbg_ptr, midi_note, velocity, channel);
    }
    /**
     * Render a block of audio and return a pointer to the left channel.
     * The caller reads both channels from WASM memory.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.grandbouleinstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Set a global parameter (`master_gain`, `soundboard_send`,
     * `sympathetic_send`).
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.grandbouleinstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
    /**
     * Set the sostenuto pedal state.
     * @param {boolean} engaged
     */
    set_sostenuto(engaged) {
        wasm.grandbouleinstance_set_sostenuto(this.__wbg_ptr, engaged);
    }
    /**
     * Set the sustain pedal position (0..1).
     * @param {number} position
     */
    set_sustain(position) {
        wasm.grandbouleinstance_set_sustain(this.__wbg_ptr, position);
    }
    /**
     * Set the historical temperament (0 = Equal, 1 = Werckmeister III,
     * 2 = Kirnberger III, 3 = Vallotti, 4 = Young II, 5 = Meantone ¼-comma).
     * @param {number} index
     */
    set_temperament(index) {
        wasm.grandbouleinstance_set_temperament(this.__wbg_ptr, index);
    }
    /**
     * Set the una-corda pedal state.
     * @param {boolean} engaged
     */
    set_una_corda(engaged) {
        wasm.grandbouleinstance_set_una_corda(this.__wbg_ptr, engaged);
    }
}
if (Symbol.dispose) GrandBouleInstance.prototype[Symbol.dispose] = GrandBouleInstance.prototype.free;

/**
 * WASM-exported Grinder instance for AudioWorklet.
 */
export class GrinderInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GrinderInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_grinderinstance_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get_automation_values_ptr() {
        const ret = wasm.grinderinstance_get_automation_values_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_gate_envelope_db() {
        const ret = wasm.grinderinstance_get_gate_envelope_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_gate_open() {
        const ret = wasm.grinderinstance_get_gate_open(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_input_db() {
        const ret = wasm.grinderinstance_get_input_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_input_left_ptr() {
        const ret = wasm.grinderinstance_get_input_left_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_input_right_ptr() {
        const ret = wasm.grinderinstance_get_input_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_latency_samples() {
        const ret = wasm.grinderinstance_get_latency_samples(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.grinderinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_neural_cpu_percent() {
        const ret = wasm.grinderinstance_get_neural_cpu_percent(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_neural_warmup_progress() {
        const ret = wasm.grinderinstance_get_neural_warmup_progress(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_output_db() {
        const ret = wasm.grinderinstance_get_output_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_output_left_ptr() {
        const ret = wasm.grinderinstance_get_output_left_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_power_amp_db() {
        const ret = wasm.grinderinstance_get_power_amp_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_preamp_db() {
        const ret = wasm.grinderinstance_get_preamp_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.grinderinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_sag_voltage() {
        const ret = wasm.grinderinstance_get_sag_voltage(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.grinderinstance_new(sample_rate);
        this.__wbg_ptr = ret;
        GrinderInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.grinderinstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * @param {number} block_size
     * @returns {number}
     */
    process_automated(block_size) {
        const ret = wasm.grinderinstance_process_automated(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.grinderinstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) GrinderInstance.prototype[Symbol.dispose] = GrinderInstance.prototype.free;

export class KneadInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KneadInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_kneadinstance_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get_f0() {
        const ret = wasm.kneadinstance_get_f0(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_input_left_ptr() {
        const ret = wasm.kneadinstance_get_input_left_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_input_right_ptr() {
        const ret = wasm.kneadinstance_get_input_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Samples of group delay this instance imposes, for plugin delay
     * compensation. Mirrors `GlutenInstance::get_latency_samples`; the worklet
     * forwards it on the ready handshake so PDC can offset the track.
     * @returns {number}
     */
    get_latency_samples() {
        const ret = wasm.kneadinstance_get_latency_samples(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.kneadinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_periodicity() {
        const ret = wasm.kneadinstance_get_periodicity(this.__wbg_ptr);
        return ret;
    }
    /**
     * Right-channel output of the last `process` call (mirrors
     * `GlutenInstance::get_right_ptr`).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.kneadinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    is_voiced() {
        const ret = wasm.kneadinstance_is_voiced(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.kneadinstance_new(sample_rate);
        this.__wbg_ptr = ret;
        KneadInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {number} frames
     * @returns {number}
     */
    process(frames) {
        const ret = wasm.kneadinstance_process(this.__wbg_ptr, frames);
        return ret >>> 0;
    }
    /**
     * Formant correction. `true` (the default) keeps the spectral envelope
     * where the singer put it while the fundamental moves; `false` lets the
     * envelope track the pitch, the varispeed relation.
     * @param {boolean} preserve
     */
    set_formant_preserve(preserve) {
        wasm.kneadinstance_set_formant_preserve(this.__wbg_ptr, preserve);
    }
    /**
     * Retune speed in milliseconds: how long the rendered shift takes to
     * arrive at a new blob's target. `0` snaps, which is what the engine did
     * unconditionally before this export existed.
     * @param {number} ms
     */
    set_retune_speed_ms(ms) {
        wasm.kneadinstance_set_retune_speed_ms(this.__wbg_ptr, ms);
    }
    /**
     * Set the real-time pitch shift in semitones. Without this export the
     * worklet's per-quantum `set_shift_semitones` call throws a TypeError
     * and the processor faults into permanent passthrough.
     * @param {number} semitones
     */
    set_shift_semitones(semitones) {
        wasm.kneadinstance_set_shift_semitones(this.__wbg_ptr, semitones);
    }
}
if (Symbol.dispose) KneadInstance.prototype[Symbol.dispose] = KneadInstance.prototype.free;

/**
 * WASM-exported Levain instance for AudioWorklet.
 */
export class LevainInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        LevainInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_levaininstance_free(ptr, 0);
    }
    /**
     * Discard a failed staged bank without changing the sounding bank.
     */
    abort_sample_bank() {
        wasm.levaininstance_abort_sample_bank(this.__wbg_ptr);
    }
    /**
     * Get number of currently sounding voices.
     * @returns {number}
     */
    active_voices() {
        const ret = wasm.levaininstance_active_voices(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Register a recorded true-legato transition sample (audit F7). Bank
     * loading calls this once per authored transition; the engine looks
     * these up by (interval, dynamic, transition type) when a note-on
     * overlaps a held note closely enough to classify as legato.
     * @param {number} interval
     * @param {number} transition_type
     * @param {number} dynamic
     * @param {number} sample_id
     * @param {number} crossfade_in_ms
     * @param {number} crossfade_out_ms
     */
    add_legato_transition(interval, transition_type, dynamic, sample_id, crossfade_in_ms, crossfade_out_ms) {
        wasm.levaininstance_add_legato_transition(this.__wbg_ptr, interval, transition_type, dynamic, sample_id, crossfade_in_ms, crossfade_out_ms);
    }
    /**
     * Add a sample to the uniquely-owned loading bank. `data` is interleaved
     * f32 PCM. Returns `None` if the bank is already shared or exceeds limits.
     * @param {Float32Array} data
     * @param {number} frame_count
     * @param {number} channels
     * @param {number} sample_rate
     * @returns {number | undefined}
     */
    add_sample(data, frame_count, channels, sample_rate) {
        const ptr0 = passArrayF32ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.levaininstance_add_sample(this.__wbg_ptr, ptr0, len0, frame_count, channels, sample_rate);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * Add a zone to the zone map. Call build_zone_map() after all zones are added.
     * @param {number} zone_id
     * @param {number} sample_id
     * @param {number} articulation_id
     * @param {number} root_note
     * @param {number} lo_key
     * @param {number} hi_key
     * @param {number} lo_vel
     * @param {number} hi_vel
     * @param {number} rr_pos
     * @param {number} rr_len
     * @param {number} mic_id
     * @param {boolean} is_release
     * @param {number} loop_mode
     * @param {number} loop_start
     * @param {number} loop_end
     * @param {number} loop_crossfade
     * @param {number} gain_db
     * @param {number} attack
     * @param {number} decay
     * @param {number} sustain
     * @param {number} release
     */
    add_zone(zone_id, sample_id, articulation_id, root_note, lo_key, hi_key, lo_vel, hi_vel, rr_pos, rr_len, mic_id, is_release, loop_mode, loop_start, loop_end, loop_crossfade, gain_db, attack, decay, sustain, release) {
        wasm.levaininstance_add_zone(this.__wbg_ptr, zone_id, sample_id, articulation_id, root_note, lo_key, hi_key, lo_vel, hi_vel, rr_pos, rr_len, mic_id, is_release, loop_mode, loop_start, loop_end, loop_crossfade, gain_db, attack, decay, sustain, release);
    }
    /**
     * Silent all-notes-off. Releases every active voice without firing
     * per-note realism release transients. Used by the transport on stop
     * so we don't spawn a 128-note bow-lift noise burst.
     */
    all_notes_off() {
        wasm.levaininstance_all_notes_off(this.__wbg_ptr);
    }
    /**
     * Attach an immutable PCM bank published in this rendering thread.
     * @param {string} bank_key
     * @returns {boolean}
     */
    attach_sample_bank(bank_key) {
        const ptr0 = passStringToWasm0(bank_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.levaininstance_attach_sample_bank(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Reset this device to a uniquely-owned empty loading bank.
     * @param {string} instrument_id
     */
    begin_sample_bank(instrument_id) {
        const ptr0 = passStringToWasm0(instrument_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.levaininstance_begin_sample_bank(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Build the zone lookup table after all zones and samples are loaded.
     * @param {number} num_articulations
     * @param {number} num_mics
     * @returns {boolean}
     */
    build_zone_map(num_articulations, num_mics) {
        const ret = wasm.levaininstance_build_zone_map(this.__wbg_ptr, num_articulations, num_mics);
        return ret !== 0;
    }
    /**
     * Clear all loaded zones and samples from the engine.
     */
    clear_zones() {
        wasm.levaininstance_clear_zones(this.__wbg_ptr);
    }
    /**
     * Atomically activate a successfully built staged PCM bank and zone map.
     * @returns {boolean}
     */
    commit_sample_bank() {
        const ret = wasm.levaininstance_commit_sample_bank(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.levaininstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get pointer to right channel buffer (call after process).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.levaininstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Process a MIDI CC event.
     * @param {number} cc
     * @param {number} value
     */
    handle_cc(cc, value) {
        wasm.levaininstance_handle_cc(this.__wbg_ptr, cc, value);
    }
    /**
     * @param {number} sample_rate
     * @param {number} max_voices
     */
    constructor(sample_rate, max_voices) {
        const ret = wasm.levaininstance_new(sample_rate, max_voices);
        this.__wbg_ptr = ret;
        LevainInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Apply MPE per-note expression to the voices held on `channel` at `note`
     * (audit MD-2).
     *
     * `bend_semitones` is the member-channel pitch bend already resolved
     * against the controller's bend range; `pressure` is 0..1; `slide` is the
     * CC74 timbre as -1..1 with 0 neutral. Normalisation from wire units lives
     * on the TypeScript side so the live and scheduled paths share one
     * conversion.
     * @param {number} note
     * @param {number} channel
     * @param {number} bend_semitones
     * @param {number} pressure
     * @param {number} slide
     */
    note_expression(note, channel, bend_semitones, pressure, slide) {
        wasm.levaininstance_note_expression(this.__wbg_ptr, note, channel, bend_semitones, pressure, slide);
    }
    /**
     * Process a MIDI note off event.
     * @param {number} note
     */
    note_off(note) {
        wasm.levaininstance_note_off(this.__wbg_ptr, note);
    }
    /**
     * Note-off narrowed to one MPE member channel, so releasing a note on one
     * member channel cannot silence a different note sounding the same pitch
     * on another (audit MD-2).
     * @param {number} note
     * @param {number} channel
     */
    note_off_on_channel(note, channel) {
        wasm.levaininstance_note_off_on_channel(this.__wbg_ptr, note, channel);
    }
    /**
     * Process a MIDI note on event.
     * @param {number} note
     * @param {number} velocity
     */
    note_on(note, velocity) {
        wasm.levaininstance_note_on(this.__wbg_ptr, note, velocity);
    }
    /**
     * Process a MIDI note on carrying its MPE member channel.
     * @param {number} note
     * @param {number} velocity
     * @param {number} channel
     */
    note_on_with_channel(note, velocity, channel) {
        wasm.levaininstance_note_on_with_channel(this.__wbg_ptr, note, velocity, channel);
    }
    /**
     * Process a MIDI note on with an immutable per-note articulation id.
     * @param {number} note
     * @param {number} velocity
     * @param {number} channel
     * @param {number} articulation
     */
    note_on_with_channel_and_articulation(note, velocity, channel, articulation) {
        wasm.levaininstance_note_on_with_channel_and_articulation(this.__wbg_ptr, note, velocity, channel, articulation);
    }
    /**
     * Process a block of audio. Returns pointer to left channel.
     * Caller reads left + right from WASM memory.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.levaininstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Publish the complete immutable PCM bank for sibling Levain instances.
     * @param {string} bank_key
     * @returns {boolean}
     */
    publish_sample_bank(bank_key) {
        const ptr0 = passStringToWasm0(bank_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.levaininstance_publish_sample_bank(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Decoded PCM bytes retained by this instance's current shared bank.
     * @returns {number}
     */
    sample_bank_bytes() {
        const ret = wasm.levaininstance_sample_bank_bytes(this.__wbg_ptr);
        return ret;
    }
    /**
     * Tell the engine which instrument id is now loaded (e.g. `violin-1`,
     * `cello`, `trumpet`). The realism layer uses this to pick its body
     * resonance modes, sympathetic strings, and breath/bow noise colour.
     * @param {string} instrument_id
     */
    set_instrument(instrument_id) {
        const ptr0 = passStringToWasm0(instrument_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.levaininstance_set_instrument(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Set a named parameter value.
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.levaininstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) LevainInstance.prototype[Symbol.dispose] = LevainInstance.prototype.free;

/**
 * WASM-exported Proof mastering suite instance for AudioWorklet.
 */
export class ProofInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProofInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_proofinstance_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get_ab_gain_offset() {
        const ret = wasm.proofinstance_get_ab_gain_offset(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_correlation() {
        const ret = wasm.proofinstance_get_correlation(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get per-band dynamics gain reduction. Returns 4 values.
     * @param {number} band
     * @returns {number}
     */
    get_dynamics_gr(band) {
        const ret = wasm.proofinstance_get_dynamics_gr(this.__wbg_ptr, band);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_input_left_ptr() {
        const ret = wasm.proofinstance_get_input_left_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_input_lufs() {
        const ret = wasm.proofinstance_get_input_lufs(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_input_right_ptr() {
        const ret = wasm.proofinstance_get_input_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_integrated_lufs() {
        const ret = wasm.proofinstance_get_integrated_lufs(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_latency_samples() {
        const ret = wasm.proofinstance_get_latency_samples(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get_limiter_gr_db() {
        const ret = wasm.proofinstance_get_limiter_gr_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_lra() {
        const ret = wasm.proofinstance_get_lra(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    get_module_order() {
        const ret = wasm.proofinstance_get_module_order(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Non-zero means a poisoned block was caught at the
     * wasm output boundary and surfaced for health telemetry.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.proofinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_output_lufs() {
        const ret = wasm.proofinstance_get_output_lufs(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_output_st_lufs() {
        const ret = wasm.proofinstance_get_output_st_lufs(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.proofinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Get inline meter tap data. tap_idx 0 = input, 1-5 = after each module.
     * @param {number} tap_idx
     * @returns {number}
     */
    get_tap_peak_l(tap_idx) {
        const ret = wasm.proofinstance_get_tap_peak_l(this.__wbg_ptr, tap_idx);
        return ret;
    }
    /**
     * @param {number} tap_idx
     * @returns {number}
     */
    get_tap_peak_r(tap_idx) {
        const ret = wasm.proofinstance_get_tap_peak_r(this.__wbg_ptr, tap_idx);
        return ret;
    }
    /**
     * @returns {number}
     */
    get_true_peak_db() {
        const ret = wasm.proofinstance_get_true_peak_db(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} sample_rate
     */
    constructor(sample_rate) {
        const ret = wasm.proofinstance_new(sample_rate);
        this.__wbg_ptr = ret;
        ProofInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Process a block. Input must already be written to input buffers.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.proofinstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Reorder the processing chain. Pass 5 module IDs (0=EQ, 1=Dyn, 2=Img, 3=Exc, 4=Lim).
     * @param {number} m0
     * @param {number} m1
     * @param {number} m2
     * @param {number} m3
     * @param {number} m4
     */
    reorder(m0, m1, m2, m3, m4) {
        wasm.proofinstance_reorder(this.__wbg_ptr, m0, m1, m2, m3, m4);
    }
    reset_integrated() {
        wasm.proofinstance_reset_integrated(this.__wbg_ptr);
    }
    /**
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.proofinstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
}
if (Symbol.dispose) ProofInstance.prototype[Symbol.dispose] = ProofInstance.prototype.free;

/**
 * WASM-exported Toaster instance for AudioWorklet.
 */
export class ToasterInstance {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ToasterInstanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_toasterinstance_free(ptr, 0);
    }
    /**
     * Advance control-rate state while the processor is intentionally asleep.
     * @param {number} block_size
     */
    advance_silence(block_size) {
        wasm.toasterinstance_advance_silence(this.__wbg_ptr, block_size);
    }
    /**
     * Number of non-finite output samples scrubbed to silence since
     * construction (DSP-8). Covers the main stereo pair and every pad output;
     * non-zero means a poisoned block was caught at the wasm output boundary.
     * @returns {number}
     */
    get_nan_flush_count() {
        const ret = wasm.toasterinstance_get_nan_flush_count(this.__wbg_ptr);
        return ret;
    }
    /**
     * Get pointer to right channel buffer (call after process).
     * @returns {number}
     */
    get_right_ptr() {
        const ret = wasm.toasterinstance_get_right_ptr(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Stable processor lifecycle code shared with the AudioWorklet host.
     * @returns {number}
     */
    lifecycle_state() {
        const ret = wasm.toasterinstance_lifecycle_state(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} sample_rate
     * @param {number} num_pads
     */
    constructor(sample_rate, num_pads) {
        const ret = wasm.toasterinstance_new(sample_rate, num_pads);
        this.__wbg_ptr = ret;
        ToasterInstanceFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Release a pad (for sustained sounds like open hi-hat).
     * @param {number} pad
     */
    note_off(pad) {
        wasm.toasterinstance_note_off(this.__wbg_ptr, pad);
    }
    /**
     * Trigger a drum pad. `midi_note` controls pitch (60 = default/center pitch).
     * @param {number} pad
     * @param {number} velocity
     * @param {number} midi_note
     */
    note_on(pad, velocity, midi_note) {
        wasm.toasterinstance_note_on(this.__wbg_ptr, pad, velocity, midi_note);
    }
    /**
     * Process a block of audio. Returns pointer to left channel buffer.
     * Caller reads left + right from WASM memory.
     * @param {number} block_size
     * @returns {number}
     */
    process(block_size) {
        const ret = wasm.toasterinstance_process(this.__wbg_ptr, block_size);
        return ret >>> 0;
    }
    /**
     * Restore legacy parent-mix ownership for every pad.
     */
    reset_pad_dry_routing() {
        wasm.toasterinstance_reset_pad_dry_routing(this.__wbg_ptr);
    }
    /**
     * Transfer or restore ownership of a pad's dry contribution to output 0.
     * @param {number} pad
     * @param {boolean} routed
     */
    set_pad_dry_routed(pad, routed) {
        wasm.toasterinstance_set_pad_dry_routed(this.__wbg_ptr, pad, routed);
    }
    /**
     * Set a per-pad parameter (volume, pan, tune, filter_cutoff, etc.).
     * @param {number} pad
     * @param {string} name
     * @param {number} value
     */
    set_pad_param(pad, name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.toasterinstance_set_pad_param(this.__wbg_ptr, pad, ptr0, len0, value);
    }
    /**
     * Set a global parameter (master_gain, reverb_*, delay_*).
     * @param {string} name
     * @param {number} value
     */
    set_param(name, value) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.toasterinstance_set_param(this.__wbg_ptr, ptr0, len0, value);
    }
    /**
     * Set an automatable global parameter without string marshaling.
     * @param {number} param_id
     * @param {number} value
     */
    set_param_by_id(param_id, value) {
        wasm.toasterinstance_set_param_by_id(this.__wbg_ptr, param_id, value);
    }
}
if (Symbol.dispose) ToasterInstance.prototype[Symbol.dispose] = ToasterInstance.prototype.free;

/**
 * @param {Float32Array} samples
 * @param {number} sample_rate
 * @returns {string}
 */
export function analyze_pitch_wasm(samples, sample_rate) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.analyze_pitch_wasm(ptr0, len0, sample_rate);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * @param {Float32Array} samples
 * @param {number} sample_rate
 * @param {string} segments_json
 * @param {string} contour_json
 * @returns {Float32Array}
 */
export function commit_pitch_edit_wasm(samples, sample_rate, segments_json, contour_json) {
    const ptr0 = passArrayF32ToWasm0(samples, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(segments_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(contour_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.commit_pitch_edit_wasm(ptr0, len0, sample_rate, ptr1, len1, ptr2, len2);
    var v4 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
}

/**
 * Install `console_error_panic_hook` once at wasm module init so a Rust panic
 * surfaces a readable message on the JS console instead of an opaque
 * `unreachable` trap that silently poisons the AudioWorklet instance (WB-6).
 * Wasm-only by construction; the native build is unaffected.
 */
export function init_panic_hook() {
    wasm.init_panic_hook();
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./daw_dsp_bg.js": import0,
    };
}

const BacteriaInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_bacteriainstance_free(ptr, 1));
const CrumbsInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_crumbsinstance_free(ptr, 1));
const CrustInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_crustinstance_free(ptr, 1));
const FermenterInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_fermenterinstance_free(ptr, 1));
const GlutenInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gluteninstance_free(ptr, 1));
const GrandBouleInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_grandbouleinstance_free(ptr, 1));
const GrinderInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_grinderinstance_free(ptr, 1));
const KneadInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_kneadinstance_free(ptr, 1));
const LevainInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_levaininstance_free(ptr, 1));
const ProofInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_proofinstance_free(ptr, 1));
const ToasterInstanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_toasterinstance_free(ptr, 1));

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('daw_dsp_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
