//! Fermenter — Sourdaw's master synthesizer engine.
//!
//! Compiles to both native (Rust library) and WASM (AudioWorklet).
//! All DSP is lock-free, allocation-free in the audio path.

pub mod additive;
pub mod chaos;
pub mod effects;
pub mod envelope;
pub mod filter;
pub mod fm;
pub mod granular;
pub mod layer;
pub mod lfo;
pub mod modulation;
pub mod mseg;
pub mod noise;
pub mod oscillator;
pub mod params;
pub mod physical;
pub mod sampler;
pub mod spectral;
pub mod stepseq;
pub mod synth;
pub mod voice;

use crate::primitives::{sanitize_block, ProcessLifecycle};
use synth::{
    MasterSynth, MidiEvent, MIDI_EVENT_NOTE_EXPRESSION, MIDI_EVENT_NOTE_OFF, MIDI_EVENT_NOTE_ON,
};
use wasm_bindgen::prelude::*;

/// Events the engine can hold for one render block.
///
/// Fixed and preallocated: the audio thread must not allocate, so the list is a
/// plain array rather than a `Vec` that could grow inside `push_*`. 256 events
/// in a 128-frame block is two per sample. Past it the `push_*` methods return
/// `false` instead of dropping anything, so the caller carries the remainder
/// into the next block — the ceiling delays events, it does not lose them.
const MAX_BLOCK_EVENTS: usize = 256;

/// Offline/scheduled automation ordinals, mirrored by
/// `FERMENTER_AUTOMATION_PARAM_IDS` in
/// `src/modules/AudioEngine/models/FermenterAutomationParams.ts`.
///
/// This covers 104 of the 105 parameters the Fermenter descriptor declares
/// automatable. One is deliberately absent because **no two values of it render
/// differently**, so the behavioural pin below could not fail:
///
///  - `active_layer` writes no DSP state. `MasterSynth::set_param` reads it only
///    to route *subsequent* writes to a layer; neither `note_on_with_channel`
///    nor `render_layers` consults it. Binding it would also make every other
///    scheduled lane's destination depend on schedule ordering.
///
/// The two tables use different spellings on purpose (`osc_level`/`oscLevel`,
/// `mod_lfo_to_pitch`/`lfoPitchAmount`), so their only contract is that index
/// `n` names the same parameter on both sides. Nothing in either language
/// type-checks that, and no test in this crate can see a transposition.
///
/// The contract is enforced from TypeScript, against the shipped binary, by
/// `src/modules/AudioEngine/wasm/__tests__/dawDspFermenterAutomationOrdinals.spec.ts`:
/// it reproduces each Rust name here from the TS key through the production
/// `mapFermenterParamToDspParam` translation and asserts `set_param_by_id(n, v)`
/// renders identically to `set_param(name, v)`. Editing this array without
/// making the matching edit to `FERMENTER_AUTOMATION_PARAM_IDS` fails there.
const AUTOMATION_PARAM_NAMES: [&str; 104] = [
    "osc_level",
    "cutoff",
    "resonance",
    "lfo_rate",
    "lfo_filter_amount",
    "mod_lfo_to_pitch",
    "mod_env_to_filter",
    "mseg_to_filter",
    "unison_spread",
    "fm_level2",
    "fm_feedback",
    "noise_level",
    "grain_density",
    "grain_size",
    "grain_spray",
    "osc_waveform",
    "engine",
    "osc_coarse",
    "osc_fine",
    "pulse_width",
    "unison_voices",
    "unison_detune",
    "noise_color",
    "drift",
    "warp_mode",
    "warp_amount",
    "audio_mod_rate",
    "audio_mod_depth",
    "audio_mod_target",
    "additive_partials",
    "additive_tilt",
    "additive_odd",
    "additive_inharm",
    "ks_damping",
    "ks_brightness",
    "grain_position",
    "grain_pitch_var",
    "sampler_mode",
    "sampler_start",
    "sampler_end",
    "voice_drive",
    "filter_model",
    "filter_mode",
    "filter_drive",
    "filter_keytrack",
    "fm_algorithm",
    "fm_ratio1",
    "fm_ratio2",
    "fm_ratio3",
    "fm_ratio4",
    "fm_level1",
    "fm_level3",
    "fm_level4",
    "fm_mod_amount",
    "amp_attack",
    "amp_decay",
    "amp_sustain",
    "amp_release",
    "filter_attack",
    "filter_decay",
    "filter_sustain",
    "filter_release",
    "lfo_shape",
    "seq_rate",
    "seq_to_pitch",
    "portamento",
    "reverb_type",
    "reverb_mix",
    "reverb_decay",
    "eq_low_freq",
    "eq_low_gain",
    "eq_low_q",
    "eq_mid_freq",
    "eq_mid_gain",
    "eq_mid_q",
    "eq_high_freq",
    "eq_high_gain",
    "eq_high_q",
    "delay_time",
    "delay_feedback",
    "delay_mix",
    "chorus_rate",
    "chorus_depth",
    "chorus_mix",
    "phaser_rate",
    "phaser_depth",
    "phaser_mix",
    "dist_drive",
    "dist_tone",
    "dist_mix",
    "comp_threshold",
    "comp_ratio",
    "comp_attack",
    "comp_release",
    "comp_mix",
    "stereo_width",
    "num_layers",
    "layer_level",
    "layer_pan",
    "chaos_amount",
    "chaos_speed",
    "master_gain",
    "portamento_mode",
    "grain_pan_spread",
];

