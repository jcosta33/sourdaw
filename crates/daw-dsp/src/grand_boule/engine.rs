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
use super::pedals::PedalState;
use super::soundboard::Soundboard;
use super::sympathetic::Sympathetic;
use super::voice::PianoVoice;
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
    pedals: PedalState,
    soundboard: Soundboard,
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
    // --- Piano model parameters (morph system) ---
    /// Hammer stiffness multiplier from piano model (0.5..2.0, 1.0 = neutral).
    hammer_hardness_scale: f32,
    /// Hammer mass multiplier from piano model (0.5..2.0, 1.0 = neutral).
    hammer_mass_scale: f32,
    /// Soundboard brightness: interpolates the soundboard drive amount (0..1).
    soundboard_brightness: f32,
    /// MPE member channel the in-flight note-on belongs to (audit MD-2).
    /// `note_on_with_pitch` has three voice-allocation exits; rather than
    /// thread the channel through all of them, `note_on_with_channel` sets this
    /// for the duration of one call. Defaults to 0 (non-MPE).
    pending_channel: u8,
    /// Sympathetic resonance level from piano model (0..1).
    sympathetic_level: f32,
    /// Soundboard body resonance strength from piano model (0..1).
    body_resonance: f32,
    /// Overall tone color offset from piano model (-1..+1).
    tone_color: f32,
    /// Multiplier for the Steinway D Railsback stretched-tuning curve
    /// (§A8). 0.0 = no stretch (equal-tempered fundamentals), 1.0 = the
    /// measured Jaatinen & Pätynen Steinway D curve, > 1.0 = exaggerated
    /// stretch. Per-note jitter is preserved at full strength.
    stretch_amount: f32,
    /// Velocity multiplier for the §A6 string-precursor "bite" noise burst.
    /// 0.0 disables the burst entirely, 1.0 = neutral (matches the
    /// hammer's actual MIDI velocity), > 1.0 over-emphasises the chirp.
    attack_bite: f32,
    /// Consecutive complete output blocks below -150 dBFS.
    quiet_block_count: u8,
}

