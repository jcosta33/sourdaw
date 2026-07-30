//! Layer — a self-contained synthesis layer within Fermenter.
//! Each layer has its own voice pool, engine selection, filter model,
//! envelope settings, and modulation amounts. Layers mix to the master output.

use super::filter::FilterMode;
use super::modulation::ModMatrix;
use super::oscillator::Wavetable;
use super::params::SmoothedParam;
use super::voice::{Voice, VoiceParams};

const MAX_VOICES_PER_LAYER: usize = 16;

pub struct Layer {
    pub voices: Vec<Voice>,
    pub mod_matrix: ModMatrix,

    // Per-layer settings
    pub engine: u8,
    pub osc_waveform: u8,
    pub filter_mode: u8,
    pub filter_model: u8,

    // Per-layer smoothed params
    pub cutoff: SmoothedParam,
    pub resonance: SmoothedParam,

    // Per-layer envelope params
    pub amp_attack: f32,
    pub amp_decay: f32,
    pub amp_sustain: f32,
    pub amp_release: f32,
    pub filter_attack: f32,
    pub filter_decay: f32,
    pub filter_sustain: f32,
    pub filter_release: f32,

    // Per-layer mix
    pub level: f32,
    pub pan: f32,
    pub muted: bool,
    pub solo: bool,

    // Per-layer specific params
    pub osc_level: f32,
    pub filter_drive: f32,
    pub filter_keytrack: f32,
    pub filter_env_amount: f32,
    pub noise_level: f32,
    pub noise_color: u8,
    pub unison_voices: usize,
    pub unison_detune: f32,
    pub unison_spread: f32,
    pub lfo_rate: SmoothedParam,
    pub lfo_shape: u8,
    pub lfo_pitch_amount: f32,
    pub lfo_filter_amount: f32,
    pub portamento_time: f32,
    pub portamento_mode: u8,
    pub pulse_width: f32,
    pub osc_coarse: f32,
    pub osc_fine: f32,
    pub mseg_to_filter: f32,
    pub seq_rate: f32,
    pub seq_to_pitch: f32,

    // KS params
    pub ks_damping: f32,
    pub ks_brightness: f32,

    // Granular params
    pub grain_density: f32,
    pub grain_size: f32,
    pub grain_position: f32,
    pub grain_spray: f32,
    pub grain_pitch_var: f32,
    pub grain_pan_spread: f32,

    // Additive params
    pub additive_partials: usize,
    pub additive_tilt: f32,
    pub additive_odd: f32,
    pub additive_inharm: f32,

    // Sampler params
    pub sampler_mode: u8,
    pub sampler_start: f32,
    pub sampler_end: f32,

    // Per-voice drive
    pub voice_drive: f32,

    // Time-domain warp
    pub warp_mode: u8,
    pub warp_amount: f32,

    // Audio-rate modulation
    pub audio_mod_rate: f32,
    pub audio_mod_depth: f32,
    pub audio_mod_target: u8,

    // Chaos modulators
    pub chaos_amount: f32,
    pub chaos_speed: f32,

    // FM params
    pub fm_algorithm: u8,
    pub fm_ratio: [f32; 4],
    pub fm_level: [f32; 4],
    pub fm_feedback: f32,
    pub fm_mod_amount: f32,

    sample_rate: f32,
}

