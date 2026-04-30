/// MasterSynth — top-level Fermenter engine.
/// Manages layers (each with their own voice pool), processes MIDI, renders audio blocks.
use super::effects::{
    Compressor, Distortion, FdnReverb, ParametricEq, PlateReverb, StereoChorus, StereoDelay,
    StereoPhaser, StereoWidth,
};
use super::layer::Layer;
use super::oscillator::Wavetable;
use super::params::SmoothedParam;

/// MIDI event passed from JS to WASM.
#[derive(Clone, Copy)]
pub struct MidiEvent {
    pub kind: u8, // 0=noteOff, 1=noteOn
    pub note: u8,
    pub velocity: u8,
    pub offset: u32, // Sample offset within the block
}

const MAX_LAYERS: usize = 4;

pub struct MasterSynth {
    layers: [Layer; MAX_LAYERS],
    num_active_layers: usize, // 1-4
    active_layer: usize,      // which layer receives MIDI and param changes (0-3)

    tables: Vec<Wavetable>,

    // Global effects (shared across all layers)
    reverb: PlateReverb,
    fdn_reverb: FdnReverb,
    eq: ParametricEq,
    delay: StereoDelay,
    chorus: StereoChorus,
    phaser: StereoPhaser,
    distortion: Distortion,
    compressor: Compressor,

    // Reverb type: 0 = plate, 1 = FDN
    pub reverb_type: u8,

    // Global effect params
    pub reverb_mix: SmoothedParam,
    pub reverb_decay: SmoothedParam,

    // EQ parameters (low / mid / high)
    pub eq_low_freq: f32,
    pub eq_low_gain: f32,
    pub eq_low_q: f32,
    pub eq_mid_freq: f32,
    pub eq_mid_gain: f32,
    pub eq_mid_q: f32,
    pub eq_high_freq: f32,
    pub eq_high_gain: f32,
    pub eq_high_q: f32,

    // Delay parameters
    pub delay_time: f32,
    pub delay_feedback: SmoothedParam,
    pub delay_mix: SmoothedParam,

    // Chorus parameters
    pub chorus_rate: f32,
    pub chorus_depth: f32,
    pub chorus_mix: SmoothedParam,

    // Phaser parameters
    pub phaser_rate: f32,
    pub phaser_depth: f32,
    pub phaser_mix: SmoothedParam,

    // Distortion parameters
    pub dist_drive: SmoothedParam,
    pub dist_tone: f32,
    pub dist_mix: SmoothedParam,

    // Compressor parameters
    pub comp_threshold: f32,
    pub comp_ratio: f32,
    pub comp_attack: f32,
    pub comp_release: f32,
    pub comp_mix: SmoothedParam,

    // Master
    pub master_gain: SmoothedParam,
    pub stereo_width: SmoothedParam,

    sample_rate: f32,
}

