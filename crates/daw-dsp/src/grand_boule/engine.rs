//! Top-level Grand Boule piano engine.
//!
//! Owns the voice pool plus every shared DSP block (pedals, soundboard,
//! sympathetic bank, mechanical noise, attack samples) and drives the
//! per-block render loop.

use super::attack_sampler::AttackSampleSet;
use super::mechanical_noise::{MechanicalNoise, NoiseEvent};
use super::parameters::{
    key_fundamental_hz, midi_to_key, railsback_smooth_cents, temperament_offset_cents, Temperament,
};
use super::pedals::{PedalState, UNA_CORDA_SYMPATHETIC_COUPLING};
use super::radiation::RadiationModel;
use super::soundboard::{RenderedBridgeSignal, Soundboard};
use super::sympathetic::Sympathetic;
use super::voice::{PianoVoice, PianoVoiceStart, VoiceQuality};
use crate::primitives::ProcessLifecycle;

/// Default voice-pool size for this scaffolding slice.
pub const DEFAULT_VOICE_COUNT: usize = 32;

/// Hard upper bound the engine will honour at construction time.
pub const MAX_VOICE_COUNT: usize = 256;

const OUTPUT_QUIET_THRESHOLD: f32 = 3.162_277_6e-8;
const QUIET_BLOCKS_BEFORE_SLEEP: u8 = 4;

#[derive(Clone, Copy)]
pub struct PerNoteValues {
    pub hammer_hardness: f32,
    pub hammer_mass: f32,
    pub string_stiffness: f32,
    pub bridge_coupling: f32,
    pub damper_firmness: f32,
    pub sympathetic_gain: f32,
    pub strike_position: f32,
    pub tone_brightness: f32,
}

impl Default for PerNoteValues {
    fn default() -> Self {
        Self {
            hammer_hardness: 1.0,
            hammer_mass: 1.0,
            string_stiffness: 1.0,
            bridge_coupling: 1.0,
            damper_firmness: 1.0,
            sympathetic_gain: 1.0,
            strike_position: 1.0,
            tone_brightness: 1.0,
        }
    }
}

pub struct GrandBouleEngine {
    voices: Vec<PianoVoice>,
    /// Preallocated outgoing voices used only during the one-millisecond
    /// crossfade after a steal. Keeping one slot per playable voice makes the
    /// transition allocation-free and leaves the configured voice cap intact.
    steal_tails: Vec<PianoVoice>,
    /// Dense indices of tails currently fading. Capacity is fixed alongside
    /// the tail pool, so steals can activate and retire tails without scanning
    /// every idle slot in the per-sample loop or growing storage.
    active_steal_tails: Vec<usize>,
    pedals: PedalState,
    soundboard: Soundboard,
    radiation: RadiationModel,
    sympathetic: Sympathetic,
    noise: MechanicalNoise,
    attack_samples: AttackSampleSet,
    master_gain: f32,
    /// Send amount into the soundboard (0..1).
    soundboard_send: f32,
    /// Send amount into the sympathetic bank (0..1).
    sympathetic_send: f32,
    /// Hammer hardness offset from preset (-1..+1, 0 = neutral).
    hammer_hardness_offset: f32,
    /// Overall tone tilt from preset (-1..+1).
    tone_tilt: f32,
    /// Stereo width (0..1).
    stereo_width: f32,
    /// Velocity curve exponent (0.5 = compressed, 1.0 = linear, 2.0 = expanded).
    velocity_curve: f32,
    sample_rate: f32,
    /// Active historical temperament.
    temperament: Temperament,
    // --- Product voicing parameters (morph system) ---
    /// Hammer stiffness multiplier from product voicing (0.5..2.0, 1.0 = neutral).
    hammer_hardness_scale: f32,
    /// Hammer mass multiplier from product voicing (0.5..2.0, 1.0 = neutral).
    hammer_mass_scale: f32,
    /// Crossfade between the fixed warm and open body FIR kernels (0..1).
    soundboard_brightness: f32,
    /// MPE member channel the in-flight note-on belongs to (audit MD-2).
    /// `note_on_with_pitch` has three voice-allocation exits; rather than
    /// thread the channel through all of them, `note_on_with_channel` sets this
    /// for the duration of one call. Defaults to 0 (non-MPE).
    pending_channel: u8,
    /// Sympathetic resonance level from product voicing (0..1).
    sympathetic_level: f32,
    /// Late body diffusion gain from product voicing (0..1).
    body_resonance: f32,
    /// Early-to-diffuse body crossfade from product voicing (-1..+1).
    tone_color: f32,
    /// Multiplier for the project-authored stretched-tuning curve. 0.0
    /// disables smooth stretch, 1.0 applies the default project curve, and
    /// values above 1.0 exaggerate it. Per-note variation stays unchanged.
    stretch_amount: f32,
    /// Velocity multiplier for the string-precursor "bite" noise burst.
    /// 0.0 disables the burst entirely, 1.0 = neutral (matches the
    /// hammer's actual MIDI velocity), > 1.0 over-emphasises the chirp.
    attack_bite: f32,
    /// Rendering tier every voice is configured with. Held on the engine so a
    /// voice taken from the pool later inherits the current setting.
    voice_quality: VoiceQuality,
    /// Consecutive complete output blocks below -150 dBFS.
    quiet_block_count: u8,
}

impl GrandBouleEngine {
    pub fn new(sample_rate: f32, voice_count: usize) -> Self {
        let count = voice_count.clamp(1, MAX_VOICE_COUNT);
        let mut voices = Vec::with_capacity(count);
        let mut steal_tails = Vec::with_capacity(count);
        for _ in 0..count {
            voices.push(PianoVoice::new(sample_rate));
            steal_tails.push(PianoVoice::new(sample_rate));
        }
        Self {
            voices,
            steal_tails,
            active_steal_tails: Vec::with_capacity(count),
            pedals: PedalState::new(),
            soundboard: Soundboard::new(sample_rate),
            radiation: RadiationModel::new(sample_rate),
            sympathetic: Sympathetic::new(sample_rate),
            noise: MechanicalNoise::new(sample_rate),
            attack_samples: AttackSampleSet::new(),
            master_gain: 0.15,
            soundboard_send: 0.6,
            sympathetic_send: 0.25,
            hammer_hardness_offset: 0.0,
            tone_tilt: 0.0,
            stereo_width: 0.6,
            velocity_curve: 1.0,
            sample_rate,
            temperament: Temperament::Equal,
            hammer_hardness_scale: 1.0,
            hammer_mass_scale: 1.0,
            soundboard_brightness: 0.55,
            pending_channel: 0,
            sympathetic_level: 0.5,
            body_resonance: 0.6,
            tone_color: 0.0,
            stretch_amount: 1.0,
            attack_bite: 1.0,
            voice_quality: VoiceQuality::Standard,
            quiet_block_count: QUIET_BLOCKS_BEFORE_SLEEP,
        }
    }

    /// Rendering tier currently configured for the voice pool.
    pub fn voice_quality(&self) -> VoiceQuality {
        self.voice_quality
    }