impl Layer {
    pub fn new(sample_rate: f32) -> Self {
        let mut voices = Vec::with_capacity(MAX_VOICES_PER_LAYER);
        for _ in 0..MAX_VOICES_PER_LAYER {
            voices.push(Voice::new(sample_rate));
        }

        Self {
            voices,
            mod_matrix: ModMatrix::new(),
            engine: 0,
            osc_waveform: 1, // Saw
            filter_mode: 0,  // Lowpass
            filter_model: 0,
            cutoff: SmoothedParam::new(5000.0, 5.0, sample_rate),
            resonance: SmoothedParam::new(1.0, 5.0, sample_rate),
            amp_attack: 0.01,
            amp_decay: 0.2,
            amp_sustain: 0.7,
            amp_release: 0.3,
            filter_attack: 0.01,
            filter_decay: 0.3,
            filter_sustain: 0.0,
            filter_release: 0.3,
            level: 1.0,
            pan: 0.0,
            muted: false,
            solo: false,
            osc_level: 0.8,
            filter_drive: 0.0,
            filter_keytrack: 0.0,
            filter_env_amount: 0.5,
            noise_level: 0.0,
            noise_color: 0,
            unison_voices: 1,
            unison_detune: 0.0,
            unison_spread: 0.5,
            lfo_rate: SmoothedParam::new(0.0, 10.0, sample_rate),
            lfo_shape: 0,
            lfo_pitch_amount: 0.0,
            lfo_filter_amount: 0.0,
            portamento_time: 0.0,
            portamento_mode: 0,
            pulse_width: 0.5,
            osc_coarse: 0.0,
            osc_fine: 0.0,
            mseg_to_filter: 0.0,
            seq_rate: 4.0,
            seq_to_pitch: 0.0,
            ks_damping: 0.5,
            ks_brightness: 0.8,
            grain_density: 20.0,
            grain_size: 50.0,
            grain_position: 0.0,
            grain_spray: 0.1,
            grain_pitch_var: 0.0,
            grain_pan_spread: 0.5,
            additive_partials: 32,
            additive_tilt: 0.0,
            additive_odd: 0.0,
            additive_inharm: 0.0,
            sampler_mode: 0,
            sampler_start: 0.0,
            sampler_end: 1.0,
            voice_drive: 0.0,
            warp_mode: 0,
            warp_amount: 0.0,
            audio_mod_rate: 0.0,
            audio_mod_depth: 0.0,
            audio_mod_target: 0,
            chaos_amount: 0.0,
            chaos_speed: 1.0,
            fm_algorithm: 0,
            fm_ratio: [1.0, 1.0, 1.0, 1.0],
            fm_level: [1.0, 1.0, 1.0, 1.0],
            fm_feedback: 0.0,
            fm_mod_amount: 1.0,
            sample_rate,
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: u8) {
        self.note_on_with_channel(note, velocity, 0);
    }

    /// Note-on carrying the MPE member channel that owns the note. Channel 0
    /// is the non-MPE default and what `note_on` uses.
    pub fn note_on_with_channel(&mut self, note: u8, velocity: u8, channel: u8) {
        let vel = velocity as f32 / 127.0;

        // Find a free voice, or steal the quietest
        let mut target = None;

        // Priority 1: inactive voice
        for (i, v) in self.voices.iter().enumerate() {
            if !v.is_active() {
                target = Some(i);
                break;
            }
        }

        // Priority 2: steal voice with lowest amplitude
        if target.is_none() {
            let mut best_idx = 0;
            let mut lowest_amp = f32::MAX;
            for (i, v) in self.voices.iter().enumerate() {
                let amp = v.get_amp_level();
                if amp < lowest_amp {
                    lowest_amp = amp;
                    best_idx = i;
                }
            }
            target = Some(best_idx);
            self.voices[best_idx].start_steal();
        }

        if let Some(idx) = target {
            let voice = &mut self.voices[idx];
            // Set engine BEFORE note_on so the voice knows which engine to use
            voice.set_engine(self.engine, self.sample_rate);
            voice.set_ks_damping(self.ks_damping);
            voice.set_additive_partials(self.additive_partials);
            voice.set_additive_tilt(self.additive_tilt);
            voice.set_additive_odd(self.additive_odd);
            voice.set_additive_inharm(self.additive_inharm);
            voice.set_sampler_params(self.sampler_mode, self.sampler_start, self.sampler_end);
            voice.note_on(note, channel, vel, self.sample_rate);
            voice.set_envelopes(
                self.amp_attack,
                self.amp_decay,
                self.amp_sustain,
                self.amp_release,
                self.filter_attack,
                self.filter_decay,
                self.filter_sustain,
                self.filter_release,
            );
            // Excite Karplus-Strong at note-on time (after note_on reset)
            if self.engine == 3 {
                let freq = 440.0 * 2.0f32.powf((note as f32 - 69.0) / 12.0);
                voice.excite_ks(freq, self.sample_rate, self.ks_brightness);
            }
            // Trigger sampler at note-on time
            if self.engine == 6 {
                let pitch_ratio = 2.0f32.powf((note as f32 - 60.0) / 12.0);
                voice.trigger_sampler(pitch_ratio);
            }
        }
    }

    pub fn note_off(&mut self, note: u8) {
        self.note_off_matching(note, None);
    }

    /// Release the voices sounding `note`. `channel` narrows the release to one
    /// MPE member channel; `None` releases every voice at that pitch, which is
    /// the historical behaviour and what callers that do not track channels
    /// (scheduled playback, all-notes-off) still get — so a caller can never
    /// leave a voice hanging by omitting the channel.
    pub fn note_off_matching(&mut self, note: u8, channel: Option<u8>) {
        for voice in &mut self.voices {
            if !voice.active || voice.note != note {
                continue;
            }
            if let Some(target) = channel {
                if voice.channel != target {
                    continue;
                }
            }
            voice.note_off();
        }
    }

    /// Route MPE per-note expression to the voices currently *held* on
    /// `channel` at `note` (audit MD-2).
    ///
    /// The address is (channel, note, held) — not note alone. Two voices can
    /// sound one pitch at the same time: a same-pitch retrigger over a still-
    /// ringing release tail (the tail is `active` but no longer `held`), and a
    /// genuine MPE overlap where two member channels carry the same pitch.
    /// Addressing by note alone bends both, which is precisely the per-note
    /// promise this exists to keep. Layer/unison stacking still means one held
    /// note can own several voices, so every match is addressed.
    pub fn note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        for voice in &mut self.voices {
            if voice.active && voice.held && voice.note == note && voice.channel == channel {
                voice.set_expression(bend_semitones, pressure, slide);
            }
        }
    }