impl MasterSynth {
    pub fn new(sample_rate: f32, _max_voices: usize) -> Self {
        // Pre-compute band-limited wavetables
        let tables = vec![
            Wavetable::sine(),
            Wavetable::saw(),
            Wavetable::square(),
            Wavetable::triangle(),
        ];

        let layers = [
            Layer::new(sample_rate),
            Layer::new(sample_rate),
            Layer::new(sample_rate),
            Layer::new(sample_rate),
        ];

        Self {
            layers,
            num_active_layers: 1,
            active_layer: 0,
            tables,
            reverb: PlateReverb::new(sample_rate),
            fdn_reverb: FdnReverb::new(sample_rate),
            eq: ParametricEq::new(),
            delay: StereoDelay::new(sample_rate),
            chorus: StereoChorus::new(sample_rate),
            phaser: StereoPhaser::new(sample_rate),
            distortion: Distortion::new(),
            compressor: Compressor::new(),
            reverb_type: 0,
            reverb_mix: SmoothedParam::new(0.2, 10.0, sample_rate),
            reverb_decay: SmoothedParam::new(0.5, 10.0, sample_rate),
            eq_low_freq: 200.0,
            eq_low_gain: 0.0,
            eq_low_q: 1.0,
            eq_mid_freq: 1000.0,
            eq_mid_gain: 0.0,
            eq_mid_q: 1.0,
            eq_high_freq: 5000.0,
            eq_high_gain: 0.0,
            eq_high_q: 1.0,
            delay_time: 300.0,
            delay_feedback: SmoothedParam::new(0.3, 5.0, sample_rate),
            delay_mix: SmoothedParam::new(0.0, 5.0, sample_rate),
            chorus_rate: 1.0,
            chorus_depth: 0.5,
            chorus_mix: SmoothedParam::new(0.0, 5.0, sample_rate),
            phaser_rate: 1.0,
            phaser_depth: 0.5,
            phaser_mix: SmoothedParam::new(0.0, 5.0, sample_rate),
            dist_drive: SmoothedParam::new(0.0, 5.0, sample_rate),
            dist_tone: 0.5,
            dist_mix: SmoothedParam::new(0.0, 5.0, sample_rate),
            comp_threshold: -10.0,
            comp_ratio: 4.0,
            comp_attack: 10.0,
            comp_release: 100.0,
            comp_mix: SmoothedParam::new(0.0, 5.0, sample_rate),
            master_gain: SmoothedParam::new(1.0, 5.0, sample_rate),
            stereo_width: SmoothedParam::new(1.0, 5.0, sample_rate),
            sample_rate,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        // Layer management params
        match name {
            "active_layer" => {
                self.active_layer = (value as usize).min(MAX_LAYERS - 1);
                return;
            }
            "num_layers" => {
                self.num_active_layers = (value as usize).clamp(1, MAX_LAYERS);
                return;
            }
            _ => {}
        }

        // Global effect params — handled at MasterSynth level
        match name {
            "reverb_type" => {
                self.reverb_type = (value as u8).min(1);
                return;
            }
            "reverb_mix" => {
                self.reverb_mix.set(value.clamp(0.0, 1.0));
                return;
            }
            "reverb_decay" => {
                self.reverb_decay.set(value.clamp(0.0, 0.99));
                return;
            }
            "eq_low_freq" => {
                self.eq_low_freq = value.clamp(20.0, 20000.0);
                self.eq.set_band(
                    0,
                    self.eq_low_freq,
                    self.eq_low_gain,
                    self.eq_low_q,
                    self.sample_rate,
                );
                return;
            }
            "eq_low_gain" => {
                self.eq_low_gain = value.clamp(-24.0, 24.0);
                self.eq.set_band(
                    0,
                    self.eq_low_freq,
                    self.eq_low_gain,
                    self.eq_low_q,
                    self.sample_rate,
                );
                return;
            }
            "eq_low_q" => {
                self.eq_low_q = value.clamp(0.1, 20.0);
                self.eq.set_band(
                    0,
                    self.eq_low_freq,
                    self.eq_low_gain,
                    self.eq_low_q,
                    self.sample_rate,
                );
                return;
            }
            "eq_mid_freq" => {
                self.eq_mid_freq = value.clamp(20.0, 20000.0);
                self.eq.set_band(
                    1,
                    self.eq_mid_freq,
                    self.eq_mid_gain,
                    self.eq_mid_q,
                    self.sample_rate,
                );
                return;
            }
            "eq_mid_gain" => {
                self.eq_mid_gain = value.clamp(-24.0, 24.0);
                self.eq.set_band(
                    1,
                    self.eq_mid_freq,
                    self.eq_mid_gain,
                    self.eq_mid_q,
                    self.sample_rate,
                );
                return;
            }
            "eq_mid_q" => {
                self.eq_mid_q = value.clamp(0.1, 20.0);
                self.eq.set_band(
                    1,
                    self.eq_mid_freq,
                    self.eq_mid_gain,
                    self.eq_mid_q,
                    self.sample_rate,
                );
                return;
            }
            "eq_high_freq" => {
                self.eq_high_freq = value.clamp(20.0, 20000.0);
                self.eq.set_band(
                    2,
                    self.eq_high_freq,
                    self.eq_high_gain,
                    self.eq_high_q,
                    self.sample_rate,
                );
                return;
            }
            "eq_high_gain" => {
                self.eq_high_gain = value.clamp(-24.0, 24.0);
                self.eq.set_band(
                    2,
                    self.eq_high_freq,
                    self.eq_high_gain,
                    self.eq_high_q,
                    self.sample_rate,
                );
                return;
            }
            "eq_high_q" => {
                self.eq_high_q = value.clamp(0.1, 20.0);
                self.eq.set_band(
                    2,
                    self.eq_high_freq,
                    self.eq_high_gain,
                    self.eq_high_q,
                    self.sample_rate,
                );
                return;
            }
            "delay_time" => {
                self.delay_time = value.clamp(10.0, 2000.0);
                return;
            }
            "delay_feedback" => {
                self.delay_feedback.set(value.clamp(0.0, 0.95));
                return;
            }
            "delay_mix" => {
                self.delay_mix.set(value.clamp(0.0, 1.0));
                return;
            }
            "chorus_rate" => {
                self.chorus_rate = value.clamp(0.1, 5.0);
                return;
            }
            "chorus_depth" => {
                self.chorus_depth = value.clamp(0.0, 1.0);
                return;
            }
            "chorus_mix" => {
                self.chorus_mix.set(value.clamp(0.0, 1.0));
                return;
            }
            "phaser_rate" => {
                self.phaser_rate = value.clamp(0.1, 5.0);
                return;
            }
            "phaser_depth" => {
                self.phaser_depth = value.clamp(0.0, 1.0);
                return;
            }
            "phaser_mix" => {
                self.phaser_mix.set(value.clamp(0.0, 1.0));
                return;
            }
            "dist_drive" => {
                self.dist_drive.set(value.clamp(0.0, 10.0));
                return;
            }
            "dist_tone" => {
                self.dist_tone = value.clamp(0.0, 1.0);
                return;
            }
            "dist_mix" => {
                self.dist_mix.set(value.clamp(0.0, 1.0));
                return;
            }
            "comp_threshold" => {
                self.comp_threshold = value.clamp(-60.0, 0.0);
                return;
            }
            "comp_ratio" => {
                self.comp_ratio = value.clamp(1.0, 20.0);
                return;
            }
            "comp_attack" => {
                self.comp_attack = value.clamp(0.1, 100.0);
                return;
            }
            "comp_release" => {
                self.comp_release = value.clamp(10.0, 1000.0);
                return;
            }
            "comp_mix" => {
                self.comp_mix.set(value.clamp(0.0, 1.0));
                return;
            }
            "master_gain" => {
                self.master_gain.set(value.clamp(0.0, 2.0));
                return;
            }
            "stereo_width" => {
                self.stereo_width.set(value.clamp(0.0, 2.0));
                return;
            }
            _ => {}
        }

        // Everything else routes to the active layer
        self.layers[self.active_layer].set_param(name, value);
    }

    /// Process a block of audio with MIDI events.
    /// `left` and `right` are output buffers (will be overwritten).
    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32], events: &[MidiEvent]) {
        let block_size = left.len().min(right.len());

        // Clear output
        left[..block_size].fill(0.0);
        right[..block_size].fill(0.0);

        let mut cursor = 0;
        for event in events {
            let event_offset = (event.offset as usize).min(block_size);
            if event_offset > cursor {
                self.render_layers(
                    &mut left[cursor..event_offset],
                    &mut right[cursor..event_offset],
                );
                cursor = event_offset;
            }
            self.apply_midi_event(event);
        }

        if cursor < block_size {
            self.render_layers(&mut left[cursor..block_size], &mut right[cursor..block_size]);
        }

        // ── Global effects ──────────────────────────────────────────

        // Tick smoothed params once per block
        let dist_drive = self.dist_drive.tick();
        let dist_mix = self.dist_mix.tick();
        let comp_mix = self.comp_mix.tick();
        let delay_feedback = self.delay_feedback.tick();
        let delay_mix = self.delay_mix.tick();
        let chorus_mix = self.chorus_mix.tick();
        let phaser_mix = self.phaser_mix.tick();
        let master_gain = self.master_gain.tick();
        let stereo_width = self.stereo_width.tick();

        // Apply distortion (pre-FX)
        if dist_mix > 0.001 {
            self.distortion.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                dist_drive,
                self.dist_tone,
                dist_mix,
            );
        }

        // Apply compressor (after distortion, before reverb)
        if comp_mix > 0.001 {
            self.compressor.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.comp_threshold,
                self.comp_ratio,
                self.comp_attack,
                self.comp_release,
                comp_mix,
                self.sample_rate,
            );
        }

        // Apply reverb (skip when mix is zero) — branch on reverb_type
        let reverb_mix = self.reverb_mix.tick();
        let reverb_decay = self.reverb_decay.tick();
        if reverb_mix > 0.001 {
            match self.reverb_type {
                1 => {
                    // FDN reverb
                    self.fdn_reverb.set_params(reverb_decay, reverb_mix, 0.5);
                    for i in 0..block_size {
                        let (rl, rr) = self.fdn_reverb.process(left[i], right[i]);
                        left[i] = rl;
                        right[i] = rr;
                    }
                }
                _ => {
                    // Plate reverb (default)
                    self.reverb.set_params(reverb_decay, reverb_mix, 0.5);
                    for i in 0..block_size {
                        let (rl, rr) = self.reverb.process(left[i], right[i]);
                        left[i] = rl;
                        right[i] = rr;
                    }
                }
            }
        }

        // Apply delay
        if delay_mix > 0.001 {
            self.delay.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.delay_time,
                delay_feedback,
                delay_mix,
            );
        }

        // Apply chorus
        if chorus_mix > 0.001 {
            self.chorus.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.chorus_rate,
                self.chorus_depth,
                chorus_mix,
            );
        }

        // Apply phaser (after chorus)
        if phaser_mix > 0.001 {
            self.phaser.process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                self.phaser_rate,
                self.phaser_depth,
                phaser_mix,
            );
        }

        // Apply parametric EQ (after reverb/delay/chorus/phaser, before stereo width)
        self.eq
            .process_block(&mut left[..block_size], &mut right[..block_size]);

        // Apply stereo width (last effect before master gain)
        if (stereo_width - 1.0).abs() > 0.001 {
            StereoWidth::process_block(
                &mut left[..block_size],
                &mut right[..block_size],
                stereo_width,
            );
        }

        // Apply master gain
        if (master_gain - 1.0).abs() > 0.001 {
            for i in 0..block_size {
                left[i] *= master_gain;
                right[i] *= master_gain;
            }
        }
    }

    fn apply_midi_event(&mut self, event: &MidiEvent) {
        match event.kind {
            1 => self.note_on(event.note, event.velocity),
            0 => self.note_off(event.note),
            _ => {}
        }
    }

    fn render_layers(&mut self, left: &mut [f32], right: &mut [f32]) {
        let block_size = left.len().min(right.len());
        if block_size == 0 {
            return;
        }

        let any_solo = self.layers[..self.num_active_layers].iter().any(|l| l.solo);

        for i in 0..self.num_active_layers {
            let layer = &mut self.layers[i];

            if layer.muted {
                continue;
            }
            if any_solo && !layer.solo {
                continue;
            }

            layer.render(
                &mut left[..block_size],
                &mut right[..block_size],
                &self.tables,
                self.sample_rate,
            );
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: u8) {
        let any_solo = self.layers[..self.num_active_layers].iter().any(|l| l.solo);
        for layer in &mut self.layers[..self.num_active_layers] {
            if layer.muted {
                continue;
            }
            if any_solo && !layer.solo {
                continue;
            }
            layer.note_on(note, velocity);
        }
    }

    pub fn note_off(&mut self, note: u8) {
        for layer in &mut self.layers[..self.num_active_layers] {
            layer.note_off(note);
        }
    }

    pub fn active_voice_count(&self) -> usize {
        self.layers[..self.num_active_layers]
            .iter()
            .map(|l| l.active_voice_count())
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::{MasterSynth, MidiEvent};

    fn block_energy(left: &[f32], right: &[f32]) -> f32 {
        left.iter()
            .chain(right.iter())
            .map(|sample| sample.abs())
            .sum::<f32>()
    }

    fn stereo_difference_energy(left: &[f32], right: &[f32]) -> f32 {
        left.iter()
            .zip(right.iter())
            .map(|(left_sample, right_sample)| (left_sample - right_sample).abs())
            .sum::<f32>()
    }

    fn render_note_for_engine(engine: u8) -> ([f32; 256], [f32; 256]) {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 256];
        let mut right = [0.0; 256];
        let events = [MidiEvent {
            kind: 1,
            note: 60,
            velocity: 100,
            offset: 0,
        }];

        synth.set_param("engine", engine as f32);
        synth.process_block(&mut left, &mut right, &events);

        (left, right)
    }

    #[test]
    fn note_event_renders_finite_non_silent_audio() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        let events = [MidiEvent {
            kind: 1,
            note: 60,
            velocity: 100,
            offset: 0,
        }];

        synth.process_block(&mut left, &mut right, &events);

        assert!(left
            .iter()
            .chain(right.iter())
            .all(|sample| sample.is_finite()));
        assert!(block_energy(&left, &right) > 0.001);
    }

    #[test]
    fn note_event_offset_delays_render_until_event_sample() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        let events = [MidiEvent {
            kind: 1,
            note: 60,
            velocity: 100,
            offset: 64,
        }];

        synth.process_block(&mut left, &mut right, &events);

        assert_eq!(block_energy(&left[..64], &right[..64]), 0.0);
        assert!(block_energy(&left[64..], &right[64..]) > 0.001);
    }

    #[test]
    fn every_advertised_engine_renders_finite_non_silent_audio() {
        for engine in 0..=6 {
            let (left, right) = render_note_for_engine(engine);

            assert!(
                left.iter()
                    .chain(right.iter())
                    .all(|sample| sample.is_finite()),
                "engine {engine} rendered a non-finite sample"
            );
            assert!(
                block_energy(&left, &right) > 0.001,
                "engine {engine} rendered silence"
            );
        }
    }

    #[test]
    fn unison_spread_renders_stereo_difference() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 256];
        let mut right = [0.0; 256];
        let events = [MidiEvent {
            kind: 1,
            note: 60,
            velocity: 100,
            offset: 0,
        }];

        synth.set_param("unison_voices", 4.0);
        synth.set_param("unison_detune", 12.0);
        synth.set_param("unison_spread", 1.0);
        synth.process_block(&mut left, &mut right, &events);

        assert!(block_energy(&left, &right) > 0.001);
        assert!(stereo_difference_energy(&left, &right) > 0.001);
    }

    #[test]
    fn note_on_triggers_all_playable_active_layers() {
        let mut synth = MasterSynth::new(48_000.0, 8);

        synth.set_param("num_layers", 2.0);
        synth.set_param("active_layer", 0.0);
        synth.note_on(60, 100);

        assert_eq!(synth.active_voice_count(), 2);
    }

    #[test]
    fn note_on_skips_muted_layers_and_honors_solo() {
        let mut synth = MasterSynth::new(48_000.0, 8);

        synth.set_param("num_layers", 3.0);
        synth.set_param("active_layer", 1.0);
        synth.set_param("layer_mute", 1.0);
        synth.set_param("active_layer", 2.0);
        synth.set_param("layer_solo", 1.0);
        synth.set_param("active_layer", 0.0);
        synth.note_on(60, 100);

        assert_eq!(synth.active_voice_count(), 1);
    }

    #[test]
    fn note_off_releases_all_playable_layers_for_note() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];

        synth.set_param("num_layers", 2.0);
        synth.set_param("amp_release", 0.001);
        synth.note_on(60, 100);
        assert_eq!(synth.active_voice_count(), 2);

        synth.note_off(60);
        for _ in 0..4 {
            synth.process_block(&mut left, &mut right, &[]);
        }

        assert_eq!(synth.active_voice_count(), 0);
    }

    #[test]
    fn mapped_global_params_update_master_state() {
        let mut synth = MasterSynth::new(48_000.0, 8);

        synth.set_param("active_layer", 2.0);
        synth.set_param("num_layers", 4.0);
        synth.set_param("reverb_type", 1.0);
        synth.set_param("reverb_mix", 0.35);
        synth.set_param("delay_feedback", 0.45);
        synth.set_param("chorus_rate", 2.5);
        synth.set_param("phaser_depth", 0.75);
        synth.set_param("dist_tone", 0.2);
        synth.set_param("comp_ratio", 8.0);
        synth.set_param("master_gain", 1.5);
        synth.set_param("stereo_width", 1.7);

        assert_eq!(synth.active_layer, 2);
        assert_eq!(synth.num_active_layers, 4);
        assert_eq!(synth.reverb_type, 1);
        assert_eq!(synth.reverb_mix.target(), 0.35);
        assert_eq!(synth.delay_feedback.target(), 0.45);
        assert_eq!(synth.chorus_rate, 2.5);
        assert_eq!(synth.phaser_depth, 0.75);
        assert_eq!(synth.dist_tone, 0.2);
        assert_eq!(synth.comp_ratio, 8.0);
        assert_eq!(synth.master_gain.target(), 1.5);
        assert_eq!(synth.stereo_width.target(), 1.7);
    }
}