    /// Select the hammer/string rendering tier for every voice.
    ///
    /// Applied to the steal-tail slots as well as the playable pool: a steal
    /// swaps a tail slot into the pool, so a slot left on the old tier would
    /// hand the wrong quality to the next note struck through it. Sounding
    /// voices only record the configuration — swapping the physics model under
    /// a live string state is an audible discontinuity, so they finish on the
    /// tier they were struck with and the next strike picks up the new one.
    pub fn set_voice_quality(&mut self, quality: VoiceQuality) {
        self.voice_quality = quality;
        for voice in self.voices.iter_mut() {
            if voice.is_idle() {
                voice.set_quality(quality);
            } else {
                voice.set_configured_quality(quality);
            }
        }
        for tail in self.steal_tails.iter_mut() {
            if tail.is_idle() {
                tail.set_quality(quality);
            } else {
                tail.set_configured_quality(quality);
            }
        }
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    pub fn voice_count(&self) -> usize {
        self.voices.len()
    }

    pub fn pedals(&self) -> &PedalState {
        &self.pedals
    }

    pub fn attack_samples_mut(&mut self) -> &mut AttackSampleSet {
        &mut self.attack_samples
    }

    /// Trigger a note-on. Notes outside A0..C8 are ignored silently.
    pub fn note_on(&mut self, midi_note: u8, velocity: f32) {
        self.note_on_with_pitch(midi_note, velocity, 1.0);
    }

    /// Note-on carrying the MPE member channel that owns the note.
    /// Channel 0 is the non-MPE default and what `note_on` uses.
    pub fn note_on_with_channel(&mut self, midi_note: u8, velocity: f32, channel: u8) {
        self.pending_channel = channel;
        self.note_on_with_pitch(midi_note, velocity, 1.0);
        self.pending_channel = 0;
    }

    /// Trigger a note-on with a microtuning frequency ratio. `pitch_ratio`
    /// = 1.0 is standard Railsback tuning; `2^(cents/1200)` otherwise.
    pub fn note_on_with_pitch(&mut self, midi_note: u8, velocity: f32, pitch_ratio: f32) {
        let Some(key) = midi_to_key(midi_note) else {
            return;
        };
        self.quiet_block_count = 0;
        // Apply velocity curve shaping: v' = v^exponent.
        let shaped_velocity = velocity.clamp(0.0, 1.0).powf(self.velocity_curve);
        // Apply historical temperament offset on top of the caller's pitch ratio.
        let temperament_cents = temperament_offset_cents(self.temperament, midi_note);
        let temperament_ratio = (2.0_f32).powf(temperament_cents / 1200.0);
        // Scale the project stretch curve by the configured amount. The base
        // key frequency already carries one copy, so apply only the residual
        // `(stretch_amount - 1)` contribution here.
        let smooth_cents = railsback_smooth_cents(key);
        let stretch_offset_cents = (self.stretch_amount - 1.0) * smooth_cents;
        let stretch_ratio = (2.0_f32).powf(stretch_offset_cents / 1200.0);
        let combined_ratio = pitch_ratio * temperament_ratio * stretch_ratio;
        // Combine una-corda pedal scale, preset hammer hardness offset, and
        // piano model hammer scale. offset -1 → 0.5×, 0 → 1×, +1 → 2×.
        let hardness_scale = (2.0_f32).powf(self.hammer_hardness_offset);
        let stiffness_scale =
            self.pedals.hammer_stiffness_scale() * hardness_scale * self.hammer_hardness_scale;
        let mass_scale = self.hammer_mass_scale;
        self.pedals.press_key(key);
        self.noise.trigger(NoiseEvent::KeyDown, shaped_velocity);
        self.noise
            .trigger(NoiseEvent::HammerLetoff, shaped_velocity);
        // String-precursor "bite": a longitudinal pulse that
        // reaches the bridge before the transverse wave. Velocity-scaled
        // so soft notes barely whisper it but ff hits get a clear chirp.
        // The `attack_bite` user knob multiplies that velocity, letting
        // listeners dial the chirp from off (0.0) through neutral (1.0)
        // to over-emphasised (2.0).
        let bite_velocity = (shaped_velocity * self.attack_bite).clamp(0.0, 1.0);
        if bite_velocity > 0.0 {
            self.noise
                .trigger(NoiseEvent::StringPrecursor, bite_velocity);
        }

        let start = PianoVoiceStart {
            midi_note,
            channel: self.pending_channel,
            velocity: shaped_velocity,
            key,
            pitch_ratio: combined_ratio,
            stiffness_scale,
            mass_scale,
            attack_length: self.attack_samples.length_for_key(key),
        };

        // Retrigger only the same MIDI identity. Distinct MPE member channels
        // may concurrently own the same pitch and must remain independently
        // addressable for expression and release.
        for voice in self.voices.iter_mut() {
            if !voice.is_idle()
                && voice.midi_note() == midi_note
                && voice.channel() == self.pending_channel
            {
                voice.note_on(start);
                return;
            }
        }

        // Steal the lowest-priority active voice when the pool is full.
        let (highest_midi, lowest_midi) = self.extreme_notes();
        let mut victim_index: Option<usize> = None;
        let mut best_priority: Option<(u8, u8, u64)> = None;
        for (index, voice) in self.voices.iter().enumerate() {
            let note = voice.midi_note();
            if !voice.is_idle() && (note == highest_midi || note == lowest_midi) {
                continue;
            }
            let (class, age) = voice.steal_priority();
            let priority = (u8::from(voice.is_idle()), class, age);
            if best_priority.is_none() || Some(priority) > best_priority {
                best_priority = Some(priority);
                victim_index = Some(index);
            }
        }
        if victim_index.is_none() {
            for (index, voice) in self.voices.iter().enumerate() {
                let (class, age) = voice.steal_priority();
                let priority = (u8::from(voice.is_idle()), class, age);
                if best_priority.is_none() || Some(priority) > best_priority {
                    best_priority = Some(priority);
                    victim_index = Some(index);
                }
            }
        }
        let Some(index) = victim_index else {
            return;
        };
        if self.voices[index].is_idle() {
            self.voices[index].note_on(start);
            return;
        }

        // The incoming note starts at the event boundary. The displaced model
        // is moved into a fixed tail slot and remains audible during its short
        // fade, avoiding both a discontinuity and note setup in the inner loop.
        // Tail storage is a pool, not a per-voice pairing. Reusing the
        // victim's numeric slot can truncate an unrelated fade when that slot
        // is occupied even though another preallocated tail is idle.
        let (tail_index, tail_was_idle) = self.select_steal_tail_slot();
        if !tail_was_idle {
            // Every slot is active only during sustained overload. Replacing
            // the quietest fade makes the least audible bounded degradation.
            self.steal_tails[tail_index].kill();
        }
        std::mem::swap(&mut self.voices[index], &mut self.steal_tails[tail_index]);
        self.steal_tails[tail_index].begin_steal();
        if tail_was_idle {
            self.active_steal_tails.push(tail_index);
        }
        self.voices[index].note_on(start);
    }

    /// Select a preallocated crossfade slot without coupling it to the musical
    /// victim. The linear scan is bounded by the configured voice cap and does
    /// not allocate. When every slot is busy, retire the quietest existing fade.
    fn select_steal_tail_slot(&self) -> (usize, bool) {
        let mut quietest_index = 0;
        let mut quietest_amplitude = f32::INFINITY;
        for (index, tail) in self.steal_tails.iter().enumerate() {
            if tail.is_idle() {
                return (index, true);
            }
            let amplitude = tail.amplitude();
            if amplitude.total_cmp(&quietest_amplitude).is_lt() {
                quietest_index = index;
                quietest_amplitude = amplitude;
            }
        }
        (quietest_index, false)
    }

    fn extreme_notes(&self) -> (u8, u8) {
        let mut highest: u8 = 0;
        let mut lowest: u8 = 255;
        for voice in self.voices.iter() {
            if voice.is_idle() {
                continue;
            }
            let note = voice.midi_note();
            if note > highest {
                highest = note;
            }
            if note < lowest {
                lowest = note;
            }
        }
        (highest, lowest)
    }

    pub fn note_off(&mut self, midi_note: u8) {
        self.quiet_block_count = 0;
        if let Some(key) = midi_to_key(midi_note) {
            self.pedals.release_key(key);
            // Apply damping immediately — `apply_damper_state` will pick up
            // the pedal state on the next process iteration.
        }
        let sustain_engaged = self.pedals.sustain_position() > 0.5;
        // The damper-lift thud is the sound of felt landing back on the
        // string. A pedal-held or sostenuto-captured note keeps its damper
        // raised, so no felt lands and no thud belongs in the output.
        let sostenuto_captured = self.voices.iter().any(|voice| {
            !voice.is_idle() && voice.midi_note() == midi_note && voice.is_sostenuto_captured()
        });
        if !sustain_engaged && !sostenuto_captured {
            self.noise.trigger(NoiseEvent::DamperLift, 0.5);
        }
        for voice in self.voices.iter_mut() {
            if voice.is_idle() || voice.midi_note() != midi_note {
                continue;
            }
            if sustain_engaged || voice.is_sostenuto_captured() {
                voice.release_key();
            } else {
                voice.note_off();
            }
        }
    }

    /// Apply the current pedal-state damping to every active voice. Called
    /// once per block to avoid rebuilding coefficients every sample.
    fn apply_damper_state(&mut self) {
        for voice in self.voices.iter_mut() {
            if voice.is_idle() {
                continue;
            }
            let midi = voice.midi_note();
            let Some(key) = midi_to_key(midi) else {
                continue;
            };
            let held = self.pedals.key_is_held(key);
            let damping =
                self.pedals
                    .damper_bandwidth_for_key(key, held, voice.is_sostenuto_captured());
            voice.set_extra_damping(damping);
        }
        self.sympathetic
            .set_damping(self.pedals.sympathetic_damping());
    }

    pub fn set_sustain(&mut self, position: f32) {
        // `note_off` treats > 0.5 as engaged; reuse that threshold so a pedal
        // crossing it downwards releases the voices the pedal was sustaining.
        let was_engaged = self.pedals.sustain_position() > 0.5;
        self.pedals.set_sustain(position);
        let is_engaged = self.pedals.sustain_position() > 0.5;
        if !was_engaged && is_engaged {
            // Pedal-down thump: the whole damper rail lifting off the strings.
            // Fires on the crossing only, not for every CC frame of a held
            // pedal, and never on the way back up.
            self.noise.trigger(NoiseEvent::PedalDown, 0.5);
        }
        if was_engaged && !is_engaged {
            self.release_pedal_sustained_voices();
        }
    }

    /// Sustain pedal lifted: voices held up only by the pedal (key released,
    /// not sostenuto-captured) begin their release, mirroring the `note_off`
    /// sustain decision. Without this their stage stays `Active`, the damper
    /// logic reads them as key-held (0 Hz bandwidth), and they ring undamped.
    /// Physically held keys stay active and release on their own `note_off`.
    fn release_pedal_sustained_voices(&mut self) {
        for voice in self.voices.iter_mut() {
            if voice.stage() != super::voice::VoiceStage::Active {
                continue;
            }
            if voice.is_held() {
                continue;
            }
            if voice.is_sostenuto_captured() {
                continue;
            }
            voice.note_off();
        }
    }

    pub fn set_una_corda(&mut self, engaged: bool) {
        self.pedals.set_una_corda(engaged);
    }

    pub fn set_sostenuto(&mut self, engaged: bool) {
        let was_engaged = self.pedals.sostenuto();
        if engaged && !was_engaged {
            for voice in self.voices.iter_mut() {
                voice.capture_sostenuto();
            }
        }
        self.pedals.set_sostenuto(engaged);
        if was_engaged && !engaged {
            self.release_sostenuto_sustained_voices();
        }
    }

    /// Sostenuto pedal lifted: captured voices whose key is no longer held
    /// begin their release — the same never-release class as the sustain
    /// pedal. Voices the sustain pedal still holds up (past the `note_off`
    /// threshold) stay sustained; physically held keys stay active.
    fn release_sostenuto_sustained_voices(&mut self) {
        for voice in self.voices.iter_mut() {
            let was_captured = voice.release_sostenuto_capture();
            if !was_captured || voice.stage() != super::voice::VoiceStage::Active {
                continue;
            }
            if voice.is_held() {
                continue;
            }
            if self.pedals.sustain_position() > 0.5 {
                continue;
            }
            voice.note_off();
        }
    }

    /// Sympathetic send after the una-corda coupling ratio. The stored send
    /// is never mutated, so disengaging the pedal restores it exactly.
    fn effective_sympathetic_send(&self) -> f32 {
        if self.pedals.una_corda() {
            self.sympathetic_send * UNA_CORDA_SYMPATHETIC_COUPLING
        } else {
            self.sympathetic_send
        }
    }

    pub fn set_temperament(&mut self, temperament: Temperament) {
        self.temperament = temperament;
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        let was_sleeping = self.lifecycle() == ProcessLifecycle::Sleep;
        match name {
            "master_gain" => self.master_gain = value.clamp(0.0, 2.0),
            "soundboard_send" => self.soundboard_send = value.clamp(0.0, 1.0),
            "sympathetic_send" => self.sympathetic_send = value.clamp(0.0, 1.0),
            "lid_position" => {
                self.radiation.set_lid_position(value);
                if was_sleeping {
                    self.radiation.snap_to_target();
                }
            }
            "mic_position" => {
                self.radiation.set_mic_position(value);
                if was_sleeping {
                    self.radiation.snap_to_target();
                }
            }
            "hammer_hardness" => self.hammer_hardness_offset = value.clamp(-1.0, 1.0),
            "tone_tilt" => self.tone_tilt = value.clamp(-1.0, 1.0),
            "stereo_width" => self.stereo_width = value.clamp(0.0, 1.0),
            "velocity_curve" => self.velocity_curve = value.clamp(0.5, 2.0),
            "temperament" => self.temperament = Temperament::from_u8(value as u8),
            "hammer_hardness_scale" => self.hammer_hardness_scale = value.clamp(0.5, 2.0),
            "hammer_mass_scale" => self.hammer_mass_scale = value.clamp(0.5, 2.0),
            "soundboard_brightness" => {
                if value.is_finite() {
                    self.soundboard_brightness = value.clamp(0.0, 1.0);
                    self.soundboard.set_brightness(self.soundboard_brightness);
                }
            }
            "sympathetic_level" => self.sympathetic_level = value.clamp(0.0, 1.0),
            "body_resonance" => {
                if value.is_finite() {
                    self.body_resonance = value.clamp(0.0, 1.0);
                    self.soundboard.set_body_resonance(self.body_resonance);
                }
            }
            "tone_color" => {
                if value.is_finite() {
                    self.tone_color = value.clamp(-1.0, 1.0);
                    self.soundboard.set_tone_color(self.tone_color);
                }
            }
            "stretch_amount" => self.stretch_amount = value.clamp(0.0, 2.0),
            "attack_bite" => self.attack_bite = value.clamp(0.0, 2.0),
            // Voice rendering tier: 0 = Standard (power-law hammer),
            // 1 = High (Stulov hysteresis hammer). Without this the
            // Stulov path was unreachable in the shipped instrument.
            "quality" => {
                let quality = if value >= 0.5 {
                    VoiceQuality::High
                } else {
                    VoiceQuality::Standard
                };
                self.set_voice_quality(quality);
            }
            // Lower edge of the half-pedal damper-lift curve,
            // calibrated per controller from the MIDI calibration panel.
            "sustain_threshold" => self.pedals.set_half_pedal_low(value),
            // Time constant smoothing the continuous sustain controller on its
            // way to the damper curve, also from the calibration panel.
            "cc_smoothing_ms" => self.pedals.set_cc_smoothing_ms(value),
            _ => {}
        }
    }

    /// Render one block of stereo audio. Buffers are mixed into additively.
    /// Apply MPE per-note expression to the voice held on `channel` at `note`
    /// (audit MD-2).
    ///
    /// Only `bend_semitones` is consumed. A struck piano string has no
    /// continuous pressure or timbre response to model — key aftertouch does
    /// not re-excite a string, and the engine has no per-voice brightness
    /// control — so `pressure` and `slide` are accepted and deliberately
    /// dropped rather than faked. The device's expression registry advertises
    /// pitch bend only, so the editor never offers those two lanes here.
    pub fn note_expression(
        &mut self,
        midi_note: u8,
        channel: u8,
        bend_semitones: f32,
        _pressure: f32,
        _slide: f32,
    ) {
        for voice in self.voices.iter_mut() {
            if !voice.is_idle()
                && voice.is_held()
                && voice.midi_note() == midi_note
                && voice.channel() == channel
            {
                voice.set_expression_bend(bend_semitones);
            }
        }
    }

    /// Note-off narrowed to one MPE member channel, so releasing a note on one
    /// member channel cannot silence a different note sounding the same pitch
    /// on another (audit MD-2). The last owner delegates to `note_off`; while a
    /// sibling still holds the pitch, only this voice's key and pedal ownership
    /// transition is applied and aggregate damper state remains held.
    pub fn note_off_on_channel(&mut self, midi_note: u8, channel: u8) {
        let sustain_engaged = self.pedals.sustain_position() > 0.5;
        let mut sounding_on_other_channel = false;
        for voice in self.voices.iter() {
            let current_on_other_channel = !voice.is_idle()
                && voice.is_held()
                && voice.midi_note() == midi_note
                && voice.channel() != channel;
            if current_on_other_channel {
                sounding_on_other_channel = true;
            }
        }
        if !sounding_on_other_channel {
            self.note_off(midi_note);
            return;
        }
        // Another member channel still holds this pitch: release only ours and
        // leave the pedal/damper state alone, since the key is still down.
        for voice in self.voices.iter_mut() {
            if !voice.is_idle()
                && voice.is_held()
                && voice.midi_note() == midi_note
                && voice.channel() == channel
            {
                if sustain_engaged || voice.is_sostenuto_captured() {
                    voice.release_key();
                } else {
                    voice.note_off();
                }
            }
        }
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        let frames = left.len().min(right.len());
        // Advance the continuous-CC smoother before the damper coefficients
        // are rebuilt from it, so a block never renders with a pedal position
        // one block stale.
        self.pedals
            .advance_sustain_smoothing(frames, self.sample_rate);
        self.apply_damper_state();
        // Per-note bend is resolved once per block, and only for voices whose
        // bend actually moved (audit MD-2).
        for voice in self.voices.iter_mut() {
            voice.apply_pending_bend();
        }
        for &index in self.active_steal_tails.iter() {
            self.steal_tails[index].apply_pending_bend();
        }

        for frame in 0..frames {
            // 1. Sum voice outputs into the bridge bus, blending sampled
            //    attack if armed.
            let mut bridge = 0.0_f32;
            for voice in self.voices.iter_mut() {
                let modelled = voice.tick();
                let mixed = if let Some((key, pos, length)) = voice.attack_playhead() {
                    let sample = self.attack_samples.sample(key, pos as usize);
                    let s_gain = AttackSampleSet::sample_gain(pos as usize, length as usize);
                    let m_gain = AttackSampleSet::model_gain(pos as usize, length as usize);
                    voice.advance_attack();
                    modelled * m_gain + sample * s_gain
                } else {
                    modelled
                };
                bridge += mixed;
            }
            let mut tail_position = 0;
            while tail_position < self.active_steal_tails.len() {
                let tail_index = self.active_steal_tails[tail_position];
                let tail = &mut self.steal_tails[tail_index];
                let fade_gain = tail.amplitude();
                let modelled = tail.tick();
                let mixed = if let Some((key, pos, length)) = tail.attack_playhead() {
                    let sample = self.attack_samples.sample(key, pos as usize);
                    let s_gain = AttackSampleSet::sample_gain(pos as usize, length as usize);
                    let m_gain = AttackSampleSet::model_gain(pos as usize, length as usize);
                    tail.advance_attack();
                    modelled * m_gain + sample * s_gain * fade_gain
                } else {
                    modelled
                };
                bridge += mixed;
                if tail.is_idle() {
                    self.active_steal_tails.swap_remove(tail_position);
                } else {
                    tail_position += 1;
                }
            }

            // 2. Sympathetic bank: combine preset send with model level, then
            //    apply the una-corda coupling ratio. The shifted action strikes
            //    two strings of each unison instead of three, so the coupling
            //    into the un-excited strings changes while the pedal is held.
            //    Applied here, where the send is consumed, rather than by
            //    rewriting the stored send — releasing the pedal restores the
            //    user's value exactly.
            let sym_amount = self.effective_sympathetic_send() * self.sympathetic_level * 2.0;
            let sympathetic = self.sympathetic.tick(bridge) * sym_amount;

            // 3. The completed aggregate bridge bus feeds the independent FIR
            //    body once. Soundboard send is strictly the input gain; the
            //    three body controls select already-constructed FIR output.
            let bridge_signal =
                RenderedBridgeSignal::new((bridge + sympathetic) * self.soundboard_send);
            let (sb_l, sb_r) = self.soundboard.process_rendered_bridge(bridge_signal);

            // 4. Mechanical noise is summed at the output (noise-floor layer).
            let noise_sample = self.noise.tick();

            // 5. Dry bridge signal + stereo FIR body + noise. Preset tone tilt
            // remains a dry-path gain; product tone color belongs to the body.
            let dry_gain = (0.4 + self.tone_tilt * 0.2).clamp(0.2, 0.6);
            let mono = bridge * dry_gain + (sb_l + sb_r) * 0.5 + sympathetic + noise_sample;
            let side = (sb_l - sb_r) * 0.5;

            // Stereo width: 0 = mono, 1 = full stereo spread.
            let w = self.stereo_width;
            let (radiated_l, radiated_r) = self.radiation.tick(mono + side * w, mono - side * w);
            let sample_l = radiated_l * self.master_gain;
            let sample_r = radiated_r * self.master_gain;
            left[frame] += sample_l;
            right[frame] += sample_r;
        }

        let output_quiet = left[..frames]
            .iter()
            .chain(&right[..frames])
            .all(|sample| sample.is_finite() && sample.abs() <= OUTPUT_QUIET_THRESHOLD);
        if output_quiet {
            self.quiet_block_count = self.quiet_block_count.saturating_add(1);
        } else {
            self.quiet_block_count = 0;
        }
    }

    pub fn lifecycle(&self) -> ProcessLifecycle {
        if !self.active_steal_tails.is_empty() || self.voices.iter().any(|voice| !voice.is_idle()) {
            return ProcessLifecycle::Continue;
        }
        if self.quiet_block_count < QUIET_BLOCKS_BEFORE_SLEEP {
            return ProcessLifecycle::ContinueIfNotQuiet;
        }
        ProcessLifecycle::Sleep
    }

    /// Inject a microtuning-ready note-on given a MIDI 2.0 Q24 pitch offset
    /// (semitones × 2^24) plus full 16-bit velocity.
    pub fn note_on_midi2(&mut self, midi_note: u8, velocity_16bit: u16, pitch_offset_q24: i32) {
        let velocity = super::midi2::velocity_to_unit(velocity_16bit);
        let ratio = super::midi2::pitch_offset_to_ratio(pitch_offset_q24);
        self.note_on_with_pitch(midi_note, velocity, ratio);
    }

    /// Hard-stop every voice and clear all shared state. Used when the host
    /// panics or the user hits a global panic button.
    pub fn all_notes_off(&mut self) {
        for voice in self.voices.iter_mut() {
            voice.kill();
        }
        for tail in self.steal_tails.iter_mut() {
            tail.kill();
        }
        self.active_steal_tails.clear();
        self.pedals.clear_playing_keys();
        self.soundboard.reset();
        self.radiation.reset();
        self.sympathetic.reset();
        self.noise.reset();
        self.quiet_block_count = QUIET_BLOCKS_BEFORE_SLEEP;
    }

    /// Expose the key fundamental frequency (used by the UI for highlights).
    pub fn key_frequency(&self, key: u32) -> f32 {
        key_fundamental_hz(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Render long enough for every strike burst to finish, so a later burst
    /// count reads only what the event under test triggered.
    ///
    /// 48 blocks of 512 is ~512 ms at 48 kHz. The pedal-down burst is the
    /// longest of these: its 20 ms envelope needs roughly 230 ms to fall
    /// under the shared tail's silence floor, so a 20-block window is not
    /// enough to clear it.
    fn settle_noise(engine: &mut GrandBouleEngine) {
        let mut left = vec![0.0_f32; 512];
        let mut right = vec![0.0_f32; 512];
        for _ in 0..48 {
            left.fill(0.0);
            right.fill(0.0);
            engine.process_block(&mut left, &mut right);
        }
        assert_eq!(
            engine.noise.active_burst_count(),
            0,
            "the strike bursts should have decayed before the event under test"
        );
    }

    /// F7: the Stulov hammer tier had no control reaching it. The param must
    /// configure the whole pool, including the slots a steal rotates in.
    #[test]
    fn quality_param_reaches_every_voice_and_the_ones_struck_later() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        assert_eq!(engine.voice_quality(), VoiceQuality::Standard);

        engine.set_param("quality", 1.0);

        assert_eq!(engine.voice_quality(), VoiceQuality::High);
        assert!(
            engine
                .voices
                .iter()
                .all(|voice| voice.quality() == VoiceQuality::High),
            "every playable voice must take the configured tier"
        );
        assert!(
            engine
                .steal_tails
                .iter()
                .all(|tail| tail.quality() == VoiceQuality::High),
            "a steal rotates a tail slot into the pool; it must carry the tier too"
        );

        engine.note_on(60, 0.8);
        let struck = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .expect("note_on must allocate a voice");
        assert_eq!(
            struck.quality(),
            VoiceQuality::High,
            "a newly struck voice must inherit the engine-level tier"
        );

        engine.set_param("quality", 0.0);
        assert!(
            engine
                .voices
                .iter()
                .filter(|voice| voice.is_idle())
                .all(|voice| voice.quality() == VoiceQuality::Standard),
            "idle voices must take the new tier immediately"
        );
        let sounding = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .expect("the struck voice is still sounding");
        assert_eq!(
            sounding.quality(),
            VoiceQuality::High,
            "a sounding voice keeps the model it was struck with; swapping the \
             physics mid-note is an audible discontinuity"
        );

        engine.note_on(64, 0.8);
        let restruck = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle() && voice.midi_note() == 64)
            .expect("the second strike must allocate a voice");
        assert_eq!(
            restruck.quality(),
            VoiceQuality::Standard,
            "the next strike picks up the tier configured while others sounded"
        );
    }

    /// F13-1: the pedal-down thump was defined and never triggered.
    #[test]
    fn the_sustain_rising_edge_fires_exactly_one_pedal_down_noise() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        assert_eq!(engine.noise.active_burst_count(), 0);

        engine.set_sustain(1.0);
        assert_eq!(
            engine.noise.active_burst_count(),
            1,
            "crossing into engagement must thump once"
        );

        engine.set_sustain(0.9);
        engine.set_sustain(1.0);
        assert_eq!(
            engine.noise.active_burst_count(),
            1,
            "holding the pedal down must not re-trigger the thump"
        );

        engine.set_sustain(0.0);
        assert_eq!(
            engine.noise.active_burst_count(),
            1,
            "lifting the pedal is not a pedal-down event"
        );
    }