    pub fn all_notes_off(&mut self) {
        for voice in &mut self.voices {
            if voice.active {
                voice.note_off();
            }
        }
    }

    /// Render all active voices with this layer's params, applying level and pan.
    pub fn render(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        tables: &[Wavetable],
        sample_rate: f32,
    ) {
        if self.muted {
            return;
        }

        let cutoff = self.cutoff.tick();
        let resonance = self.resonance.tick();
        let lfo_rate = self.lfo_rate.tick();

        let filter_mode = match self.filter_mode {
            0 => FilterMode::Lowpass,
            1 => FilterMode::Highpass,
            2 => FilterMode::Bandpass,
            _ => FilterMode::Notch,
        };

        // Set parameters on active voices
        for voice in &mut self.voices {
            if !voice.is_active() {
                continue;
            }
            voice.set_envelopes(
                self.amp_attack,
                self.amp_decay,
                self.amp_sustain,
                self.amp_release,
                self.filter_attack,
                self.filter_decay,
                self.filter_sustain,
                self.filter_release,
            );
            voice.set_noise(self.noise_level, self.noise_color);
            voice.set_unison(self.unison_voices, self.unison_detune, self.unison_spread);
            voice.set_engine(self.engine, self.sample_rate);
            voice.set_pulse_width(self.pulse_width);
            voice.set_portamento(self.portamento_time, sample_rate);
            voice.set_ks_damping(self.ks_damping);
            voice.set_granular_params(
                self.grain_density,
                self.grain_size,
                self.grain_position,
                self.grain_spray,
                self.grain_pitch_var,
                self.grain_pan_spread,
            );
            voice.configure_fm(
                self.fm_algorithm,
                &self.fm_ratio,
                &self.fm_level,
                self.fm_feedback,
                self.fm_mod_amount,
            );
            voice.set_sampler_params(self.sampler_mode, self.sampler_start, self.sampler_end);
        }

        // Build per-block voice params
        let voice_params = VoiceParams {
            tables,
            base_cutoff: cutoff,
            resonance,
            filter_mode,
            filter_drive: self.filter_drive,
            filter_keytrack: self.filter_keytrack,
            lfo_rate,
            lfo_shape: self.lfo_shape,
            lfo_filter_amount: self.lfo_filter_amount,
            mod_matrix: &self.mod_matrix,
            sample_rate,
            osc_level: self.osc_level,
            osc_coarse: self.osc_coarse,
            osc_fine: self.osc_fine,
            filter_model: self.filter_model,
            mseg_to_filter: self.mseg_to_filter,
            seq_rate: self.seq_rate,
            seq_to_pitch: self.seq_to_pitch,
            per_voice_drive: self.voice_drive,
            warp_mode: self.warp_mode,
            warp_amount: self.warp_amount,
            audio_mod_rate: self.audio_mod_rate,
            audio_mod_depth: self.audio_mod_depth,
            audio_mod_target: self.audio_mod_target,
            chaos_amount: self.chaos_amount,
            chaos_speed: self.chaos_speed,
        };

        // Apply level and pan
        let level = self.level;
        let pan = self.pan;
        // Equal power pan
        let pan_l = ((1.0 - pan) * 0.5 * std::f32::consts::FRAC_PI_2)
            .cos()
            .min(1.0);
        let pan_r = ((1.0 + pan) * 0.5 * std::f32::consts::FRAC_PI_2)
            .cos()
            .min(1.0);
        let gain_l = level * pan_l;
        let gain_r = level * pan_r;

        // If level is 1.0 and pan is centered, render directly (no extra multiply)
        let direct = (level - 1.0).abs() < 0.001 && pan.abs() < 0.001;

        if direct {
            // Render directly into output buffers (same as original code path)
            for voice in &mut self.voices {
                if voice.is_active() {
                    voice.render(left, right, &voice_params);
                }
            }
        } else {
            // Render into scratch, then apply gain
            let block_size = left.len();
            // Use small stack buffers for the layer render
            let mut scratch_l = [0.0f32; 4096];
            let mut scratch_r = [0.0f32; 4096];

            let l_slice = &mut scratch_l[..block_size];
            let r_slice = &mut scratch_r[..block_size];

            for voice in &mut self.voices {
                if voice.is_active() {
                    voice.render(l_slice, r_slice, &voice_params);
                }
            }

            for i in 0..block_size {
                left[i] += l_slice[i] * gain_l;
                right[i] += r_slice[i] * gain_r;
            }
        }
    }