impl GrandBouleEngine {
    pub fn new(sample_rate: f32, voice_count: usize) -> Self {
        let count = voice_count.clamp(1, MAX_VOICE_COUNT);
        let mut voices = Vec::with_capacity(count);
        for _ in 0..count {
            voices.push(PianoVoice::new(sample_rate));
        }
        Self {
            voices,
            pedals: PedalState::new(),
            soundboard: Soundboard::new(sample_rate),
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
            quiet_block_count: QUIET_BLOCKS_BEFORE_SLEEP,
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
        // Stretched-tuning amount (§A8). The default Railsback curve baked
        // into `key_fundamental_hz` is the full Steinway D measurement
        // (Jaatinen & Pätynen 2022). Users who want less or more stretch
        // dial that in via the `stretch_amount` knob (0..2). We compute
        // the residual cent offset against equal temperament and apply
        // `(stretch_amount − 1)` worth of it as a multiplicative ratio.
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
        // §A6 string-precursor "bite" — the longitudinal pulse that
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

        // Retrigger the same voice if this note is already held.
        for voice in self.voices.iter_mut() {
            if !voice.is_idle() && voice.midi_note() == midi_note {
                voice.note_on(
                    midi_note,
                    self.pending_channel,
                    shaped_velocity,
                    key,
                    combined_ratio,
                    stiffness_scale,
                    mass_scale,
                );
                voice.arm_attack(key, self.attack_samples.length_for_key(key));
                return;
            }
        }

        // Voice stealing per §4.2.
        let (highest_midi, lowest_midi) = self.extreme_notes();
        let mut victim_index: Option<usize> = None;
        let mut best_score = f32::NEG_INFINITY;
        for (index, voice) in self.voices.iter().enumerate() {
            let note = voice.midi_note();
            if !voice.is_idle() && (note == highest_midi || note == lowest_midi) {
                continue;
            }
            let score = voice.steal_score();
            if score > best_score {
                best_score = score;
                victim_index = Some(index);
            }
        }
        let Some(index) = victim_index else {
            let oldest = self
                .voices
                .iter_mut()
                .max_by_key(|voice| voice.age_samples());
            if let Some(voice) = oldest {
                voice.note_on(
                    midi_note,
                    self.pending_channel,
                    shaped_velocity,
                    key,
                    combined_ratio,
                    stiffness_scale,
                    mass_scale,
                );
                voice.arm_attack(key, self.attack_samples.length_for_key(key));
            }
            return;
        };
        let voice = &mut self.voices[index];
        if !voice.is_idle() {
            voice.begin_steal();
        }
        voice.note_on(
            midi_note,
            self.pending_channel,
            shaped_velocity,
            key,
            combined_ratio,
            stiffness_scale,
            mass_scale,
        );
        voice.arm_attack(key, self.attack_samples.length_for_key(key));
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
        self.noise.trigger(NoiseEvent::DamperLift, 0.5);
        if let Some(key) = midi_to_key(midi_note) {
            self.pedals.release_key(key);
            // Apply damping immediately — `apply_damper_state` will pick up
            // the pedal state on the next process iteration.
        }
        let sustain_engaged = self.pedals.sustain_position() > 0.5
            || (self.pedals.sostenuto()
                && midi_to_key(midi_note)
                    .map(|k| {
                        self.pedals.sostenuto()
                            && self.pedals.damper_bandwidth_for_key(k, false) == 0.0
                    })
                    .unwrap_or(false));
        for voice in self.voices.iter_mut() {
            if !voice.is_idle() && voice.midi_note() == midi_note && !sustain_engaged {
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
            let held = voice.stage() == super::voice::VoiceStage::Active;
            let damping = self.pedals.damper_bandwidth_for_key(key, held);
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
        if was_engaged && self.pedals.sustain_position() <= 0.5 {
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
            let Some(key) = midi_to_key(voice.midi_note()) else {
                continue;
            };
            if self.pedals.key_is_held(key) {
                continue;
            }
            let sostenuto_held =
                self.pedals.sostenuto() && self.pedals.damper_bandwidth_for_key(key, false) == 0.0;
            if sostenuto_held {
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
            if voice.stage() != super::voice::VoiceStage::Active {
                continue;
            }
            let Some(key) = midi_to_key(voice.midi_note()) else {
                continue;
            };
            if self.pedals.key_is_held(key) {
                continue;
            }
            if self.pedals.sustain_position() > 0.5 {
                continue;
            }
            voice.note_off();
        }
    }

    pub fn set_temperament(&mut self, temperament: Temperament) {
        self.temperament = temperament;
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "master_gain" => self.master_gain = value.clamp(0.0, 2.0),
            "soundboard_send" => self.soundboard_send = value.clamp(0.0, 1.0),
            "sympathetic_send" => self.sympathetic_send = value.clamp(0.0, 1.0),
            "hammer_hardness" => self.hammer_hardness_offset = value.clamp(-1.0, 1.0),
            "tone_tilt" => self.tone_tilt = value.clamp(-1.0, 1.0),
            "stereo_width" => self.stereo_width = value.clamp(0.0, 1.0),
            "velocity_curve" => self.velocity_curve = value.clamp(0.5, 2.0),
            "temperament" => self.temperament = Temperament::from_u8(value as u8),
            "hammer_hardness_scale" => self.hammer_hardness_scale = value.clamp(0.5, 2.0),
            "hammer_mass_scale" => self.hammer_mass_scale = value.clamp(0.5, 2.0),
            "soundboard_brightness" => self.soundboard_brightness = value.clamp(0.0, 1.0),
            "sympathetic_level" => self.sympathetic_level = value.clamp(0.0, 1.0),
            "body_resonance" => self.body_resonance = value.clamp(0.0, 1.0),
            "tone_color" => self.tone_color = value.clamp(-1.0, 1.0),
            "stretch_amount" => self.stretch_amount = value.clamp(0.0, 2.0),
            "attack_bite" => self.attack_bite = value.clamp(0.0, 2.0),
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
    /// on another (audit MD-2). Pedal, damper and release-noise handling is
    /// shared with `note_off`; only the voice release is narrowed.
    pub fn note_off_on_channel(&mut self, midi_note: u8, channel: u8) {
        let mut sounding_on_other_channel = false;
        for voice in self.voices.iter() {
            if !voice.is_idle() && voice.is_held() && voice.midi_note() == midi_note {
                if voice.channel() != channel {
                    sounding_on_other_channel = true;
                }
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
                voice.note_off();
            }
        }
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        let frames = left.len().min(right.len());
        self.apply_damper_state();
        // Per-note bend is resolved once per block, and only for voices whose
        // bend actually moved (audit MD-2).
        for voice in self.voices.iter_mut() {
            voice.apply_pending_bend();
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

            // 2. Sympathetic bank: combine preset send with model level.
            let sym_amount = self.sympathetic_send * self.sympathetic_level * 2.0;
            let sympathetic = self.sympathetic.tick(bridge) * sym_amount;

            // 3. Soundboard receives bridge + sympathetic. Model body_resonance
            //    scales the drive into the soundboard.
            let sb_drive = bridge + sympathetic;
            let (sb_l_raw, sb_r_raw) = self.soundboard.tick(sb_drive);
            let body = self.body_resonance;
            let sb_l = sb_l_raw * body;
            let sb_r = sb_r_raw * body;

            // 4. Mechanical noise is summed at the output (noise-floor layer).
            let noise_sample = self.noise.tick();

            // 5. Dry voice signal + stereo soundboard + noise.
            // Combined tilt from preset tone_tilt and model tone_color.
            // tone_tilt: -1..+1 from preset, tone_color: -1..+1 from model.
            let combined_tilt = (self.tone_tilt + self.tone_color * 0.5).clamp(-1.0, 1.0);
            let tilt_dry = (1.0 - self.soundboard_send) + combined_tilt * 0.5;
            // soundboard_brightness scales how much the soundboard contributes.
            let tilt_sb =
                self.soundboard_send * self.soundboard_brightness * 2.0 - combined_tilt * 0.5;
            let mono = bridge * tilt_dry.clamp(0.0, 1.0)
                + (sb_l + sb_r) * 0.5 * tilt_sb.clamp(0.0, 1.0)
                + sympathetic
                + noise_sample;
            let side = (sb_l - sb_r) * 0.5 * tilt_sb.clamp(0.0, 1.0);

            // Stereo width: 0 = mono, 1 = full stereo spread.
            let w = self.stereo_width;
            let sample_l = (mono + side * w) * self.master_gain;
            let sample_r = (mono - side * w) * self.master_gain;
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
        if self.voices.iter().any(|voice| !voice.is_idle()) {
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
        self.pedals.clear_playing_keys();
        self.soundboard.reset();
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
    fn voice_pool_overflow_steals_a_voice() {
        let mut engine = GrandBouleEngine::new(48_000.0, 4);
        engine.note_on(60, 0.8);
        engine.note_on(62, 0.8);
        engine.note_on(64, 0.8);
        engine.note_on(66, 0.8);
        engine.note_on(68, 0.8);
        let midis: Vec<u8> = engine
            .voices
            .iter()
            .map(|voice| voice.midi_note())
            .collect();
        assert!(midis.contains(&68));
    }

    #[test]
    fn highest_and_lowest_notes_are_protected() {
        let mut engine = GrandBouleEngine::new(48_000.0, 3);
        engine.note_on(30, 0.9);
        engine.note_on(60, 0.3);
        engine.note_on(100, 0.9);
        engine.note_on(70, 0.9);
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

        // Steinway D defaults
        let (peak_s, energy_s) = measure(1.0, 1.0, 0.55, 0.6, 0.0);
        // Bösendorfer: softer, heavier, darker
        let (peak_b, energy_b) = measure(0.6, 1.4, 0.25, 0.9, -0.7);
        // Yamaha CFX: harder, lighter, brighter
        let (peak_y, energy_y) = measure(1.5, 0.7, 0.85, 0.35, 0.7);

        eprintln!("\n--- Model comparison (C4, v=0.8, 1s) ---");
        eprintln!("  Steinway:    peak={peak_s:.6} energy={energy_s:.4}");
        eprintln!("  Bösendorfer: peak={peak_b:.6} energy={energy_b:.4}");
        eprintln!("  Yamaha CFX:  peak={peak_y:.6} energy={energy_y:.4}");

        // The models must produce measurably different output.
        let peak_range = (peak_s - peak_b).abs().max((peak_s - peak_y).abs());
        let energy_range = (energy_s - energy_b).abs().max((energy_s - energy_y).abs());
        assert!(
            peak_range > 0.001 || energy_range > 0.01,
            "model params should produce different peak/energy: peak_range={peak_range}, energy_range={energy_range}"
        );
    }

    #[test]
    fn stretch_amount_changes_audio_output_at_treble() {
        // Property: at C8 the smooth Steinway D Railsback offset is ~+45 c,
        // so an engine with `stretch_amount = 0` (correction folded back to
        // equal temperament) must produce a *different* sample stream than
        // one with `stretch_amount = 1` (full stretch). We render both for
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

    /// A grand piano has one string group per key, and the engine models that:
    /// a second note-on at a sounding pitch retriggers the same voice rather
    /// than allocating a second one. Two member channels therefore cannot hold
    /// one pitch here — recorded because it is the reason the cross-channel
    /// coexistence case is untestable on this engine, and because the surviving
    /// voice must take the newer channel or its expression would be orphaned.
    #[test]
    fn a_same_pitch_note_on_retriggers_the_key_voice_and_takes_the_new_channel() {
        let mut engine = GrandBouleEngine::new(48_000.0, 8);
        engine.note_on_with_channel(69, 0.8, 2);
        engine.note_on_with_channel(69, 0.8, 3);

        assert_eq!(
            voices_at(&engine, 69),
            vec![(3, true, 1.0)],
            "one key, one string group — the newer member channel owns it"
        );

        engine.note_expression(69, 3, 12.0, 0.0, 0.0);
        let bent = voices_at(&engine, 69);
        assert!((bent[0].2 - 2.0).abs() < 1.0e-4);
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
}
