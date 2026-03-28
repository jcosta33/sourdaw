/// MasterSynth — top-level Fermenter engine.
/// Manages voice pool, processes MIDI, renders audio blocks.

use crate::effects::{PlateReverb, StereoChorus, StereoDelay};
use crate::filter::FilterMode;
use crate::modulation::ModMatrix;
use crate::oscillator::Wavetable;
use crate::params::SmoothedParam;
use crate::voice::Voice;

/// MIDI event passed from JS to WASM.
#[derive(Clone, Copy)]
pub struct MidiEvent {
    pub kind: u8,     // 0=noteOff, 1=noteOn
    pub note: u8,
    pub velocity: u8,
    pub offset: u32,  // Sample offset within the block
}

const MAX_VOICES: usize = 32;

pub struct MasterSynth {
    voices: Vec<Voice>,
    tables: Vec<Wavetable>,
    reverb: PlateReverb,
    delay: StereoDelay,
    chorus: StereoChorus,
    mod_matrix: ModMatrix,
    sample_rate: f32,

    // Smoothed parameters
    pub cutoff: SmoothedParam,
    pub resonance: SmoothedParam,
    pub reverb_mix: SmoothedParam,
    pub reverb_decay: SmoothedParam,
    pub lfo_rate: SmoothedParam,
    pub osc_waveform: u8,
    pub filter_mode: u8,

    // Envelope parameters (applied to new voices)
    pub amp_attack: f32,
    pub amp_decay: f32,
    pub amp_sustain: f32,
    pub amp_release: f32,
    pub filter_attack: f32,
    pub filter_decay: f32,
    pub filter_sustain: f32,
    pub filter_release: f32,

    // Noise parameters
    pub noise_level: f32,
    pub noise_color: u8,

    // Unison parameters
    pub unison_voices: usize,
    pub unison_detune: f32,
    pub unison_spread: f32,

    // Filter drive
    pub filter_drive: f32,

    // Delay parameters
    pub delay_time: f32,
    pub delay_feedback: f32,
    pub delay_mix: f32,

    // Chorus parameters
    pub chorus_rate: f32,
    pub chorus_depth: f32,
    pub chorus_mix: f32,

    // Portamento
    pub portamento_time: f32,

    // Engine: 0=wavetable, 1=polyblep
    pub engine: u8,

    // Pulse width (for polyblep)
    pub pulse_width: f32,

    // Osc level, coarse, fine tuning
    pub osc_level: f32,
    pub osc_coarse: f32,
    pub osc_fine: f32,

    // Filter keytrack
    pub filter_keytrack: f32,

    // LFO shape and filter amount
    pub lfo_shape: u8,
    pub lfo_filter_amount: f32,

    // Portamento mode (0=always, 1=legato)
    pub portamento_mode: u8,

    // Master gain
    pub master_gain: f32,

    // Scratch buffer
    block_left: Vec<f32>,
    block_right: Vec<f32>,
}

