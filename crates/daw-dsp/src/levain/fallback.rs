//! Fallback tone generator — produces a simple sine wave when no samples are loaded.
//!
//! This ensures the instrument always makes sound in response to MIDI,
//! even before sample content is available. The tone is a warm sine with
//! a gentle amplitude envelope, suitable for confirming MIDI connectivity
//! and basic playback.

use std::f32::consts::TAU;

/// Maximum fallback voices.
const MAX_FALLBACK_VOICES: usize = 16;

#[derive(Clone, Copy)]
struct FallbackVoice {
    active: bool,
    note: u8,
    phase: f32,
    freq: f32,
    amp: f32,
    amp_target: f32,
    /// Exponential decay coefficient for release.
    release_coeff: f32,
    releasing: bool,
}

impl FallbackVoice {
    fn new() -> Self {
        Self {
            active: false,
            note: 0,
            phase: 0.0,
            freq: 440.0,
            amp: 0.0,
            amp_target: 0.0,
            release_coeff: 0.9995,
            releasing: false,
        }
    }

    fn trigger(&mut self, note: u8, velocity: f32, sample_rate: f32) {
        self.active = true;
        self.note = note;
        self.phase = 0.0;
        self.freq = 440.0 * (2.0_f32).powf((note as f32 - 69.0) / 12.0);
        self.amp_target = velocity * 0.6; // audible through the gain chain
        self.amp = 0.0;
        self.releasing = false;
        // Release: ~300ms decay
        self.release_coeff = (-1.0 / (0.3 * sample_rate)).exp();
    }

    fn release(&mut self) {
        self.releasing = true;
    }

    #[inline]
    fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        // Simple attack (~5ms)
        if !self.releasing {
            self.amp += (self.amp_target - self.amp) * 0.02;
        } else {
            self.amp *= self.release_coeff;
            if self.amp < 1e-5 {
                self.active = false;
                return 0.0;
            }
        }

        // Sine oscillator
        self.phase += self.freq / sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let sine = (self.phase * TAU).sin();

        // Add a touch of second harmonic for warmth
        let harm2 = (self.phase * 2.0 * TAU).sin() * 0.15;

        (sine + harm2) * self.amp
    }
}

/// Fallback tone engine — used when no samples are loaded.
pub struct FallbackToneEngine {
    voices: [FallbackVoice; MAX_FALLBACK_VOICES],
    sample_rate: f32,
    pub enabled: bool,
}

impl FallbackToneEngine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            voices: [FallbackVoice::new(); MAX_FALLBACK_VOICES],
            sample_rate,
            // Armed from construction, which is what the module header above
            // promises: the fallback covers the window before sample content
            // exists, and a freshly built engine is squarely inside it.
            //
            // This used to be `false`, leaving the only writer that turns it on
            // as `LevainEngine::clear_zones`. Every shipped load path happens to
            // clear zones before playing a note, so the sine did sound during a
            // normal load — but an engine that had never *begun* a load was
            // mute in exactly the state this module exists to cover, and the
            // header claimed otherwise. `build_zone_map` still switches it off
            // once real zones exist, so the sampler owns the output as before.
            enabled: true,
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        if !self.enabled {
            return;
        }

        // Find free voice or steal oldest
        let idx = self.find_free();
        self.voices[idx].trigger(note, velocity, self.sample_rate);
    }

    pub fn note_off(&mut self, note: u8) {
        for voice in self.voices.iter_mut() {
            if voice.active && voice.note == note && !voice.releasing {
                voice.release();
            }
        }
    }

    pub fn release_all(&mut self) {
        for voice in self.voices.iter_mut() {
            if voice.active && !voice.releasing {
                voice.release();
            }
        }
    }

    /// Render one sample (mono).
    #[inline]
    pub fn tick(&mut self) -> f32 {
        let mut sum = 0.0_f32;
        for voice in self.voices.iter_mut() {
            if voice.active {
                sum += voice.tick(self.sample_rate);
            }
        }
        sum
    }

    pub fn has_active_voices(&self) -> bool {
        self.voices.iter().any(|v| v.active)
    }

    pub fn active_count(&self) -> usize {
        self.voices.iter().filter(|v| v.active).count()
    }

    fn find_free(&self) -> usize {
        for (i, v) in self.voices.iter().enumerate() {
            if !v.active {
                return i;
            }
        }
        // Steal oldest releasing voice, or just voice 0
        for (i, v) in self.voices.iter().enumerate() {
            if v.releasing {
                return i;
            }
        }
        0
    }
}
