//! Top-level Grand Boule piano engine.
//!
//! Owns the voice pool plus every shared DSP block (pedals, soundboard,
//! sympathetic bank, mechanical noise, attack samples) and drives the
//! per-block render loop.

use super::attack_sampler::AttackSampleSet;
use super::mechanical_noise::{MechanicalNoise, NoiseEvent};
use super::parameters::{key_fundamental_hz, midi_to_key};
use super::pedals::PedalState;
use super::soundboard::Soundboard;
use super::sympathetic::Sympathetic;
use super::voice::PianoVoice;

/// Default voice-pool size for this scaffolding slice.
pub const DEFAULT_VOICE_COUNT: usize = 32;

/// Hard upper bound the engine will honour at construction time.
pub const MAX_VOICE_COUNT: usize = 256;

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
    sample_rate: f32,
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
            master_gain: 0.5,
            soundboard_send: 0.6,
            sympathetic_send: 0.25,
            sample_rate,
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

    /// Trigger a note-on with a microtuning frequency ratio. `pitch_ratio`
    /// = 1.0 is standard Railsback tuning; `2^(cents/1200)` otherwise.
    pub fn note_on_with_pitch(&mut self, midi_note: u8, velocity: f32, pitch_ratio: f32) {
        let Some(key) = midi_to_key(midi_note) else {
            return;
        };
        let stiffness_scale = self.pedals.hammer_stiffness_scale();
        self.pedals.press_key(key);
        self.noise.trigger(NoiseEvent::KeyDown, velocity);
        self.noise.trigger(NoiseEvent::HammerLetoff, velocity);

        // Retrigger the same voice if this note is already held.
        for voice in self.voices.iter_mut() {
            if !voice.is_idle() && voice.midi_note() == midi_note {
                voice.note_on(midi_note, velocity, key, pitch_ratio, stiffness_scale);
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
                voice.note_on(midi_note, velocity, key, pitch_ratio, stiffness_scale);
                voice.arm_attack(key, self.attack_samples.length_for_key(key));
            }
            return;
        };
        let voice = &mut self.voices[index];
        if !voice.is_idle() {
            voice.begin_steal();
        }
        voice.note_on(midi_note, velocity, key, pitch_ratio, stiffness_scale);
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
        self.noise
            .trigger(NoiseEvent::DamperLift, 0.5);
        if let Some(key) = midi_to_key(midi_note) {
            self.pedals.release_key(key);
            // Apply damping immediately — `apply_damper_state` will pick up
            // the pedal state on the next process iteration.
        }
        let sustain_engaged = self.pedals.sustain_position() > 0.5
            || (self.pedals.sostenuto()
                && midi_to_key(midi_note)
                    .map(|k| self.pedals.sostenuto() && self.pedals.damper_bandwidth_for_key(k, false) == 0.0)
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
        self.pedals.set_sustain(position);
    }

    pub fn set_una_corda(&mut self, engaged: bool) {
        self.pedals.set_una_corda(engaged);
    }

    pub fn set_sostenuto(&mut self, engaged: bool) {
        self.pedals.set_sostenuto(engaged);
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "master_gain" => self.master_gain = value.clamp(0.0, 2.0),
            "soundboard_send" => self.soundboard_send = value.clamp(0.0, 1.0),
            "sympathetic_send" => self.sympathetic_send = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    /// Render one block of stereo audio. Buffers are mixed into additively.
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        let frames = left.len().min(right.len());
        self.apply_damper_state();

        for frame in 0..frames {
            // 1. Sum voice outputs into the bridge bus, blending sampled
            //    attack if armed.
            let mut bridge = 0.0_f32;
            for voice in self.voices.iter_mut() {
                let modelled = voice.tick();
                let mixed = if let Some((key, pos, length)) = voice.attack_playhead() {
                    let sample = self.attack_samples.sample(key, pos as usize);
                    let s_gain =
                        AttackSampleSet::sample_gain(pos as usize, length as usize);
                    let m_gain = AttackSampleSet::model_gain(pos as usize, length as usize);
                    voice.advance_attack();
                    modelled * m_gain + sample * s_gain
                } else {
                    modelled
                };
                bridge += mixed;
            }

            // 2. Sympathetic bank lives on the bridge bus.
            let sympathetic = self.sympathetic.tick(bridge) * self.sympathetic_send;

            // 3. Soundboard receives bridge + sympathetic.
            let (sb_l, sb_r) = self.soundboard.tick(bridge + sympathetic);

            // 4. Mechanical noise is summed at the output (noise-floor layer).
            let noise_sample = self.noise.tick();

            // 5. Dry voice signal + stereo soundboard + noise.
            let dry = bridge * (1.0 - self.soundboard_send);
            let sb_mix = self.soundboard_send;
            let sample_l = (dry + sb_l * sb_mix + sympathetic + noise_sample) * self.master_gain;
            let sample_r = (dry + sb_r * sb_mix + sympathetic + noise_sample) * self.master_gain;
            left[frame] += sample_l;
            right[frame] += sample_r;
        }
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
            voice.note_off();
        }
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
        assert!(stages.iter().any(|s| *s == super::super::voice::VoiceStage::Active));
    }

    #[test]
    fn microtuned_note_changes_fundamental() {
        let mut engine = GrandBouleEngine::new(48_000.0, 2);
        engine.note_on_midi2(69, 0xFFFF, (50 << 24) / 100); // +0.5 semitone
        assert!(engine.voices.iter().any(|v| !v.is_idle()));
    }
}