/// WASM-exported Fermenter instance for AudioWorklet.
#[wasm_bindgen]
pub struct FermenterInstance {
    synth: MasterSynth,
    left_buf: Vec<f32>,
    right_buf: Vec<f32>,
    /// Events queued for the next `process`, in the order they were pushed.
    events: [MidiEvent; MAX_BLOCK_EVENTS],
    event_count: usize,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl FermenterInstance {
    #[wasm_bindgen(constructor)]
    /// `max_voices` is the instance-wide playable note-voice ceiling, clamped
    /// to 1..=64 across all layers. Each voice can render up to 16 unison
    /// oscillators; bounded steal tails overlap only for de-clicking.
    pub fn new(sample_rate: f32, max_voices: u32) -> Self {
        let block_size = 128;
        Self {
            synth: MasterSynth::new(sample_rate, max_voices as usize),
            left_buf: vec![0.0; block_size],
            right_buf: vec![0.0; block_size],
            events: [MidiEvent::default(); MAX_BLOCK_EVENTS],
            event_count: 0,
            nan_flush_count: 0,
        }
    }

    /// Set a named parameter value.
    pub fn set_param(&mut self, name: &str, value: f32) {
        self.synth.set_param(name, value);
    }

    /// Set a supported automation parameter without crossing the WASM string bridge.
    pub fn set_param_by_id(&mut self, param_id: u32, value: f32) {
        if let Some(name) = AUTOMATION_PARAM_NAMES.get(param_id as usize) {
            self.synth.set_param(name, value);
        }
    }

    /// Process a MIDI note on event.
    pub fn note_on(&mut self, note: u8, velocity: u8) {
        self.synth.note_on(note, velocity);
    }

    /// Process a MIDI note on carrying its MPE member channel.
    pub fn note_on_with_channel(&mut self, note: u8, velocity: u8, channel: u8) {
        self.synth.note_on_with_channel(note, velocity, channel);
    }

    /// Process a MIDI note off event. Releases every voice at that pitch.
    pub fn note_off(&mut self, note: u8) {
        self.synth.note_off(note);
    }

    /// Note-off narrowed to one MPE member channel, so releasing a note on one
    /// member channel cannot silence a different note sounding the same pitch
    /// on another (audit MD-2).
    pub fn note_off_on_channel(&mut self, note: u8, channel: u8) {
        self.synth.note_off_matching(note, Some(channel));
    }

    /// Apply MPE per-note expression to the voices held on `channel` at `note`
    /// (audit MD-2).
    ///
    /// `bend_semitones` is the member-channel pitch bend already resolved
    /// against the controller's bend range; `pressure` is 0..1; `slide` is the
    /// CC74 timbre as -1..1 with 0 neutral. Normalisation from wire units lives
    /// on the TypeScript side so the live and scheduled paths share one
    /// conversion.
    pub fn note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        self.synth
            .note_expression(note, channel, bend_semitones, pressure, slide);
    }