    pub fn advance_silent_block(&mut self) {
        self.cutoff.tick();
        self.resonance.tick();
        self.lfo_rate.tick();
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "cutoff" => self.cutoff.set(value.clamp(20.0, 20000.0)),
            "resonance" => self.resonance.set(value.clamp(0.5, 20.0)),
            "lfo_rate" => self.lfo_rate.set(value.clamp(0.0, 5000.0)),
            "osc_waveform" => self.osc_waveform = (value as u8).min(3),
            "filter_mode" => self.filter_mode = (value as u8).min(3),
            "amp_attack" => self.amp_attack = value.clamp(0.001, 5.0),
            "amp_decay" => self.amp_decay = value.clamp(0.001, 5.0),
            "amp_sustain" => self.amp_sustain = value.clamp(0.0, 1.0),
            "amp_release" => self.amp_release = value.clamp(0.001, 10.0),
            "filter_attack" => self.filter_attack = value.clamp(0.001, 5.0),
            "filter_decay" => self.filter_decay = value.clamp(0.001, 5.0),
            "filter_sustain" => self.filter_sustain = value.clamp(0.0, 1.0),
            "filter_release" => self.filter_release = value.clamp(0.001, 10.0),
            "mod_env_to_filter" => {
                self.mod_matrix.slots[0].amount = value.clamp(-1.0, 1.0);
            }
            "mod_lfo_to_pitch" => {
                self.mod_matrix.slots[1].amount = value.clamp(-1.0, 1.0);
            }
            "noise_level" => self.noise_level = value.clamp(0.0, 1.0),
            "noise_color" => self.noise_color = (value as u8).min(2),
            "unison_voices" => self.unison_voices = (value as usize).clamp(1, 16),
            "unison_detune" => self.unison_detune = value.clamp(0.0, 100.0),
            "unison_spread" => self.unison_spread = value.clamp(0.0, 1.0),
            "filter_drive" => self.filter_drive = value.clamp(0.0, 10.0),
            "portamento" => self.portamento_time = value.clamp(0.0, 5.0),
            "portamento_mode" => self.portamento_mode = (value as u8).min(1),
            "engine" => self.engine = (value as u8).min(6),
            "filter_model" => self.filter_model = (value as u8).min(5),
            "ks_damping" => self.ks_damping = value.clamp(0.0, 0.99),
            "ks_brightness" => self.ks_brightness = value.clamp(0.1, 1.0),
            "grain_density" => self.grain_density = value.clamp(1.0, 100.0),
            "grain_size" => self.grain_size = value.clamp(5.0, 500.0),
            "grain_position" => self.grain_position = value.clamp(0.0, 1.0),
            "grain_spray" => self.grain_spray = value.clamp(0.0, 1.0),
            "grain_pitch_var" => self.grain_pitch_var = value.clamp(0.0, 12.0),
            "grain_pan_spread" => self.grain_pan_spread = value.clamp(0.0, 1.0),
            "fm_algorithm" => self.fm_algorithm = (value as u8).min(7),
            "fm_ratio1" => self.fm_ratio[0] = value.clamp(0.1, 32.0),
            "fm_ratio2" => self.fm_ratio[1] = value.clamp(0.1, 32.0),
            "fm_ratio3" => self.fm_ratio[2] = value.clamp(0.1, 32.0),
            "fm_ratio4" => self.fm_ratio[3] = value.clamp(0.1, 32.0),
            "fm_level1" => self.fm_level[0] = value.clamp(0.0, 1.0),
            "fm_level2" => self.fm_level[1] = value.clamp(0.0, 1.0),
            "fm_level3" => self.fm_level[2] = value.clamp(0.0, 1.0),
            "fm_level4" => self.fm_level[3] = value.clamp(0.0, 1.0),
            "fm_feedback" => self.fm_feedback = value.clamp(0.0, 1.0),
            "fm_mod_amount" => self.fm_mod_amount = value.clamp(0.0, 10.0),
            "pulse_width" => self.pulse_width = value.clamp(0.05, 0.95),
            "osc_level" => self.osc_level = value.clamp(0.0, 1.0),
            "osc_coarse" => self.osc_coarse = value.clamp(-24.0, 24.0),
            "osc_fine" => self.osc_fine = value.clamp(-100.0, 100.0),
            "filter_keytrack" => self.filter_keytrack = value.clamp(0.0, 1.0),
            "lfo_shape" => self.lfo_shape = (value as u8).min(3),
            "lfo_filter_amount" => self.lfo_filter_amount = value.clamp(-1.0, 1.0),
            "mseg_to_filter" => self.mseg_to_filter = value.clamp(-1.0, 1.0),
            "seq_rate" => self.seq_rate = value.clamp(0.5, 20.0),
            "seq_to_pitch" => self.seq_to_pitch = value.clamp(-1.0, 1.0),
            "layer_level" => self.level = value.clamp(0.0, 1.0),
            "layer_pan" => self.pan = value.clamp(-1.0, 1.0),
            "layer_mute" => self.muted = value > 0.5,
            "layer_solo" => self.solo = value > 0.5,
            "drift" => {
                for voice in &mut self.voices {
                    voice.set_drift(value);
                }
            }
            "additive_partials" => {
                let n = (value as usize).clamp(1, 64);
                self.additive_partials = n;
                for voice in &mut self.voices {
                    voice.set_additive_partials(n);
                }
            }
            "additive_tilt" => {
                self.additive_tilt = value.clamp(-6.0, 6.0);
                for voice in &mut self.voices {
                    voice.set_additive_tilt(self.additive_tilt);
                }
            }
            "additive_odd" => {
                self.additive_odd = value.clamp(0.0, 1.0);
                for voice in &mut self.voices {
                    voice.set_additive_odd(self.additive_odd);
                }
            }
            "additive_inharm" => {
                self.additive_inharm = value.clamp(0.0, 0.1);
                for voice in &mut self.voices {
                    voice.set_additive_inharm(self.additive_inharm);
                }
            }
            "sampler_mode" => self.sampler_mode = (value as u8).min(2),
            "sampler_start" => self.sampler_start = value.clamp(0.0, 0.99),
            "sampler_end" => self.sampler_end = value.clamp(0.01, 1.0),
            "voice_drive" => self.voice_drive = value.clamp(0.0, 10.0),
            "warp_mode" => self.warp_mode = (value as u8).min(6),
            "warp_amount" => self.warp_amount = value.clamp(0.0, 1.0),
            "audio_mod_rate" => self.audio_mod_rate = value.clamp(0.0, 5000.0),
            "audio_mod_depth" => self.audio_mod_depth = value.clamp(0.0, 1.0),
            "audio_mod_target" => self.audio_mod_target = (value as u8).min(3),
            "chaos_amount" => self.chaos_amount = value.clamp(0.0, 1.0),
            "chaos_speed" => self.chaos_speed = value.clamp(0.01, 10.0),
            _ => {} // Unknown param — ignore silently
        }
    }

    pub fn active_voice_count(&self) -> usize {
        self.voices.iter().filter(|v| v.is_active()).count()
    }
}