    /// F13-2: `UNA_CORDA_SYMPATHETIC_COUPLING` had no use anywhere. It scales
    /// the send at the point of consumption, so the stored value survives.
    #[test]
    fn una_corda_scales_the_sympathetic_send_by_the_coupling_ratio() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.set_param("sympathetic_send", 0.8);
        let open = engine.effective_sympathetic_send();
        assert_eq!(open, 0.8);

        engine.set_una_corda(true);
        assert_eq!(
            engine.effective_sympathetic_send(),
            0.8 * UNA_CORDA_SYMPATHETIC_COUPLING
        );

        engine.set_una_corda(false);
        assert_eq!(
            engine.effective_sympathetic_send(),
            open,
            "releasing the pedal must restore the user's send exactly"
        );
    }

    /// F12: the damper-lift thud fired before the sustain/sostenuto decision,
    /// so a pedal-held note-off got the sound of a damper that never moved.
    #[test]
    fn a_pedal_held_note_off_fires_no_damper_lift_thud() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(60, 0.8);
        engine.set_sustain(1.0);
        settle_noise(&mut engine);

        engine.note_off(60);
        assert_eq!(
            engine.noise.active_burst_count(),
            0,
            "the damper never fell, so nothing should thump"
        );
    }

    #[test]
    fn a_sostenuto_captured_note_off_fires_no_damper_lift_thud() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(60, 0.8);
        engine.set_sostenuto(true);
        settle_noise(&mut engine);

        engine.note_off(60);
        assert_eq!(engine.noise.active_burst_count(), 0);
    }

    #[test]
    fn a_note_off_with_the_pedal_up_fires_the_damper_lift_thud() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(60, 0.8);
        settle_noise(&mut engine);

        engine.note_off(60);
        assert_eq!(
            engine.noise.active_burst_count(),
            1,
            "the damper actually falls here, so it should be heard"
        );
    }

    #[test]
    fn note_on_allocates_voice() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(60, 0.8);
        assert!(engine.voices.iter().any(|voice| !voice.is_idle()));
    }

    #[test]
    fn all_notes_off_preserves_pedal_controller_state() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.set_sustain(0.8);
        engine.set_una_corda(true);
        engine.note_on(60, 0.8);
        engine.set_sostenuto(true);

        engine.all_notes_off();

        assert_eq!(engine.pedals.sustain_position(), 0.8);
        assert!(engine.pedals.una_corda());
        assert!(engine.pedals.sostenuto());
        let key = midi_to_key(60).expect("middle C is in the piano range");
        assert!(!engine.pedals.key_is_held(key));
    }

    #[test]
    fn all_notes_off_kills_preallocated_steal_tails() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        for midi_note in [60, 62, 64, 63] {
            engine.note_on(midi_note, 0.8);
        }
        assert!(engine.steal_tails.iter().any(|tail| !tail.is_idle()));

        engine.all_notes_off();

        assert!(engine.voices.iter().all(PianoVoice::is_idle));
        assert!(engine.steal_tails.iter().all(PianoVoice::is_idle));
        assert!(engine.active_steal_tails.is_empty());
        assert_eq!(engine.lifecycle(), ProcessLifecycle::Sleep);
    }

    #[test]
    fn process_produces_audio() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(69, 1.0);
        let mut left = vec![0.0; 512];
        let mut right = vec![0.0; 512];
        engine.process_block(&mut left, &mut right);
        let peak = left.iter().fold(0.0_f32, |acc, &v| acc.max(v.abs()));
        assert!(peak > 0.0);
    }

    #[test]
    fn soundboard_controls_do_not_change_string_modal_coefficients() {
        let modal_signature = |engine: &GrandBouleEngine| {
            engine
                .voices
                .iter()
                .find(|voice| !voice.is_idle())
                .expect("note-on must configure a string voice")
                .string_modal_coefficient_signature()
        };
        let exercise_mid_note_decay_reset = |engine: &mut GrandBouleEngine| {
            engine.set_sustain(1.0);
            engine.note_on(60, 0.8);
            engine.note_off(60);
            let before_reset = modal_signature(engine);

            // Pedal-up with the key already released is the current engine
            // path that rebuilds a ringing voice's decay coefficients.
            engine.set_sustain(0.0);
            let mut left = [0.0_f32; 16];
            let mut right = [0.0_f32; 16];
            engine.process_block(&mut left, &mut right);
            let after_reset = modal_signature(engine);
            assert_ne!(
                before_reset, after_reset,
                "pedal-driven mid-note decay reset must change the modal signature"
            );
            (before_reset, after_reset)
        };

        let mut neutral = GrandBouleEngine::new(48_000.0, 1);
        let mut altered_soundboard = GrandBouleEngine::new(48_000.0, 1);
        altered_soundboard.set_param("soundboard_send", 0.0);
        altered_soundboard.set_param("soundboard_brightness", 1.0);
        altered_soundboard.set_param("body_resonance", 0.0);
        let _ = altered_soundboard
            .soundboard
            .process_rendered_bridge(RenderedBridgeSignal::new(1.0));

        let (neutral_before_reset, neutral_after_reset) =
            exercise_mid_note_decay_reset(&mut neutral);
        let (altered_before_reset, altered_after_reset) =
            exercise_mid_note_decay_reset(&mut altered_soundboard);
        assert_eq!(
            neutral_before_reset, altered_before_reset,
            "soundboard controls and FIR state must not reach initial string-modal configuration"
        );
        assert_eq!(
            neutral_after_reset, altered_after_reset,
            "soundboard controls and FIR state must not reach pedal-driven string-modal decay reset"
        );
    }

    #[test]
    fn global_soundboard_processes_once_per_frame_after_multiple_voices_render() {
        const FRAMES: usize = 16;

        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(60, 0.8);
        engine.note_on(64, 0.8);
        assert_eq!(
            engine
                .voices
                .iter()
                .filter(|voice| !voice.is_idle())
                .count(),
            2,
            "the proof must render multiple active voices"
        );

        let mut left = [0.0_f32; 1];
        let mut right = [0.0_f32; 1];
        for _ in 0..FRAMES {
            let before = engine.soundboard.rendered_bridge_process_count();
            engine.process_block(&mut left, &mut right);
            let after = engine.soundboard.rendered_bridge_process_count();

            assert_eq!(
                after - before,
                1,
                "the global soundboard must run once per output frame, never once per voice or zero times"
            );
        }
    }

    #[test]
    fn voice_pool_overflow_steals_a_voice() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(60, 0.8);
        engine.note_on(62, 0.8);
        engine.note_on(64, 0.8);
        engine.note_on(66, 0.8);
        engine.note_on(68, 0.8);
        let mut left = [0.0; 64];
        let mut right = [0.0; 64];
        engine.process_block(&mut left, &mut right);
        let midis: Vec<u8> = engine
            .voices
            .iter()
            .map(|voice| voice.midi_note())
            .collect();
        assert!(midis.contains(&68));
    }

    #[test]
    fn repeated_overflow_steals_the_oldest_unprotected_voice() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        for midi_note in [60, 62, 64, 66] {
            engine.note_on(midi_note, 0.8);
        }

        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        engine.process_block(&mut left, &mut right);

        engine.note_on(65, 0.8);
        engine.note_on(63, 0.8);

        let sounding: Vec<u8> = engine
            .voices
            .iter()
            .map(|voice| voice.midi_note())
            .collect();
        assert!(sounding.contains(&65));
        assert!(sounding.contains(&63));
        assert!(!sounding.contains(&64));
        let fading: Vec<u8> = engine
            .steal_tails
            .iter()
            .filter(|voice| !voice.is_idle())
            .map(|voice| voice.midi_note())
            .collect();
        assert_eq!(fading.len(), 2);
        assert!(fading.contains(&62));
        assert!(fading.contains(&64));
    }

    #[test]
    fn released_voice_is_stolen_before_a_held_voice_even_when_its_tail_slot_is_occupied() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        for midi_note in [60, 62, 64, 66] {
            engine.note_on(midi_note, 0.8);
        }
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        engine.process_block(&mut left, &mut right);

        engine.note_on(65, 0.8);
        engine.note_off(65);
        engine.note_on(63, 0.8);

        let sounding: Vec<u8> = engine.voices.iter().map(PianoVoice::midi_note).collect();
        assert!(
            sounding.contains(&64),
            "a held voice must survive a released candidate"
        );
        assert!(
            sounding.contains(&63),
            "the incoming note must start immediately"
        );
        assert!(
            !sounding.contains(&65),
            "the released voice must be the victim"
        );
        let fading: Vec<u8> = engine
            .steal_tails
            .iter()
            .filter(|tail| !tail.is_idle())
            .map(PianoVoice::midi_note)
            .collect();
        assert!(
            fading.contains(&62),
            "the first outgoing tail must keep fading"
        );
        assert!(
            fading.contains(&65),
            "the second victim must get another idle tail slot"
        );
    }

    #[test]
    fn saturated_tail_pool_replaces_only_the_quietest_fade_without_duplicate_membership() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        for midi_note in [50, 60, 70] {
            engine.note_on(midi_note, 0.8);
        }
        let mut left = [0.0; 8];
        let mut right = [0.0; 8];

        engine.note_on(65, 0.8);
        engine.process_block(&mut left, &mut right);
        left.fill(0.0);
        right.fill(0.0);
        engine.note_on(55, 0.8);
        engine.process_block(&mut left, &mut right);
        engine.note_on(68, 0.8);

        let mut active_before = engine.active_steal_tails.clone();
        active_before.sort_unstable();
        active_before.dedup();
        assert_eq!(active_before, vec![0, 1, 2]);
        assert_eq!(
            engine
                .steal_tails
                .iter()
                .map(PianoVoice::midi_note)
                .collect::<Vec<_>>(),
            vec![60, 65, 55]
        );

        engine.note_on(52, 0.8);

        let mut active_after = engine.active_steal_tails.clone();
        active_after.sort_unstable();
        active_after.dedup();
        assert_eq!(active_after, vec![0, 1, 2]);
        assert_eq!(engine.active_steal_tails.len(), engine.steal_tails.len());
        assert_eq!(
            engine
                .steal_tails
                .iter()
                .map(PianoVoice::midi_note)
                .collect::<Vec<_>>(),
            vec![68, 65, 55],
            "the oldest, quietest fade is the only tail replaced"
        );
    }

    #[test]
    fn voice_steal_starts_replacement_immediately_and_fades_outgoing_tail() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        let victim_key = midi_to_key(62).expect("D4 is in the piano range");
        engine
            .attack_samples_mut()
            .set_clip(victim_key, &vec![1.0; 2_400]);
        for midi_note in [60, 62, 64] {
            engine.note_on(midi_note, 0.8);
        }
        let mut warm_left = [0.0; 128];
        let mut warm_right = [0.0; 128];
        engine.process_block(&mut warm_left, &mut warm_right);

        engine.note_on(63, 0.8);

        let replacement = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 63)
            .expect("the replacement starts at the note event");
        assert_eq!(replacement.stage(), super::super::voice::VoiceStage::Active);
        let stealing = engine
            .steal_tails
            .iter()
            .find(|voice| voice.midi_note() == 62 && !voice.is_idle())
            .expect("the outgoing voice moves to a preallocated tail");
        assert_eq!(stealing.stage(), super::super::voice::VoiceStage::Stealing);
        let gain_before = stealing.amplitude();

        // Isolate the outgoing tail so the sampled transient's fade is proven,
        // not hidden beneath the replacement note or shared resonators.
        for voice in engine.voices.iter_mut() {
            voice.kill();
        }
        engine.soundboard.reset();
        engine.sympathetic.reset();
        engine.noise.reset();
        engine.soundboard_send = 0.0;
        engine.sympathetic_send = 0.0;
        engine.master_gain = 1.0;

        let mut fade_left = [0.0; 24];
        let mut fade_right = [0.0; 24];
        engine.process_block(&mut fade_left, &mut fade_right);
        let fading = engine
            .steal_tails
            .iter()
            .find(|voice| voice.midi_note() == 62 && !voice.is_idle())
            .expect("the one-millisecond fade is still in progress");
        assert_eq!(fading.midi_note(), 62);
        assert!(fading.amplitude() > 0.0);
        assert!(fading.amplitude() < gain_before);
        assert!(fade_left.iter().any(|sample| sample.abs() > 1.0e-8));
        let early_peak = fade_left[..4]
            .iter()
            .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
        let late_peak = fade_left[20..]
            .iter()
            .fold(0.0_f32, |peak, sample| peak.max(sample.abs()));
        assert!(late_peak < early_peak * 0.1);

        let mut handoff_left = [0.0; 40];
        let mut handoff_right = [0.0; 40];
        engine.process_block(&mut handoff_left, &mut handoff_right);
        assert!(engine.steal_tails.iter().all(PianoVoice::is_idle));
        assert!(engine.active_steal_tails.is_empty());
        assert!(engine
            .steal_tails
            .iter()
            .all(|tail| tail.attack_playhead().is_none()));
    }

    #[test]
    fn sampled_and_modelled_steal_tail_use_the_same_pre_tick_fade_gain() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        let victim_key = midi_to_key(62).expect("D4 is in the piano range");
        engine
            .attack_samples_mut()
            .set_clip(victim_key, &vec![1.0; 2_400]);
        for midi_note in [60, 62, 64] {
            engine.note_on(midi_note, 0.8);
        }
        engine.note_on(63, 0.8);

        for voice in engine.voices.iter_mut() {
            voice.kill();
        }
        engine.soundboard.reset();
        engine.sympathetic.reset();
        engine.noise.reset();
        engine.soundboard_send = 0.0;
        engine.sympathetic_send = 0.0;
        engine.master_gain = 1.0;

        let tail = engine
            .steal_tails
            .iter()
            .find(|voice| voice.midi_note() == 62 && !voice.is_idle())
            .expect("the outgoing voice moves to a preallocated tail");
        let mut expected_tail = tail.clone();
        let fade_gain = expected_tail.amplitude();
        let modelled = expected_tail.tick();
        let (key, position, length) = expected_tail
            .attack_playhead()
            .expect("the stolen sampled attack remains armed");
        let sample = engine.attack_samples.sample(key, position as usize);
        let sample_gain = AttackSampleSet::sample_gain(position as usize, length as usize);
        let model_gain = AttackSampleSet::model_gain(position as usize, length as usize);
        let dry_gain = (0.4 + engine.tone_tilt * 0.2).clamp(0.2, 0.6);
        let expected = (modelled * model_gain + sample * sample_gain * fade_gain) * dry_gain;

        let mut left = [0.0; 1];
        let mut right = [0.0; 1];
        engine.process_block(&mut left, &mut right);

        assert!(
            (left[0] - expected).abs() < 1.0e-6,
            "sampled and modelled components used different fade gains: expected {expected}, got {}",
            left[0]
        );
    }

    #[test]
    fn stolen_replacement_accepts_expression_and_note_off_immediately() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        for midi_note in [60, 62, 64] {
            engine.note_on(midi_note, 0.8);
        }
        let mut warm_left = [0.0; 128];
        let mut warm_right = [0.0; 128];
        engine.process_block(&mut warm_left, &mut warm_right);

        engine.note_on_with_channel(63, 0.8, 2);
        engine.note_expression(63, 2, 12.0, 1.0, 1.0);
        engine.note_off_on_channel(63, 2);

        let mut left = [0.0; 64];
        let mut right = [0.0; 64];
        engine.process_block(&mut left, &mut right);

        let replacement = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 63)
            .expect("the short replacement note starts immediately");
        assert_eq!(
            replacement.stage(),
            super::super::voice::VoiceStage::Releasing
        );
        assert!(!replacement.is_held());
        assert!((replacement.bend_ratio() - 2.0).abs() < 1.0e-5);
    }

    #[test]
    fn expression_preceding_a_second_steal_retunes_the_outgoing_tail() {
        fn render_tail(bend_semitones: Option<f32>) -> [f32; 48] {
            let mut engine = GrandBouleEngine::new(48_000.0, 3);
            for midi_note in [60, 64, 67] {
                engine.note_on(midi_note, 0.8);
            }
            engine.note_on_with_channel(63, 0.8, 2);
            if let Some(bend) = bend_semitones {
                engine.note_expression(63, 2, bend, 0.0, 0.0);
            }
            engine.note_on(65, 0.8);

            for voice in engine.voices.iter_mut() {
                voice.kill();
            }
            engine.soundboard.reset();
            engine.sympathetic.reset();
            engine.noise.reset();
            engine.soundboard_send = 0.0;
            engine.sympathetic_send = 0.0;
            engine.master_gain = 1.0;

            let mut left = [0.0; 48];
            let mut right = [0.0; 48];
            engine.process_block(&mut left, &mut right);
            left
        }

        let plain = render_tail(None);
        let bent = render_tail(Some(12.0));
        let divergence = plain
            .iter()
            .zip(bent.iter())
            .fold(0.0_f32, |peak, (a, b)| peak.max((a - b).abs()));
        assert!(
            divergence > 1.0e-6,
            "the outgoing tail ignored expression preceding the steal: {divergence}"
        );
    }

    #[test]
    fn fading_victim_note_off_does_not_cancel_the_replacement() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        for midi_note in [60, 62, 64] {
            engine.note_on(midi_note, 0.8);
        }
        let mut warm_left = [0.0; 128];
        let mut warm_right = [0.0; 128];
        engine.process_block(&mut warm_left, &mut warm_right);

        engine.note_on(63, 0.8);
        engine.note_off(62);

        let mut left = [0.0; 64];
        let mut right = [0.0; 64];
        engine.process_block(&mut left, &mut right);
        assert!(engine
            .voices
            .iter()
            .any(|voice| voice.midi_note() == 63 && !voice.is_idle()));
    }

    #[test]
    fn pedal_lift_releases_the_replacement_after_its_key_goes_up() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        engine.set_sustain(1.0);
        for midi_note in [60, 62, 64] {
            engine.note_on(midi_note, 0.8);
        }
        let mut warm_left = [0.0; 128];
        let mut warm_right = [0.0; 128];
        engine.process_block(&mut warm_left, &mut warm_right);

        engine.note_on(63, 0.8);
        engine.note_off(63);
        engine.set_sustain(0.0);

        let mut left = [0.0; 64];
        let mut right = [0.0; 64];
        engine.process_block(&mut left, &mut right);
        let replacement = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 63)
            .expect("the replacement note starts immediately");
        assert_eq!(
            replacement.stage(),
            super::super::voice::VoiceStage::Releasing
        );
        assert!(!replacement.is_held());
    }

    #[test]
    fn highest_and_lowest_notes_are_protected() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        engine.note_on(30, 0.9);
        engine.note_on(60, 0.3);
        engine.note_on(100, 0.9);
        engine.note_on(70, 0.9);
        let mut left = [0.0; 64];
        let mut right = [0.0; 64];
        engine.process_block(&mut left, &mut right);
        let present: Vec<u8> = engine
            .voices
            .iter()
            .map(|voice| voice.midi_note())
            .collect();
        assert!(present.contains(&30));
        assert!(present.contains(&100));
        assert!(present.contains(&70));
    }

    #[test]
    fn out_of_range_notes_are_ignored() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(10, 1.0);
        assert!(engine.voices.iter().all(|voice| voice.is_idle()));
    }

    #[test]
    fn sustain_pedal_prevents_note_off_from_stopping_voice() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.set_sustain(1.0);
        engine.note_on(60, 0.8);
        engine.note_off(60);
        // Voice should still be Active (not Releasing) because the pedal is down.
        let stages: Vec<_> = engine.voices.iter().map(|v| v.stage()).collect();
        assert!(stages
            .iter()
            .any(|s| *s == super::super::voice::VoiceStage::Active));
    }

    #[test]
    fn sustain_note_off_releases_key_ownership_without_stopping_sound() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.set_sustain(1.0);
        engine.note_on_with_channel(60, 0.8, 2);

        engine.note_off(60);

        let voice = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .expect("the pedal-retained voice remains active");
        assert_eq!(voice.stage(), super::super::voice::VoiceStage::Active);
        assert!(!voice.is_held());

        let bend_before = voice.bend_ratio();
        engine.note_expression(60, 2, 12.0, 1.0, 1.0);
        let bend_after = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .expect("the pedal-retained voice remains active")
            .bend_ratio();
        assert_eq!(bend_after, bend_before);
    }

    #[test]
    fn sustain_pedal_release_starts_release_for_pedal_sustained_voice() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.set_sustain(1.0);
        engine.note_on(60, 0.8);
        engine.note_off(60); // pedal-sustained: voice stays Active
        engine.set_sustain(0.0);
        // Lifting the pedal must start the voice's release phase; otherwise it
        // reads as "key held" to the damper logic forever and rings undamped.
        let stage = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .map(|voice| voice.stage());
        assert_eq!(stage, Some(super::super::voice::VoiceStage::Releasing));
    }

    #[test]
    fn sostenuto_release_starts_release_for_captured_voice() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(60, 0.8);
        engine.set_sostenuto(true); // captures the held key
        engine.note_off(60); // sostenuto-sustained: voice stays Active
        let stage = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .map(|voice| voice.stage());
        assert_eq!(stage, Some(super::super::voice::VoiceStage::Active));
        // Lifting sostenuto must start the captured voice's release phase, the
        // same never-release class as the sustain pedal.
        engine.set_sostenuto(false);
        let stage = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .map(|voice| voice.stage());
        assert_eq!(stage, Some(super::super::voice::VoiceStage::Releasing));
    }

    #[test]
    fn undamped_top_key_struck_after_sostenuto_engages_is_not_captured() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.set_sostenuto(true);
        engine.note_on(108, 0.8);

        engine.note_off(108);

        let stage = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 108)
            .map(PianoVoice::stage);
        assert_eq!(stage, Some(super::super::voice::VoiceStage::Releasing));
    }

    #[test]
    fn sustain_pedal_release_keeps_physically_held_voice_active() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.set_sustain(1.0);
        engine.note_on(60, 0.8);
        // Key still held (no note_off); lifting the pedal must not release it.
        engine.set_sustain(0.0);
        let stage = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .map(|voice| voice.stage());
        assert_eq!(stage, Some(super::super::voice::VoiceStage::Active));
        // Releasing the key afterwards starts the release normally.
        engine.note_off(60);
        let stage = engine
            .voices
            .iter()
            .find(|voice| !voice.is_idle())
            .map(|voice| voice.stage());
        assert_eq!(stage, Some(super::super::voice::VoiceStage::Releasing));
    }

    /// Signal-level proof: after the pedal lifts, the pedal-sustained note must
    /// decay to (near) silence instead of ringing on intrinsic string decay.
    #[test]
    fn sustain_pedal_release_decays_output_to_silence() {
        fn render(
            engine: &mut GrandBouleEngine,
            left: &mut [f32],
            right: &mut [f32],
            seconds: f32,
            sr: f32,
        ) {
            let blocks = (seconds * sr / left.len() as f32) as usize;
            for _ in 0..blocks {
                left.fill(0.0);
                right.fill(0.0);
                engine.process_block(left, right);
            }
        }
        fn window_energy(
            engine: &mut GrandBouleEngine,
            left: &mut [f32],
            right: &mut [f32],
            sr: f32,
        ) -> f32 {
            let mut energy = 0.0_f32;
            let blocks = (0.1 * sr / left.len() as f32) as usize;
            for _ in 0..blocks {
                left.fill(0.0);
                right.fill(0.0);
                engine.process_block(left, right);
                for &s in left.iter() {
                    energy += s * s;
                }
            }
            energy
        }

        let sr = 48_000.0_f32;
        let block = 512usize;
        let mut engine = GrandBouleEngine::new(sr, 8);
        let mut left = vec![0.0_f32; block];
        let mut right = vec![0.0_f32; block];

        engine.set_sustain(1.0);
        engine.note_on(60, 0.8);
        engine.note_off(60);
        render(&mut engine, &mut left, &mut right, 0.5, sr); // let the sustained note stabilize
        engine.set_sustain(0.0);
        let early = window_energy(&mut engine, &mut left, &mut right, sr); // first 100 ms after pedal up
        render(&mut engine, &mut left, &mut right, 1.8, sr);
        let late = window_energy(&mut engine, &mut left, &mut right, sr); // ~2 s after pedal up

        assert!(
            early > 1.0e-6,
            "sustained note was already dead at pedal up: {early}"
        );
        assert!(
            late < early * 0.01,
            "note still ringing 2s after pedal release: early={early} late={late}"
        );
    }

    #[test]
    fn microtuned_note_changes_fundamental() {
        let mut engine = GrandBouleEngine::new(48_000.0, 2);
        engine.note_on_midi2(69, 0xFFFF, (50 << 24) / 100); // +0.5 semitone
        assert!(engine.voices.iter().any(|v| !v.is_idle()));
    }

    /// Verify that the full engine produces non-NaN audio for 5 seconds across
    /// multiple notes and the sustain profile is reasonable.
    #[test]
    fn five_second_profile_is_nan_free() {
        let sr = 48000.0_f32;
        let mut engine = GrandBouleEngine::new(sr, 8);
        // Play several notes across the range.
        engine.note_on(36, 0.7); // C2
        engine.note_on(60, 0.8); // C4
        engine.note_on(69, 0.9); // A4
        engine.note_on(84, 0.6); // C6

        let block = 512;
        let mut left = vec![0.0_f32; block];
        let mut right = vec![0.0_f32; block];
        let mut any_nan = false;
        let mut peak_overall = 0.0_f32;
        let mut peak_at_1s = 0.0_f32;

        let total_blocks = (sr * 5.0 / block as f32) as usize;
        for b in 0..total_blocks {
            left.fill(0.0);
            right.fill(0.0);
            engine.process_block(&mut left, &mut right);
            for &s in left.iter().chain(right.iter()) {
                if s.is_nan() || s.is_infinite() {
                    any_nan = true;
                }
            }
            let peak = left.iter().fold(0.0_f32, |a, &v| a.max(v.abs()));
            peak_overall = peak_overall.max(peak);
            let time_ms = (b * block) as f32 / sr * 1000.0;
            if (time_ms - 1000.0).abs() < 15.0 {
                peak_at_1s = peak;
            }
        }
        assert!(!any_nan, "output contains NaN or Inf");
        assert!(peak_overall > 0.01, "no audio produced");
        assert!(peak_overall < 2.0, "output is clipping: {peak_overall}");
        assert!(
            peak_at_1s > 0.0001,
            "signal is dead at 1 second: {peak_at_1s}"
        );
    }

    #[test]
    fn model_params_produce_different_output() {
        let block = 512;
        let sr = 48000.0;
        let measure =
            |hardness: f32, mass: f32, brightness: f32, body: f32, tone: f32| -> (f32, f32) {
                let mut engine = GrandBouleEngine::new(sr, 4);
                engine.set_param("hammer_hardness_scale", hardness);
                engine.set_param("hammer_mass_scale", mass);
                engine.set_param("soundboard_brightness", brightness);
                engine.set_param("body_resonance", body);
                engine.set_param("tone_color", tone);
                engine.note_on(60, 0.8);
                let mut left = vec![0.0_f32; block];
                let mut right = vec![0.0_f32; block];
                let mut peak = 0.0_f32;
                let mut energy = 0.0_f32;
                for _ in 0..(sr as usize / block) {
                    left.fill(0.0);
                    right.fill(0.0);
                    engine.process_block(&mut left, &mut right);
                    for &s in left.iter() {
                        peak = peak.max(s.abs());
                        energy += s * s;
                    }
                }
                (peak, energy)
            };

        let (peak_balanced, energy_balanced) = measure(1.0, 1.0, 0.55, 0.6, 0.0);
        let (peak_mellow, energy_mellow) = measure(0.6, 1.4, 0.25, 0.9, -0.7);
        let (peak_clear, energy_clear) = measure(1.5, 0.7, 0.85, 0.35, 0.7);

        eprintln!("\n--- Product voicing comparison (C4, v=0.8, 1s) ---");
        eprintln!("  Balanced: peak={peak_balanced:.6} energy={energy_balanced:.4}");
        eprintln!("  Mellow:   peak={peak_mellow:.6} energy={energy_mellow:.4}");
        eprintln!("  Clear:    peak={peak_clear:.6} energy={energy_clear:.4}");

        let peak_range = (peak_balanced - peak_mellow)
            .abs()
            .max((peak_balanced - peak_clear).abs());
        let energy_range = (energy_balanced - energy_mellow)
            .abs()
            .max((energy_balanced - energy_clear).abs());
        assert!(
            peak_range > 0.001 || energy_range > 0.01,
            "product voicings should produce different peak/energy: peak_range={peak_range}, energy_range={energy_range}"
        );
    }

    #[test]
    fn stretch_amount_changes_audio_output_at_treble() {
        // At C8 the project stretch curve is deliberately non-zero, so an
        // engine with `stretch_amount = 0` must produce a different sample
        // stream from one with `stretch_amount = 1`. We render both for
        // a few hundred samples and require their L²-distance to be
        // measurably non-zero. If the parameter were silently dropped, the
        // outputs would be bit-identical and this test would fail.
        let render = |stretch: f32| -> Vec<f32> {
            let mut engine = GrandBouleEngine::new(48_000.0, 2);
            engine.set_param("stretch_amount", stretch);
            engine.note_on(108, 0.8); // C8 — where stretch is largest
            let mut left = vec![0.0_f32; 1024];
            let mut right = vec![0.0_f32; 1024];
            engine.process_block(&mut left, &mut right);
            left
        };
        let full = render(1.0);
        let none = render(0.0);
        let l2: f32 = full
            .iter()
            .zip(none.iter())
            .map(|(a, b)| (a - b) * (a - b))
            .sum();
        assert!(
            l2 > 1.0e-8,
            "stretch_amount should measurably change C8 output (l2 = {l2})"
        );
    }

    #[test]
    fn attack_bite_zero_reduces_high_frequency_attack_energy() {
        // Property: with `attack_bite = 0` the StringPrecursor burst is
        // suppressed. The precursor sits at ~3.5 kHz centre / 4.5 kHz BW,
        // so its dominant signature is high-frequency energy in the first
        // few ms. Compare the *first-difference energy* (a proxy for HF
        // content) between bite=1 and bite=0; the former must contain
        // more HF energy than the latter. If the parameter were silently
        // dropped, both renders would be bit-identical and this test
        // would fail.
        let render_hf_energy = |bite: f32| -> f32 {
            let mut engine = GrandBouleEngine::new(48_000.0, 2);
            engine.set_param("attack_bite", bite);
            engine.note_on(60, 0.8);
            let mut left = vec![0.0_f32; 256];
            let mut right = vec![0.0_f32; 256];
            engine.process_block(&mut left, &mut right);
            left.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum::<f32>()
        };
        let with_bite = render_hf_energy(1.0);
        let without_bite = render_hf_energy(0.0);
        assert!(
            with_bite > without_bite,
            "attack_bite=1 should produce more HF attack energy than bite=0 \
             (with={with_bite}, without={without_bite})"
        );
        // Voice path must still generate audio when bite is off.
        assert!(
            without_bite > 0.0,
            "voice should still produce HF energy at attack_bite=0 \
             (the rest of the synthesis path is untouched)"
        );
    }

    #[test]
    fn higher_velocity_produces_louder_output() {
        let block = 512;
        let sr = 48000.0;
        let measure = |velocity: f32, midi_note: u8| -> f32 {
            let mut engine = GrandBouleEngine::new(sr, 4);
            engine.note_on(midi_note, velocity);
            let mut left = vec![0.0_f32; block];
            let mut right = vec![0.0_f32; block];
            let mut peak = 0.0_f32;
            for _ in 0..(sr as usize / block / 2) {
                left.fill(0.0);
                right.fill(0.0);
                engine.process_block(&mut left, &mut right);
                for &s in left.iter() {
                    peak = peak.max(s.abs());
                }
            }
            peak
        };

        eprintln!("\n--- Velocity curve for Middle C (MIDI 60) ---");
        for v in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] {
            let peak = measure(v, 60);
            eprintln!("  v={v:.1}  peak={peak:.6}");
        }

        eprintln!("\n--- Velocity curve for A4 (MIDI 69) ---");
        for v in [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] {
            let peak = measure(v, 69);
            eprintln!("  v={v:.1}  peak={peak:.6}");
        }

        let soft = measure(0.3, 60);
        let loud = measure(0.8, 60);
        assert!(loud > soft, "loud ({loud}) should exceed soft ({soft})");
    }

    /// Verify that bass and mid notes still have audible energy at 3 and 5
    /// seconds (aftersound / slow polarization must be working).
    #[test]
    fn sustained_notes_ring_for_seconds() {
        let sr = 48000.0;
        let block = 512;
        let measure_at = |midi: u8, seconds: f32| -> f32 {
            let mut engine = GrandBouleEngine::new(sr, 4);
            engine.note_on(midi, 0.8);
            let mut left = vec![0.0_f32; block];
            let mut right = vec![0.0_f32; block];
            let target_block = (seconds * sr / block as f32) as usize;
            for _ in 0..target_block {
                left.fill(0.0);
                right.fill(0.0);
                engine.process_block(&mut left, &mut right);
            }
            // Measure energy over the next 100 ms.
            let measure_blocks = (0.1 * sr / block as f32) as usize;
            let mut energy = 0.0_f32;
            for _ in 0..measure_blocks {
                left.fill(0.0);
                right.fill(0.0);
                engine.process_block(&mut left, &mut right);
                for &s in left.iter() {
                    energy += s * s;
                }
            }
            energy
        };

        // Bass C2 (MIDI 36) should still have energy at 3 seconds.
        let bass_3s = measure_at(36, 3.0);
        assert!(bass_3s > 1.0e-6, "bass C2 is dead at 3s: {bass_3s}");

        // Mid C4 (MIDI 60) should still have energy at 3 seconds.
        let mid_3s = measure_at(60, 3.0);
        assert!(mid_3s > 1.0e-6, "mid C4 is dead at 3s: {mid_3s}");

        // Mid A4 (MIDI 69) at 5 seconds — should still be ringing.
        let a4_5s = measure_at(69, 5.0);
        assert!(a4_5s > 1.0e-7, "A4 is dead at 5s: {a4_5s}");

        // Decay profile for C4 to check prompt-to-aftersound ratio.
        eprintln!("\n--- C4 decay profile (energy per 100ms window) ---");
        for &t in &[0.0, 0.2, 0.5, 1.0, 2.0, 3.0, 5.0, 8.0] {
            let e = measure_at(60, t);
            let db = if e > 0.0 {
                10.0 * (e as f64).log10()
            } else {
                -100.0
            };
            eprintln!("  t={t:.1}s  energy={e:.8}  ({db:.1} dB)");
        }

        eprintln!("\n--- Sustain energy (held note, no pedal) ---");
        eprintln!("  Bass C2 at 3s: {bass_3s:.8}");
        eprintln!("  Mid  C4 at 3s: {mid_3s:.8}");
        eprintln!("  A4 at 5s:      {a4_5s:.8}");
    }

    // ── MPE per-note pitch bend (audit MD-2, review round 1) ───────────────
    //
    // `ModalString::reset_decay` rewrites c1/c2 and never touches the ringing
    // state, so a sounding string can be retuned in place — the same primitive
    // the SS A5.2 pitch glide already uses mid-note. These prove the bend is
    // audible on rendered samples and addressed per note, not per pitch.

    fn render_engine(engine: &mut GrandBouleEngine, blocks: usize) -> Vec<f32> {
        let mut collected = Vec::with_capacity(blocks * 128);
        let mut left = [0.0f32; 128];
        let mut right = [0.0f32; 128];
        for _ in 0..blocks {
            left.fill(0.0);
            right.fill(0.0);
            engine.process_block(&mut left, &mut right);
            collected.extend_from_slice(&left);
        }
        collected
    }

    fn render_radiation(lid_position: f32, mic_position: f32) -> Vec<f32> {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.set_param("master_gain", 0.7);
        engine.set_param("lid_position", lid_position);
        engine.set_param("mic_position", mic_position);
        engine.note_on(60, 0.8);
        render_engine(&mut engine, 160)
    }

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
    }

    fn high_frequency_proxy(samples: &[f32]) -> f32 {
        samples
            .windows(2)
            .map(|pair| {
                let delta = pair[1] - pair[0];
                delta * delta
            })
            .sum::<f32>()
            / (samples.len() - 1) as f32
    }

    #[test]
    fn lid_position_continuously_changes_the_rendered_radiation() {
        let closed = rms(&render_radiation(0.0, 1.0));
        let half = rms(&render_radiation(0.5, 1.0));
        let open = rms(&render_radiation(1.0, 1.0));

        assert!(
            closed < half && half < open,
            "expected closed < half < open RMS, got {closed}, {half}, {open}"
        );
    }

    #[test]
    fn microphone_positions_have_distinct_rendered_responses() {
        let close = render_radiation(1.0, 0.0);
        let player = render_radiation(1.0, 1.0);
        let room = render_radiation(1.0, 2.0);

        let signatures = [
            (rms(&close), high_frequency_proxy(&close)),
            (rms(&player), high_frequency_proxy(&player)),
            (rms(&room), high_frequency_proxy(&room)),
        ];
        let brightness = signatures.map(|(level, high)| high / (level * level));
        assert!(
            brightness[0] > brightness[1] && brightness[1] > brightness[2],
            "expected Close > Player > Room brightness, got {brightness:?}"
        );
        assert!(
            signatures[2].0 < signatures[1].0,
            "Room should be softer than Player, got RMS {} vs {}",
            signatures[2].0,
            signatures[1].0
        );
    }

    fn zero_crossings(samples: &[f32]) -> usize {
        samples
            .windows(2)
            .filter(|pair| (pair[0] < 0.0) != (pair[1] < 0.0))
            .count()
    }

    /// Strike A4, let the string settle, then bend and keep rendering.
    fn render_bent_tail(bend_semitones: Option<f32>) -> Vec<f32> {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.note_on_with_channel(69, 0.8, 2);
        // Let the attack transient and the SS A5.2 pitch glide settle first.
        let _ = render_engine(&mut engine, 60);
        if let Some(semitones) = bend_semitones {
            engine.note_expression(69, 2, semitones, 0.0, 0.0);
        }
        render_engine(&mut engine, 60)
    }

    #[test]
    fn per_note_pitch_bend_retunes_the_ringing_string() {
        let plain = render_bent_tail(None);
        let bent = render_bent_tail(Some(12.0));

        let ratio = zero_crossings(&bent) as f32 / zero_crossings(&plain) as f32;
        assert!(
            (1.7..=2.3).contains(&ratio),
            "a +12 st per-note bend must roughly double the ringing string's \
             crossing rate, got {ratio}x"
        );
    }

    #[test]
    fn per_note_pitch_bend_keeps_the_string_ringing_through_the_retune() {
        let bent = render_bent_tail(Some(7.0));
        let energy: f32 =
            bent.iter().map(|sample| sample * sample).sum::<f32>() / bent.len() as f32;

        // A retune that reset the biquad state would silence the note; the
        // string must still be sounding after it.
        assert!(
            energy.sqrt() > 1.0e-4,
            "the string must keep ringing through the retune, got RMS {}",
            energy.sqrt()
        );
    }

    fn voices_at(engine: &GrandBouleEngine, midi_note: u8) -> Vec<(u8, bool, f32)> {
        engine
            .voices
            .iter()
            .filter(|voice| !voice.is_idle() && voice.midi_note() == midi_note)
            .map(|voice| (voice.channel(), voice.is_held(), voice.bend_ratio()))
            .collect()
    }

    #[test]
    fn expression_addressed_to_another_member_channel_is_ignored() {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.note_on_with_channel(69, 0.8, 2);

        // Same pitch, wrong member channel — a note this voice does not own.
        engine.note_expression(69, 3, 12.0, 0.0, 0.0);
        assert_eq!(
            voices_at(&engine, 69),
            vec![(2, true, 1.0)],
            "a voice must only take expression addressed to its own channel"
        );

        engine.note_expression(69, 2, 12.0, 0.0, 0.0);
        let bent = voices_at(&engine, 69);
        assert!(
            (bent[0].2 - 2.0).abs() < 1.0e-4,
            "its own channel must bend it an octave up, got {}",
            bent[0].2
        );
    }

    #[test]
    fn same_pitch_mpe_channels_keep_independent_ownership_until_each_releases() {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.note_on_with_channel(69, 0.8, 2);
        engine.note_on_with_channel(69, 0.8, 3);

        let mut owners = voices_at(&engine, 69);
        owners.sort_by_key(|owner| owner.0);
        assert_eq!(owners, vec![(2, true, 1.0), (3, true, 1.0)]);

        engine.note_expression(69, 3, 12.0, 0.0, 0.0);
        engine.note_off_on_channel(69, 3);
        engine.note_expression(69, 2, 7.0, 0.0, 0.0);

        let channel_two = voices_at(&engine, 69)
            .into_iter()
            .find(|owner| owner.0 == 2)
            .expect("the first member channel remains physically held");
        assert!(channel_two.1);
        assert!((channel_two.2 - (2.0_f32).powf(7.0 / 12.0)).abs() < 1.0e-4);
    }

    #[test]
    fn same_pitch_mpe_release_is_retained_by_sustain() {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.set_sustain(1.0);
        engine.note_on_with_channel(69, 0.8, 2);
        engine.note_on_with_channel(69, 0.8, 3);

        engine.note_off_on_channel(69, 3);

        let released = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 3)
            .expect("the released member channel remains sounding under sustain");
        assert_eq!(released.stage(), super::super::voice::VoiceStage::Active);
        assert!(!released.is_held());

        engine.set_sustain(0.0);
        let released = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 3)
            .expect("the released member channel remains present during its release");
        assert_eq!(released.stage(), super::super::voice::VoiceStage::Releasing);
        let held = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 2)
            .expect("the sibling member channel remains held");
        assert_eq!(held.stage(), super::super::voice::VoiceStage::Active);
        assert!(held.is_held());
    }

    #[test]
    fn same_pitch_mpe_release_is_retained_by_sostenuto_capture() {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.note_on_with_channel(69, 0.8, 2);
        engine.note_on_with_channel(69, 0.8, 3);
        engine.set_sostenuto(true);

        engine.note_off_on_channel(69, 3);

        let released = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 3)
            .expect("the captured member channel remains sounding under sostenuto");
        assert_eq!(released.stage(), super::super::voice::VoiceStage::Active);
        assert!(!released.is_held());

        engine.set_sostenuto(false);
        let released = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 3)
            .expect("the released member channel remains present during its release");
        assert_eq!(released.stage(), super::super::voice::VoiceStage::Releasing);
        let held = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 2)
            .expect("the sibling member channel remains held");
        assert_eq!(held.stage(), super::super::voice::VoiceStage::Active);
        assert!(held.is_held());
    }

    #[test]
    fn same_pitch_voice_struck_after_sostenuto_edge_is_not_captured() {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.note_on_with_channel(69, 0.8, 2);
        engine.set_sostenuto(true);
        engine.note_on_with_channel(69, 0.8, 3);

        engine.note_off_on_channel(69, 3);

        let later_voice = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 3)
            .expect("the later voice remains present during its normal release");
        assert_eq!(
            later_voice.stage(),
            super::super::voice::VoiceStage::Releasing,
            "sostenuto must capture voice ownership at the pedal edge, not the pitch"
        );
        assert!(!later_voice.is_held());

        engine.note_off_on_channel(69, 2);
        let captured_voice = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 2)
            .expect("the captured voice remains sounding under sostenuto");
        assert_eq!(
            captured_voice.stage(),
            super::super::voice::VoiceStage::Active
        );
        assert!(!captured_voice.is_held());

        engine.set_sostenuto(false);
        let captured_voice = engine
            .voices
            .iter()
            .find(|voice| voice.midi_note() == 69 && voice.channel() == 2)
            .expect("the captured voice remains present during its release");
        assert_eq!(
            captured_voice.stage(),
            super::super::voice::VoiceStage::Releasing
        );
    }

    #[test]
    fn per_note_bend_skips_a_still_ringing_voice_at_the_same_pitch() {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.note_on_with_channel(69, 0.8, 2);
        engine.note_off_on_channel(69, 2);
        // The released voice is still ringing but idle-bound; a retrigger of the
        // same key reuses it, so drive a second key into the same slot instead.
        let ringing = voices_at(&engine, 69);
        assert_eq!(ringing.len(), 1);
        assert_eq!(ringing[0].1, false, "the released voice is no longer held");

        // Expression addressed to that pitch must not revive the released note.
        engine.note_expression(69, 2, 12.0, 0.0, 0.0);
        assert_eq!(
            voices_at(&engine, 69),
            vec![(2, false, 1.0)],
            "a ringing tail must keep its own pitch"
        );
    }

    #[test]
    fn pressure_and_slide_are_dropped_rather_than_faked() {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.note_on_with_channel(69, 0.8, 2);
        let plain = render_engine(&mut engine, 40);

        let mut expressive = GrandBouleEngine::new(48_000.0, 8);
        expressive.note_on_with_channel(69, 0.8, 2);
        // Full pressure and full timbre, zero bend: a struck string has no
        // physical response to either, so the render must be untouched. The
        // expression registry advertises pitch bend only for this device.
        expressive.note_expression(69, 2, 0.0, 1.0, 1.0);
        let pressed = render_engine(&mut expressive, 40);

        assert_eq!(plain, pressed);
    }

    // ── Half-pedal engagement threshold (`sustain_threshold`) ──────────────
    //
    // The damper curve is `smoothstep(CC64, low, high)`.
    // with `low = 0.15`. The Grand Boule MIDI-calibration panel exposes that
    // `low` edge as "Sus Thresh" so a pedal whose travel or rest position
    // differs from the reference can be calibrated to it. These prove the
    // parameter reaches rendered audio, not merely an engine field.

    /// Tail energy of a pedal-sustained note at a fixed pedal position,
    /// varying only the calibrated half-pedal threshold. The pedal sits at
    /// 0.6 in both runs, so every sample of difference is the threshold's.
    fn pedal_sustained_tail_energy(sustain_threshold: f32) -> f32 {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.set_param("sustain_threshold", sustain_threshold);
        // Above the 0.5 note-off catch, so the key release hands the voice to
        // the pedal (`release_key`) and the damper — not the 150 ms note-off
        // amplitude ramp — governs how the tail decays.
        engine.set_sustain(0.6);
        engine.note_on(60, 0.8);
        engine.note_off(60);
        let _ = render_engine(&mut engine, 60); // skip the attack
        let tail = render_engine(&mut engine, 130); // ~0.35 s of damper decay
        tail.iter().map(|s| s * s).sum()
    }

    #[test]
    fn sustain_threshold_moves_the_half_pedal_lift_point() {
        // Threshold at the bottom of its range: 0.6 is well past the lift
        // point, the dampers are largely clear, the string rings on.
        let early_lift = pedal_sustained_tail_energy(0.0);
        // Threshold at the top of its range: 0.6 has only just entered the
        // band, the dampers are still mostly down, the string is choked.
        let late_lift = pedal_sustained_tail_energy(0.5);

        assert!(
            early_lift > 1.0e-9,
            "the pedal-sustained note was silent before the tail window: {early_lift}"
        );
        // Measured 5.900 vs 0.00723 — an 816x energy ratio. The bar is set at
        // 4x so an ordinary damper-curve retune does not trip it; only the
        // threshold ceasing to reach the audio does.
        assert!(
            early_lift > late_lift * 4.0,
            "the calibrated threshold did not move the damper lift point: \
             early_lift={early_lift} late_lift={late_lift}"
        );
    }

    // ── Continuous-CC smoothing (`cc_smoothing_ms`) ────────────────────────
    //
    // CC64 arrives in 128 steps at the controller's scan rate, so a swept
    // pedal steps the damper bandwidth. The calibration panel's "CC Smooth"
    // knob is the time constant that turns those steps back into a slide.

    /// Energy of the first ~32 ms after the sustain pedal is released under a
    /// pedal-sustained note. Both runs take the identical amplitude release
    /// (`release_pedal_sustained_voices` fires either way), so the difference
    /// is the speed at which the dampers land.
    fn energy_after_pedal_release(cc_smoothing_ms: f32) -> f32 {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.set_param("cc_smoothing_ms", cc_smoothing_ms);
        engine.set_sustain(1.0);
        // Settle the smoother on the fully-down pedal before striking, so both
        // runs damp the attack identically and the only difference measured is
        // how fast the dampers land when the pedal comes back up.
        let _ = render_engine(&mut engine, 100);
        engine.note_on(60, 0.8);
        engine.note_off(60);
        let _ = render_engine(&mut engine, 60); // skip the attack
        engine.set_sustain(0.0); // pedal up: the dampers come down
        let window = render_engine(&mut engine, 12);
        window.iter().map(|s| s * s).sum()
    }

    #[test]
    fn cc_smoothing_changes_how_fast_the_dampers_land_on_rendered_audio() {
        // 5 ms and 50 ms — the panel default and the top of its range.
        // Neither is the engine's own default of 0, so this cannot pass on
        // the value the parameter already had.
        let quick = energy_after_pedal_release(5.0);
        let slow = energy_after_pedal_release(50.0);

        assert!(
            slow > 1.0e-12,
            "the note was silent in the measurement window: {slow}"
        );
        assert!(
            slow > quick,
            "the calibrated smoothing did not reach rendered audio: \
             quick={quick} slow={slow}"
        );
    }

    #[test]
    fn one_non_finite_pedal_value_does_not_silence_the_instrument_for_good() {
        // The damage path, end to end: a NaN pedal position seeds
        // `smoothed_sustain`, which no later valid position clears while
        // smoothing is on; `damper_bandwidth_for_key` hands the NaN to
        // `PianoVoice::set_extra_damping`, whose `< 1.0e-3` no-op check is
        // false for NaN, so `reset_decay` rewrites every resonator
        // coefficient with NaN. `GrandBouleInstance::process` then scrubs the
        // output to silence at the wasm boundary, so the symptom a player gets
        // is not a glitch — it is a piano that never makes a sound again.
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.set_param("cc_smoothing_ms", 30.0);
        engine.set_sustain(0.8);
        engine.note_on(60, 0.8);
        engine.note_off(60);
        let _ = render_engine(&mut engine, 20);

        engine.set_sustain(f32::NAN);
        let _ = render_engine(&mut engine, 1);
        engine.set_sustain(0.2);

        // A fresh note, struck after the bad value, is the real question: not
        // "did the ringing tail survive" but "does this instrument still work".
        engine.note_on(64, 0.9);
        let after = render_engine(&mut engine, 40);

        assert!(
            after.iter().all(|sample| sample.is_finite()),
            "rendered audio went non-finite after one bad pedal value"
        );
        let energy: f32 = after.iter().map(|sample| sample * sample).sum();
        assert!(
            energy > 1.0e-9,
            "the instrument was silenced by one bad pedal value: energy={energy}"
        );
    }
}