    /// Queue a note-on at `offset` samples into the next rendered block.
    ///
    /// Returns `false` when the block's event list is full, so the caller can
    /// hold the event back for the next block instead of losing it. Events must
    /// be pushed in non-decreasing `offset` order — the engine applies them in
    /// the order given and never sorts, so a note-off and a re-trigger of one
    /// pitch on the same sample keep the sequence the caller intended.
    pub fn push_note_on(&mut self, note: u8, velocity: u8, channel: u8, offset: u32) -> bool {
        self.push_event(MidiEvent {
            kind: MIDI_EVENT_NOTE_ON,
            note,
            velocity,
            channel: Some(channel),
            offset,
            ..MidiEvent::default()
        })
    }

    /// Queue a note-off releasing every voice at `note`, at `offset` samples
    /// into the next rendered block.
    pub fn push_note_off(&mut self, note: u8, offset: u32) -> bool {
        self.push_event(MidiEvent {
            kind: MIDI_EVENT_NOTE_OFF,
            note,
            offset,
            ..MidiEvent::default()
        })
    }

    /// Queue a note-off narrowed to one MPE member channel (audit MD-2).
    pub fn push_note_off_on_channel(&mut self, note: u8, channel: u8, offset: u32) -> bool {
        self.push_event(MidiEvent {
            kind: MIDI_EVENT_NOTE_OFF,
            note,
            channel: Some(channel),
            offset,
            ..MidiEvent::default()
        })
    }