#[cfg(test)]
mod tests {
    use super::Layer;

    #[test]
    fn mapped_oscillator_and_filter_params_update_layer_state() {
        let mut layer = Layer::new(48_000.0);

        layer.set_param("engine", 6.0);
        layer.set_param("osc_waveform", 3.0);
        layer.set_param("osc_level", 0.25);
        layer.set_param("cutoff", 1_234.0);
        layer.set_param("resonance", 7.0);
        layer.set_param("filter_model", 5.0);
        layer.set_param("filter_mode", 2.0);
        layer.set_param("mod_env_to_filter", -0.75);
        layer.set_param("mod_lfo_to_pitch", 0.5);

        assert_eq!(layer.engine, 6);
        assert_eq!(layer.osc_waveform, 3);
        assert_eq!(layer.osc_level, 0.25);
        assert_eq!(layer.cutoff.target(), 1_234.0);
        assert_eq!(layer.resonance.target(), 7.0);
        assert_eq!(layer.filter_model, 5);
        assert_eq!(layer.filter_mode, 2);
        assert_eq!(layer.mod_matrix.slots[0].amount, -0.75);
        assert_eq!(layer.mod_matrix.slots[1].amount, 0.5);
    }

    #[test]
    fn mapped_engine_specific_params_update_layer_state() {
        let mut layer = Layer::new(48_000.0);

        layer.set_param("ks_damping", 0.9);
        layer.set_param("grain_density", 40.0);
        layer.set_param("grain_pan_spread", 0.8);
        layer.set_param("additive_partials", 12.0);
        layer.set_param("additive_tilt", 3.0);
        layer.set_param("additive_odd", 0.75);
        layer.set_param("additive_inharm", 0.04);
        layer.set_param("fm_algorithm", 7.0);
        layer.set_param("fm_ratio1", 2.5);
        layer.set_param("sampler_mode", 2.0);
        layer.set_param("warp_mode", 6.0);
        layer.set_param("audio_mod_target", 3.0);
        layer.set_param("chaos_amount", 0.4);

        assert_eq!(layer.ks_damping, 0.9);
        assert_eq!(layer.grain_density, 40.0);
        assert_eq!(layer.grain_pan_spread, 0.8);
        assert_eq!(layer.additive_partials, 12);
        assert_eq!(layer.additive_tilt, 3.0);
        assert_eq!(layer.additive_odd, 0.75);
        assert_eq!(layer.additive_inharm, 0.04);
        assert_eq!(layer.fm_algorithm, 7);
        assert_eq!(layer.fm_ratio[0], 2.5);
        assert_eq!(layer.sampler_mode, 2);
        assert_eq!(layer.warp_mode, 6);
        assert_eq!(layer.audio_mod_target, 3);
        assert_eq!(layer.chaos_amount, 0.4);
    }