impl MasterSynth {
    pub fn new(sample_rate: f32, max_voices: usize) -> Self {
        let voice_count = max_voices.min(MAX_VOICES);
        let mut voices = Vec::with_capacity(voice_count);
        for _ in 0..voice_count {
            voices.push(Voice::new(sample_rate));
        }

        // Pre-compute band-limited wavetables
        let tables = vec![
            Wavetable::sine(),
            Wavetable::saw(),
            Wavetable::square(),
            Wavetable::triangle(),
        ];

        Self {
            voices,
            tables,
            reverb: PlateReverb::new(sample_rate),
            delay: StereoDelay::new(sample_rate),
            chorus: StereoChorus::new(sample_rate),
            mod_matrix: ModMatrix::new(),
            sample_rate,
            cutoff: SmoothedParam::new(5000.0, 5.0, sample_rate),
            resonance: SmoothedParam::new(1.0, 5.0, sample_rate),
            reverb_mix: SmoothedParam::new(0.2, 10.0, sample_rate),
            reverb_decay: SmoothedParam::new(0.5, 10.0, sample_rate),
            lfo_rate: SmoothedParam::new(0.0, 10.0, sample_rate),
            osc_waveform: 1, // Saw
            filter_mode: 0,  // Lowpass
            amp_attack: 0.01,
            amp_decay: 0.2,
            amp_sustain: 0.7,
            amp_release: 0.3,
            filter_attack: 0.01,
            filter_decay: 0.3,
            filter_sustain: 0.0,
            filter_release: 0.3,
            noise_level: 0.0,
            noise_color: 0,
            unison_voices: 1,
            unison_detune: 0.0,
            unison_spread: 0.5,
            filter_drive: 0.0,
            delay_time: 300.0,
            delay_feedback: 0.3,
            delay_mix: 0.0,
            chorus_rate: 1.0,
            chorus_depth: 0.5,
            chorus_mix: 0.0,
            portamento_time: 0.0,
            engine: 0,
            pulse_width: 0.5,
            osc_level: 0.8,
            osc_coarse: 0.0,
            osc_fine: 0.0,
            filter_keytrack: 0.0,
            lfo_shape: 0,
            lfo_filter_amount: 0.0,
            portamento_mode: 0,
            master_gain: 1.0,
            block_left: vec![0.0; 128],
            block_right: vec![0.0; 128],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "cutoff" => self.cutoff.set(value.clamp(20.0, 20000.0)),
            "resonance" => self.resonance.set(value.clamp(0.5, 20.0)),
            "reverb_mix" => self.reverb_mix.set(value.clamp(0.0, 1.0)),
            "reverb_decay" => self.reverb_decay.set(value.clamp(0.0, 0.99)),
            "lfo_rate" => self.lfo_rate.set(value.clamp(0.0, 20.0)),
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
            // Noise
            "noise_level" => self.noise_level = value.clamp(0.0, 1.0),
            "noise_color" => self.noise_color = (value as u8).min(2),
            // Unison
            "unison_voices" => self.unison_voices = (value as usize).clamp(1, 16),
            "unison_detune" => self.unison_detune = value.clamp(0.0, 100.0),
            "unison_spread" => self.unison_spread = value.clamp(0.0, 1.0),
            // Filter drive
            "filter_drive" => self.filter_drive = value.clamp(0.0, 10.0),
            // Delay
            "delay_time" => self.delay_time = value.clamp(10.0, 2000.0),
            "delay_feedback" => self.delay_feedback = value.clamp(0.0, 0.95),
            "delay_mix" => self.delay_mix = value.clamp(0.0, 1.0),
            // Chorus
            "chorus_rate" => self.chorus_rate = value.clamp(0.1, 5.0),
            "chorus_depth" => self.chorus_depth = value.clamp(0.0, 1.0),
            "chorus_mix" => self.chorus_mix = value.clamp(0.0, 1.0),
            // Portamento
            "portamento" => self.portamento_time = value.clamp(0.0, 5.0),
            // Engine
            "engine" => self.engine = (value as u8).min(1),
            // Pulse width
            "pulse_width" => self.pulse_width = value.clamp(0.05, 0.95),
            // Osc level, coarse, fine
            "osc_level" => self.osc_level = value.clamp(0.0, 1.0),
            "osc_coarse" => self.osc_coarse = value.clamp(-24.0, 24.0),
            "osc_fine" => self.osc_fine = value.clamp(-100.0, 100.0),
            // Filter keytrack
            "filter_keytrack" => self.filter_keytrack = value.clamp(0.0, 1.0),
            // LFO shape + filter amount
            "lfo_shape" => self.lfo_shape = (value as u8).min(3),
            "lfo_filter_amount" => self.lfo_filter_amount = value.clamp(-1.0, 1.0),
            // Portamento mode
            "portamento_mode" => self.portamento_mode = (value as u8).min(1),
            // Master gain
            "master_gain" => self.master_gain = value.clamp(0.0, 2.0),
            _ => {} // Unknown param — ignore silently
        }
    }