    /// Queue MPE per-note expression at `offset` samples into the next block.
    pub fn push_note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
        offset: u32,
    ) -> bool {
        self.push_event(MidiEvent {
            kind: MIDI_EVENT_NOTE_EXPRESSION,
            note,
            channel: Some(channel),
            bend_semitones,
            pressure,
            slide,
            offset,
            ..MidiEvent::default()
        })
    }

    /// Process a block of 128 samples. Returns pointer to left channel.
    /// Caller reads left + right from WASM memory.
    ///
    /// Consumes every event queued since the last call, splitting the render at
    /// each event's sample offset, and empties the list.
    pub fn process(&mut self, block_size: u32) -> *const f32 {
        let size = (block_size as usize).min(self.left_buf.len());
        self.left_buf[..size].fill(0.0);
        self.right_buf[..size].fill(0.0);

        let event_count = self.event_count;
        self.event_count = 0;
        self.synth.process_block(
            &mut self.left_buf[..size],
            &mut self.right_buf[..size],
            &self.events[..event_count],
        );

        self.nan_flush_count += sanitize_block(&mut self.left_buf[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.right_buf[..size]) as u64;

        self.left_buf.as_ptr()
    }

    /// Advance control-rate smoothing while DSP is asleep.
    pub fn advance_silence(&mut self) {
        self.synth.advance_silent_block();
    }

    /// Stable numeric lifecycle code consumed by the AudioWorklet host.
    pub fn lifecycle_state(&self) -> u32 {
        if self.event_count > 0 {
            return ProcessLifecycle::CONTINUE_CODE;
        }
        self.synth.lifecycle().code()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    /// Get pointer to right channel buffer (call after process).
    pub fn get_right_ptr(&self) -> *const f32 {
        self.right_buf.as_ptr()
    }

    /// Get number of currently sounding voices.
    pub fn active_voices(&self) -> u32 {
        self.synth.active_voice_count() as u32
    }
}

impl FermenterInstance {
    /// Append to the block's event list. Bounded by `MAX_BLOCK_EVENTS`, so this
    /// writes into already-owned storage and never allocates.
    fn push_event(&mut self, event: MidiEvent) -> bool {
        if self.event_count >= MAX_BLOCK_EVENTS {
            return false;
        }
        self.events[self.event_count] = event;
        self.event_count += 1;
        true
    }
}

#[cfg(test)]
mod tests {
    use assert_no_alloc::assert_no_alloc;

    use super::{FermenterInstance, MAX_BLOCK_EVENTS};
    use crate::primitives::ProcessLifecycle;

    /// Index of the first sample the instance rendered as non-zero.
    fn first_sounding_sample(instance: &FermenterInstance, size: usize) -> Option<usize> {
        (0..size).find(|&index| instance.left_buf[index] != 0.0 || instance.right_buf[index] != 0.0)
    }

    /// Render one note through a freshly configured instance, four blocks deep.
    fn render_configured<F: FnOnce(&mut FermenterInstance)>(configure: F) -> Vec<f32> {
        let mut instance = FermenterInstance::new(48_000.0, 8);
        configure(&mut instance);
        instance.note_on(60, 100);
        let mut rendered = Vec::with_capacity(512);
        for _ in 0..4 {
            instance.process(128);
            rendered.extend_from_slice(&instance.left_buf[..128]);
        }
        rendered
    }

    fn energy(samples: &[f32]) -> f32 {
        samples.iter().map(|sample| sample * sample).sum()
    }

    fn difference(left: &[f32], right: &[f32]) -> f32 {
        left.iter()
            .zip(right.iter())
            .map(|(a, b)| (a - b) * (a - b))
            .sum()
    }

    /// **This covers ordinal 15 only, and is not the ordinal pin.**
    ///
    /// The whole map is pinned on the TypeScript side by
    /// `src/modules/AudioEngine/wasm/__tests__/dawDspFermenterAutomationOrdinals.spec.ts`,
    /// which drives every ordinal through the *shipped binary* and compares it
    /// against `set_param` under the name the production translation derives.
    /// That is the guard a transposition has to get past; this one is a fast
    /// native-side check that does not need a wasm build.
    ///
    /// Be precise about what it does and does not catch: transposing entries
    /// **other than 15** leaves this test — and the entire crate suite — green.
    /// Swapping ordinals 0 and 1 (`osc_level`/`cutoff`, an automated level ride
    /// bouncing as a filter sweep) was measured at `508 passed; 0 failed`,
    /// exit 0, while the TypeScript pin failed on both rows.
    ///
    /// Drives between waveform 0 (sine) and 2 (square). Neither is the engine's
    /// constructed default of 1 (saw), so an ordinal that reaches nothing
    /// renders both positions as saw and both assertions below go red.
    #[test]
    fn automation_ordinal_15_reaches_the_oscillator_waveform_and_no_other_parameter() {
        let by_id_sine = render_configured(|instance| instance.set_param_by_id(15, 0.0));
        let by_id_square = render_configured(|instance| instance.set_param_by_id(15, 2.0));
        let by_name_sine = render_configured(|instance| instance.set_param("osc_waveform", 0.0));
        let by_name_square = render_configured(|instance| instance.set_param("osc_waveform", 2.0));

        assert!(
            energy(&by_id_sine) > 0.001 && energy(&by_id_square) > 0.001,
            "the instance rendered silence, so neither assertion below means anything"
        );
        // The ordinal moves the render at all.
        assert!(
            difference(&by_id_sine, &by_id_square) > 0.01,
            "set_param_by_id(15, ..) did not change the rendered signal: ordinal 15 is dead"
        );
        // ...and it moves *this* parameter. A transposition inside
        // AUTOMATION_PARAM_NAMES leaves the two by-id renders at the default
        // saw table while the by-name renders still switch, so these diverge.
        assert_eq!(
            by_id_sine, by_name_sine,
            "ordinal 15 and set_param(\"osc_waveform\") disagree at waveform 0"
        );
        assert_eq!(
            by_id_square, by_name_square,
            "ordinal 15 and set_param(\"osc_waveform\") disagree at waveform 2"
        );
    }

    #[test]
    fn a_pushed_note_starts_on_its_own_sample_not_on_the_block_boundary() {
        // 37 is deliberately not a multiple of anything: the whole defect was
        // that `process` passed an empty event slice, so every scheduled note
        // collapsed onto sample 0 of the block.
        for offset in [0_u32, 1, 37, 64, 101, 127] {
            let mut instance = FermenterInstance::new(48_000.0, 8);

            assert!(instance.push_note_on(60, 100, 0, offset));
            instance.process(128);

            assert_eq!(
                first_sounding_sample(&instance, 128),
                Some(offset as usize),
                "note pushed at sample {offset} did not start there"
            );
        }
    }

    #[test]
    fn the_event_list_is_consumed_by_the_block_that_renders_it() {
        let mut instance = FermenterInstance::new(48_000.0, 8);
        instance.push_note_on(60, 100, 0, 64);

        instance.process(128);
        let voices_after_first_block = instance.active_voices();
        instance.process(128);

        // A list left un-emptied would re-apply the note-on and allocate a
        // second voice; a continuing block also renders from its first sample
        // rather than restarting at offset 64.
        assert_eq!(voices_after_first_block, 1);
        assert_eq!(instance.active_voices(), 1);
        assert_eq!(first_sounding_sample(&instance, 128), Some(0));
    }

    #[test]
    fn push_reports_a_full_block_event_list_instead_of_growing_it() {
        let mut instance = FermenterInstance::new(48_000.0, 8);

        for index in 0..MAX_BLOCK_EVENTS {
            assert!(
                instance.push_note_on(60, 100, 0, 0),
                "event {index} was refused below capacity"
            );
        }

        assert!(!instance.push_note_on(60, 100, 0, 0));
        assert!(!instance.push_note_off(60, 0));
        assert!(!instance.push_note_off_on_channel(60, 1, 0));
        assert!(!instance.push_note_expression(60, 0, 1.0, 0.5, 0.0, 0));

        // The refusal is per block: rendering clears the list and the next push
        // is accepted again.
        instance.process(128);
        assert!(instance.push_note_on(62, 100, 0, 0));
    }

    #[test]
    fn a_sleeping_instance_wakes_for_a_pending_offset_event() {
        let mut instance = FermenterInstance::new(48_000.0, 8);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        assert!(instance.push_note_on(60, 100, 0, 37));
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);
        instance.process(128);

        assert_eq!(first_sounding_sample(&instance, 128), Some(37));
    }

    #[test]
    fn numeric_automation_setter_does_not_allocate() {
        let mut instance = FermenterInstance::new(48_000.0, 32);
        assert_no_alloc(|| {
            for param_id in 0..15 {
                instance.set_param_by_id(param_id, 0.5);
            }
            instance.set_param_by_id(u32::MAX, 0.5);
        });
    }

    #[test]
    fn lifecycle_sleeps_cold_wakes_for_note_and_preserves_default_reverb_tail() {
        let mut instance = FermenterInstance::new(48_000.0, 32);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        instance.note_on(60, 100);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);
        instance.process(128);
        instance.note_off(60);

        let mut observed_tail = false;
        for _ in 0..4_000 {
            instance.process(128);
            let state = instance.lifecycle_state();
            observed_tail |= state == ProcessLifecycle::CONTINUE_IF_NOT_QUIET_CODE
                || state == ProcessLifecycle::TAIL_CODE;
            if state == ProcessLifecycle::SLEEP_CODE {
                break;
            }
        }

        assert!(observed_tail);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::SLEEP_CODE);

        let left_ptr = instance.process(128);
        let right_ptr = instance.get_right_ptr();
        let left = unsafe { std::slice::from_raw_parts(left_ptr, 128) };
        let right = unsafe { std::slice::from_raw_parts(right_ptr, 128) };
        let peak = left
            .iter()
            .chain(right)
            .fold(0.0f32, |current, sample| current.max(sample.abs()));
        assert!(
            peak <= 3.162_277_6e-8,
            "post-sleep peak {peak} exceeded the lifecycle quiet threshold"
        );

        instance.note_on(67, 90);
        assert_eq!(instance.lifecycle_state(), ProcessLifecycle::CONTINUE_CODE);
    }

    #[test]
    fn lifecycle_queries_and_silent_advance_do_not_allocate() {
        let mut instance = FermenterInstance::new(48_000.0, 32);

        assert_no_alloc(|| {
            for _ in 0..1_024 {
                let _ = instance.lifecycle_state();
                instance.advance_silence();
            }
        });
    }
}