    // ── Per-note expression targeting (audit MD-2, review round 1) ─────────
    //
    // Two voices can sound one pitch at the same time. Addressing expression by
    // MIDI note alone bends both, which breaks the per-note promise. These
    // assert on voice state — which voice carries which bend — because the
    // defect is exactly a mis-addressed voice.

    /// Bends carried by every currently active voice at `note`, oldest slot
    /// first, paired with whether that voice is still held.
    fn active_bends_at(layer: &Layer, note: u8) -> Vec<(bool, f32)> {
        layer
            .voices
            .iter()
            .filter(|voice| voice.active && voice.note == note)
            .map(|voice| (voice.held, voice.expression().0))
            .collect()
    }

    #[test]
    fn expression_skips_a_still_ringing_voice_at_the_same_pitch() {
        let mut layer = Layer::new(48_000.0);
        // Long release so the first voice is unambiguously still active.
        layer.set_param("release", 2.0);
        layer.note_on(60, 100);
        layer.note_off(60);
        layer.note_on(60, 100);

        let before = active_bends_at(&layer, 60);
        assert_eq!(
            before.len(),
            2,
            "the release tail and the retrigger must both be active"
        );
        assert_eq!(before[0].0, false, "the first voice is releasing, not held");
        assert_eq!(before[1].0, true, "the retrigger is held");

        layer.note_expression(60, 0, 12.0, 0.0, 0.0);

        assert_eq!(
            active_bends_at(&layer, 60),
            vec![(false, 0.0), (true, 12.0)],
            "only the held voice may take the bend; the ringing tail keeps its pitch"
        );
    }