    /// Process a block of audio with MIDI events.
    /// `left` and `right` are output buffers (will be overwritten).
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], events: &[MidiEvent]) {
        let block_size = left.len().min(right.len());

        // Clear output
        left[..block_size].fill(0.0);
        right[..block_size].fill(0.0);

        // Process MIDI events (sorted by offset)
        for event in events {
            match event.kind {
                1 => self.note_on(event.note, event.velocity),
                0 => self.note_off(event.note),
                _ => {}
            }
        }

        // Update smoothed params
        let cutoff = self.cutoff.tick();
        let resonance = self.resonance.tick();
        let lfo_rate = self.lfo_rate.tick();
        let reverb_mix = self.reverb_mix.tick();
        let reverb_decay = self.reverb_decay.tick();

        let filter_mode = match self.filter_mode {
            0 => FilterMode::Lowpass,
            1 => FilterMode::Highpass,
            2 => FilterMode::Bandpass,
            _ => FilterMode::Notch,
        };

        // Set parameters on all voices
        for voice in &mut self.voices {
            voice.set_envelopes(
                self.amp_attack, self.amp_decay, self.amp_sustain, self.amp_release,
                self.filter_attack, self.filter_decay, self.filter_sustain, self.filter_release,
            );
            voice.set_noise(self.noise_level, self.noise_color);
            voice.set_unison(self.unison_voices, self.unison_detune, self.unison_spread);
            voice.set_engine(self.engine);
            voice.set_pulse_width(self.pulse_width);
            voice.set_portamento(self.portamento_time, self.sample_rate);
        }

        // Render active voices
        for voice in &mut self.voices {
            if voice.is_active() {
                voice.render(
                    &mut left[..block_size],
                    &mut right[..block_size],
                    &self.tables,
                    cutoff,
                    resonance,
                    filter_mode,
                    self.filter_drive,
                    lfo_rate,
                    &self.mod_matrix,
                    self.sample_rate,
                );
            }
        }

        // Apply reverb
        self.reverb.set_params(reverb_decay, reverb_mix, 0.5);
        for i in 0..block_size {
            let (rl, rr) = self.reverb.process(left[i], right[i]);
            left[i] = rl;
            right[i] = rr;
        }

        // Apply delay
        if self.delay_mix > 0.001 {
            self.delay.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.delay_time,
                self.delay_feedback,
                self.delay_mix,
            );
        }

        // Apply chorus
        if self.chorus_mix > 0.001 {
            self.chorus.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.chorus_rate,
                self.chorus_depth,
                self.chorus_mix,
            );
        }

        // Apply master gain
        if (self.master_gain - 1.0).abs() > 0.001 {
            for i in 0..block_size {
                left[i] *= self.master_gain;
                right[i] *= self.master_gain;
            }
        }
    }

    fn note_on(&mut self, note: u8, velocity: u8) {
        let vel = velocity as f32 / 127.0;

        // Find a free voice, or steal the oldest
        let mut target = None;

        // Priority 1: inactive voice
        for (i, v) in self.voices.iter().enumerate() {
            if !v.is_active() {
                target = Some(i);
                break;
            }
        }

        // Priority 2: steal oldest active voice
        if target.is_none() {
            // Find the voice that's been active longest (simple: first in array)
            target = Some(0);
            self.voices[0].start_steal();
        }

        if let Some(idx) = target {
            let voice = &mut self.voices[idx];
            voice.note_on(note, vel, self.sample_rate);
            voice.set_envelopes(
                self.amp_attack, self.amp_decay, self.amp_sustain, self.amp_release,
                self.filter_attack, self.filter_decay, self.filter_sustain, self.filter_release,
            );
        }
    }

    fn note_off(&mut self, note: u8) {
        for voice in &mut self.voices {
            if voice.active && voice.note == note {
                voice.note_off();
            }
        }
    }

    pub fn active_voice_count(&self) -> usize {
        self.voices.iter().filter(|v| v.is_active()).count()
    }
}