    #[test]
    fn expression_does_not_cross_mpe_member_channels_at_one_pitch() {
        let mut layer = Layer::new(48_000.0);
        // Two member channels holding the same pitch — ordinary MPE.
        layer.note_on_with_channel(60, 100, 2);
        layer.note_on_with_channel(60, 100, 3);

        layer.note_expression(60, 2, 12.0, 0.5, 0.25);

        let channels: Vec<(u8, f32, f32, f32)> = layer
            .voices
            .iter()
            .filter(|voice| voice.active && voice.note == 60)
            .map(|voice| {
                let (bend, pressure, slide) = voice.expression();
                (voice.channel, bend, pressure, slide)
            })
            .collect();

        assert_eq!(
            channels,
            vec![(2, 12.0, 0.5, 0.25), (3, 0.0, 0.0, 0.0)],
            "expression on one member channel must not reach the other"
        );
    }

    #[test]
    fn note_off_can_be_narrowed_to_one_member_channel() {
        let mut layer = Layer::new(48_000.0);
        layer.note_on_with_channel(60, 100, 2);
        layer.note_on_with_channel(60, 100, 3);

        layer.note_off_matching(60, Some(2));

        let held: Vec<(u8, bool)> = layer
            .voices
            .iter()
            .filter(|voice| voice.active && voice.note == 60)
            .map(|voice| (voice.channel, voice.held))
            .collect();
        assert_eq!(
            held,
            vec![(2, false), (3, true)],
            "releasing one member channel must leave the other sounding"
        );
    }

    #[test]
    fn channel_agnostic_note_off_still_releases_every_voice_at_the_pitch() {
        let mut layer = Layer::new(48_000.0);
        layer.note_on_with_channel(60, 100, 2);
        layer.note_on_with_channel(60, 100, 3);

        // What channel-unaware callers (scheduled playback, panic) get: no
        // voice can be left hanging by omitting the channel.
        layer.note_off(60);

        let held: Vec<bool> = layer
            .voices
            .iter()
            .filter(|voice| voice.active && voice.note == 60)
            .map(|voice| voice.held)
            .collect();
        assert_eq!(held, vec![false, false]);
    }
}
