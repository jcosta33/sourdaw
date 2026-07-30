/// MasterSynth — top-level Fermenter engine.
/// Manages layers (each with their own voice pool), processes MIDI, renders audio blocks.
use super::effects::{
    Compressor, Distortion, FdnReverb, ParametricEq, PlateReverb, StereoChorus, StereoDelay,
    StereoPhaser, StereoWidth,
};
use super::layer::Layer;
use super::oscillator::Wavetable;
use super::params::SmoothedParam;
use crate::primitives::{ProcessLifecycle, TailLength};

/// MIDI event passed from JS to WASM.
#[derive(Clone, Copy)]
pub struct MidiEvent {
    pub kind: u8, // 0=noteOff, 1=noteOn, 2=noteExpression
    pub note: u8,
    pub velocity: u8,
    pub channel: u8,
    pub offset: u32, // Sample offset within the block
    pub bend_semitones: f32,
    pub pressure: f32,
    pub slide: f32,
}

impl MidiEvent {
    pub const EMPTY: Self = Self {
        kind: u8::MAX,
        note: 0,
        velocity: 0,
        channel: 0,
        offset: 0,
        bend_semitones: 0.0,
        pressure: 0.0,
        slide: 0.0,
    };

    pub const fn note_on(note: u8, velocity: u8, channel: u8, offset: u32) -> Self {
        Self {
            kind: 1,
            note,
            velocity,
            channel,
            offset,
            ..Self::EMPTY
        }
    }

    pub const fn note_off(note: u8, channel: u8, offset: u32) -> Self {
        Self {
            kind: 0,
            note,
            channel,
            offset,
            ..Self::EMPTY
        }
    }

    pub const fn note_expression(
        note: u8,
        channel: u8,
        offset: u32,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) -> Self {
        Self {
            kind: 2,
            note,
            channel,
            offset,
            bend_semitones,
            pressure,
            slide,
            ..Self::EMPTY
        }
    }
}

const MAX_LAYERS: usize = 4;
const OUTPUT_QUIET_THRESHOLD: f32 = 3.162_277_6e-8;
const RENDER_QUANTUM_FRAMES: u64 = 128;

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
    last_output_quiet: bool,
    tail_samples_remaining: u64,
    wake_requested: bool,
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
            last_output_quiet: true,
            tail_samples_remaining: 0,
            wake_requested: false,
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

        if Self::parameter_can_reveal_dsp_state(name) {
            self.wake_requested = true;
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
        let had_active_voices = self.renderable_active_voice_count() > 0;

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
            self.render_layers(
                &mut left[cursor..block_size],
                &mut right[cursor..block_size],
            );
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

        let effect_output_quiet = Self::block_is_quiet(&left[..block_size], &right[..block_size]);

        // Apply parametric EQ (after reverb/delay/chorus/phaser, before stereo width)
        self.eq
            .process_block(&mut left[..block_size], &mut right[..block_size]);

        let eq_output_quiet = Self::block_is_quiet(&left[..block_size], &right[..block_size]);

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

        let audible_output_quiet = Self::block_is_quiet(&left[..block_size], &right[..block_size]);
        self.update_lifecycle_after_block(
            effect_output_quiet && eq_output_quiet && audible_output_quiet,
            block_size,
            had_active_voices,
        );
    }

    pub fn lifecycle(&self) -> ProcessLifecycle {
        if self.renderable_active_voice_count() > 0 {
            return ProcessLifecycle::Continue;
        }
        if self.wake_requested || !self.last_output_quiet {
            return ProcessLifecycle::ContinueIfNotQuiet;
        }
        if self.tail_samples_remaining > 0 {
            return ProcessLifecycle::Tail(TailLength::Finite(self.tail_samples_remaining));
        }
        ProcessLifecycle::Sleep
    }

    pub fn advance_silent_block(&mut self) {
        self.dist_drive.tick();
        self.dist_mix.tick();
        let comp_mix = self.comp_mix.tick();
        self.delay_feedback.tick();
        self.delay_mix.tick();
        let chorus_mix = self.chorus_mix.tick();
        let phaser_mix = self.phaser_mix.tick();
        self.master_gain.tick();
        self.stereo_width.tick();
        self.reverb_mix.tick();
        self.reverb_decay.tick();
        if comp_mix > 0.001 {
            self.compressor.advance_silence(
                RENDER_QUANTUM_FRAMES as usize,
                self.comp_release,
                self.sample_rate,
            );
        }
        if chorus_mix > 0.001 {
            self.chorus
                .advance_silence(RENDER_QUANTUM_FRAMES as usize, self.chorus_rate);
        }
        if phaser_mix > 0.001 {
            self.phaser.advance_silence(
                RENDER_QUANTUM_FRAMES as usize,
                self.phaser_rate,
                self.phaser_depth,
            );
        }
        let any_solo = self.layers[..self.num_active_layers]
            .iter()
            .any(|layer| layer.solo);
        for layer in &mut self.layers[..self.num_active_layers] {
            if layer.muted || (any_solo && !layer.solo) {
                continue;
            }
            layer.advance_silent_block();
        }
    }

    fn configured_tail_gap_samples(&self) -> u64 {
        let mut gap = RENDER_QUANTUM_FRAMES;
        if self.reverb_mix.value().max(self.reverb_mix.target()) > 0.001 {
            let reverb_gap = match self.reverb_type {
                1 => self.fdn_reverb.max_tail_gap_samples(),
                _ => self.reverb.max_tail_gap_samples(),
            };
            gap = gap.saturating_add(reverb_gap);
        }
        if self.delay_mix.value().max(self.delay_mix.target()) > 0.001 {
            gap = gap.saturating_add(self.delay.max_tail_gap_samples(self.delay_time));
        }
        if self.chorus_mix.value().max(self.chorus_mix.target()) > 0.001 {
            gap = gap.saturating_add(self.chorus.max_tail_gap_samples());
        }
        gap
    }

    fn block_is_quiet(left: &[f32], right: &[f32]) -> bool {
        left.iter()
            .chain(right)
            .all(|sample| sample.is_finite() && sample.abs() <= OUTPUT_QUIET_THRESHOLD)
    }

    fn update_lifecycle_after_block(
        &mut self,
        output_quiet: bool,
        frames: usize,
        had_active_voices: bool,
    ) {
        if had_active_voices
            || self.renderable_active_voice_count() > 0
            || self.wake_requested
            || !output_quiet
        {
            self.tail_samples_remaining = self.configured_tail_gap_samples();
        } else {
            self.tail_samples_remaining = self.tail_samples_remaining.saturating_sub(frames as u64);
        }
        self.last_output_quiet = output_quiet;
        self.wake_requested = false;
    }

    fn apply_midi_event(&mut self, event: &MidiEvent) {
        match event.kind {
            1 => self.note_on_with_channel(event.note, event.velocity, event.channel),
            0 => {
                let channel = (event.channel != u8::MAX).then_some(event.channel);
                self.note_off_matching(event.note, channel);
            }
            2 => self.note_expression(
                event.note,
                event.channel,
                event.bend_semitones,
                event.pressure,
                event.slide,
            ),
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
        self.note_on_with_channel(note, velocity, 0);
    }

    /// Note-on carrying the MPE member channel that owns the note. Channel 0 is
    /// the non-MPE default and what `note_on` uses.
    pub fn note_on_with_channel(&mut self, note: u8, velocity: u8, channel: u8) {
        let any_solo = self.layers[..self.num_active_layers].iter().any(|l| l.solo);
        for layer in &mut self.layers[..self.num_active_layers] {
            if layer.muted {
                continue;
            }
            if any_solo && !layer.solo {
                continue;
            }
            layer.note_on_with_channel(note, velocity, channel);
        }
    }

    pub fn note_off(&mut self, note: u8) {
        self.note_off_matching(note, None);
    }

    /// Note-off narrowed to one MPE member channel. `None` releases every voice
    /// at that pitch — see `Layer::note_off_matching`.
    pub fn note_off_matching(&mut self, note: u8, channel: Option<u8>) {
        for layer in &mut self.layers[..self.num_active_layers] {
            layer.note_off_matching(note, channel);
        }
    }

    /// Apply MPE per-note expression to every playable layer holding `note` on
    /// `channel` (audit MD-2). Mirrors `note_on`'s layer fan-out so a stacked
    /// patch bends as one instrument.
    pub fn note_expression(
        &mut self,
        note: u8,
        channel: u8,
        bend_semitones: f32,
        pressure: f32,
        slide: f32,
    ) {
        for layer in &mut self.layers[..self.num_active_layers] {
            layer.note_expression(note, channel, bend_semitones, pressure, slide);
        }
    }

    pub fn active_voice_count(&self) -> usize {
        self.layers[..self.num_active_layers]
            .iter()
            .map(|l| l.active_voice_count())
            .sum()
    }

    fn renderable_active_voice_count(&self) -> usize {
        let any_solo = self.layers[..self.num_active_layers]
            .iter()
            .any(|layer| layer.solo);
        self.layers[..self.num_active_layers]
            .iter()
            .filter(|layer| !layer.muted && (!any_solo || layer.solo))
            .map(|layer| layer.active_voice_count())
            .sum()
    }

    fn parameter_can_reveal_dsp_state(name: &str) -> bool {
        matches!(
            name,
            "reverb_type"
                | "reverb_mix"
                | "reverb_decay"
                | "eq_low_freq"
                | "eq_low_gain"
                | "eq_low_q"
                | "eq_mid_freq"
                | "eq_mid_gain"
                | "eq_mid_q"
                | "eq_high_freq"
                | "eq_high_gain"
                | "eq_high_q"
                | "delay_time"
                | "delay_feedback"
                | "delay_mix"
                | "chorus_rate"
                | "chorus_depth"
                | "chorus_mix"
                | "phaser_rate"
                | "phaser_depth"
                | "phaser_mix"
                | "dist_drive"
                | "dist_tone"
                | "dist_mix"
                | "comp_threshold"
                | "comp_ratio"
                | "comp_attack"
                | "comp_release"
                | "comp_mix"
                | "master_gain"
                | "stereo_width"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::{MasterSynth, MidiEvent, RENDER_QUANTUM_FRAMES};
    use crate::primitives::ProcessLifecycle;

    fn block_energy(left: &[f32], right: &[f32]) -> f32 {
        left.iter()
            .chain(right.iter())
            .map(|sample| sample.abs())
            .sum::<f32>()
    }

    fn sample_difference(left_a: &[f32], right_a: &[f32], left_b: &[f32], right_b: &[f32]) -> f32 {
        left_a
            .iter()
            .zip(left_b.iter())
            .chain(right_a.iter().zip(right_b.iter()))
            .map(|(a, b)| (a - b).abs())
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
        let events = [MidiEvent::note_on(60, 100, 0, 0)];

        synth.set_param("engine", engine as f32);
        synth.process_block(&mut left, &mut right, &events);

        (left, right)
    }

    fn render_note_for_engine_with_params(
        engine: u8,
        params: &[(&str, f32)],
    ) -> ([f32; 512], [f32; 512]) {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 512];
        let mut right = [0.0; 512];
        let events = [MidiEvent::note_on(60, 100, 0, 0)];

        synth.set_param("engine", engine as f32);
        for (name, value) in params {
            synth.set_param(name, *value);
        }
        synth.process_block(&mut left, &mut right, &events);

        (left, right)
    }

    #[test]
    fn note_event_renders_finite_non_silent_audio() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        let events = [MidiEvent::note_on(60, 100, 0, 0)];

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
        let events = [MidiEvent::note_on(60, 100, 0, 64)];

        synth.process_block(&mut left, &mut right, &events);

        assert_eq!(block_energy(&left[..64], &right[..64]), 0.0);
        assert!(block_energy(&left[64..], &right[64..]) > 0.001);
    }

    #[test]
    fn multiple_note_events_in_one_block_honor_their_offsets() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        let events = [
            MidiEvent::note_on(60, 100, 0, 32),
            MidiEvent::note_on(67, 100, 0, 96),
        ];

        synth.process_block(&mut left, &mut right, &events);

        assert_eq!(block_energy(&left[..32], &right[..32]), 0.0);
        assert!(block_energy(&left[32..96], &right[32..96]) > 0.001);
        assert!(block_energy(&left[96..], &right[96..]) > 0.001);
        assert_eq!(synth.active_voice_count(), 2);
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
        let events = [MidiEvent::note_on(60, 100, 0, 0)];

        synth.set_param("unison_voices", 4.0);
        synth.set_param("unison_detune", 12.0);
        synth.set_param("unison_spread", 1.0);
        synth.process_block(&mut left, &mut right, &events);

        assert!(block_energy(&left, &right) > 0.001);
        assert!(stereo_difference_energy(&left, &right) > 0.001);
    }

    #[test]
    fn additive_params_change_rendered_output() {
        let (simple_left, simple_right) = render_note_for_engine_with_params(
            5,
            &[("additive_partials", 1.0), ("additive_tilt", -6.0)],
        );
        let (rich_left, rich_right) = render_note_for_engine_with_params(
            5,
            &[
                ("additive_partials", 64.0),
                ("additive_tilt", 6.0),
                ("additive_odd", 0.75),
                ("additive_inharm", 0.04),
            ],
        );

        assert!(block_energy(&simple_left, &simple_right) > 0.001);
        assert!(block_energy(&rich_left, &rich_right) > 0.001);
        assert!(sample_difference(&simple_left, &simple_right, &rich_left, &rich_right) > 0.01);
    }

    #[test]
    fn granular_params_change_rendered_output() {
        let (sparse_left, sparse_right) = render_note_for_engine_with_params(
            4,
            &[
                ("grain_density", 1.0),
                ("grain_size", 20.0),
                ("grain_pan_spread", 0.0),
            ],
        );
        let (dense_left, dense_right) = render_note_for_engine_with_params(
            4,
            &[
                ("grain_density", 100.0),
                ("grain_size", 250.0),
                ("grain_pitch_var", 12.0),
                ("grain_pan_spread", 1.0),
            ],
        );

        assert!(block_energy(&sparse_left, &sparse_right) > 0.001);
        assert!(block_energy(&dense_left, &dense_right) > 0.001);
        assert!(sample_difference(&sparse_left, &sparse_right, &dense_left, &dense_right) > 0.01);
    }

    #[test]
    fn sampler_start_changes_rendered_output() {
        let (early_left, early_right) =
            render_note_for_engine_with_params(6, &[("sampler_start", 0.0), ("sampler_end", 1.0)]);
        let (late_left, late_right) =
            render_note_for_engine_with_params(6, &[("sampler_start", 0.25), ("sampler_end", 1.0)]);

        assert!(block_energy(&early_left, &early_right) > 0.001);
        assert!(block_energy(&late_left, &late_right) > 0.001);
        assert!(sample_difference(&early_left, &early_right, &late_left, &late_right) > 0.01);
    }

    #[test]
    fn global_effect_params_change_rendered_output() {
        let (dry_left, dry_right) = render_note_for_engine_with_params(0, &[("dist_mix", 0.0)]);
        let (driven_left, driven_right) =
            render_note_for_engine_with_params(0, &[("dist_drive", 10.0), ("dist_mix", 1.0)]);

        assert!(block_energy(&dry_left, &dry_right) > 0.001);
        assert!(block_energy(&driven_left, &driven_right) > 0.001);
        assert!(sample_difference(&dry_left, &dry_right, &driven_left, &driven_right) > 0.01);
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

    // ── MPE per-note expression (audit MD-2) ───────────────────────────────
    //
    // Every assertion below is a measurement of rendered samples, not a
    // presence check: zero-crossing rate for pitch, RMS for level, and
    // high-band energy for timbre. Removing the expression wiring in
    // `Voice::render` makes each of them fail.

    /// Render `blocks` × 128 frames of one sustained note, optionally applying
    /// per-note expression right after the note-on.
    fn render_expressive_note(
        cutoff_hz: f32,
        expression: Option<(f32, f32, f32)>,
        blocks: usize,
    ) -> Vec<f32> {
        let mut synth = MasterSynth::new(48_000.0, 8);
        synth.set_param("cutoff", cutoff_hz);
        synth.set_param("attack", 0.001);
        synth.set_param("decay", 0.001);
        synth.set_param("sustain", 1.0);
        synth.note_on(69, 100);
        if let Some((bend, pressure, slide)) = expression {
            synth.note_expression(69, 0, bend, pressure, slide);
        }

        let mut collected = Vec::with_capacity(blocks * 128);
        let mut left = [0.0f32; 128];
        let mut right = [0.0f32; 128];
        for _ in 0..blocks {
            left.fill(0.0);
            right.fill(0.0);
            synth.process_block(&mut left, &mut right, &[]);
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

    fn rms(samples: &[f32]) -> f32 {
        let sum: f32 = samples.iter().map(|value| value * value).sum();
        (sum / samples.len() as f32).sqrt()
    }

    /// Energy above roughly 4 kHz, measured as the RMS of the first difference
    /// (a one-zero high-pass). Rises when the voice is opened up, falls when
    /// it is darkened.
    fn high_band_rms(samples: &[f32]) -> f32 {
        let differences: Vec<f32> = samples.windows(2).map(|pair| pair[1] - pair[0]).collect();
        rms(&differences)
    }

    #[test]
    fn per_note_pitch_bend_raises_the_rendered_frequency() {
        let plain = render_expressive_note(20_000.0, None, 24);
        let bent = render_expressive_note(20_000.0, Some((12.0, 0.0, 0.0)), 24);

        let plain_crossings = zero_crossings(&plain[1024..]);
        let bent_crossings = zero_crossings(&bent[1024..]);

        // +12 semitones is exactly one octave, so the waveform must cross zero
        // about twice as often. Allow 10% for envelope/drift skew.
        let ratio = bent_crossings as f32 / plain_crossings as f32;
        assert!(
            (1.8..=2.2).contains(&ratio),
            "expected ~2x zero crossings for a +12 st bend, got {ratio} \
             ({plain_crossings} -> {bent_crossings})"
        );
    }

    #[test]
    fn per_note_pitch_bend_lowers_the_rendered_frequency_when_negative() {
        let plain = render_expressive_note(20_000.0, None, 24);
        let bent = render_expressive_note(20_000.0, Some((-12.0, 0.0, 0.0)), 24);

        let ratio = zero_crossings(&bent[1024..]) as f32 / zero_crossings(&plain[1024..]) as f32;
        assert!(
            (0.4..=0.6).contains(&ratio),
            "expected ~0.5x zero crossings for a -12 st bend, got {ratio}"
        );
    }

    #[test]
    fn per_note_pressure_raises_the_rendered_level() {
        let plain = render_expressive_note(20_000.0, None, 24);
        let pressed = render_expressive_note(20_000.0, Some((0.0, 1.0, 0.0)), 24);

        let ratio = rms(&pressed[1024..]) / rms(&plain[1024..]);
        assert!(
            (1.9..=2.1).contains(&ratio),
            "full pressure must double voice gain (+6 dB), got {ratio}x"
        );
    }

    #[test]
    fn per_note_slide_opens_and_closes_the_voice_filter() {
        // A 500 Hz cutoff sits just above the 440 Hz fundamental, so ±2
        // octaves of slide has head-room in both directions.
        let neutral = render_expressive_note(500.0, None, 24);
        let bright = render_expressive_note(500.0, Some((0.0, 0.0, 1.0)), 24);
        let dark = render_expressive_note(500.0, Some((0.0, 0.0, -1.0)), 24);

        let neutral_high = high_band_rms(&neutral[1024..]);
        let bright_high = high_band_rms(&bright[1024..]);
        let dark_high = high_band_rms(&dark[1024..]);

        assert!(
            bright_high > neutral_high * 1.2,
            "positive slide must open the filter: {neutral_high} -> {bright_high}"
        );
        assert!(
            dark_high < neutral_high * 0.8,
            "negative slide must close the filter: {neutral_high} -> {dark_high}"
        );
    }

    /// Hold A4 + C4 and render, applying `bends` as (note, semitones) pairs.
    fn render_dyad_crossings(bends: &[(u8, f32)]) -> usize {
        let mut synth = MasterSynth::new(48_000.0, 8);
        synth.set_param("cutoff", 20_000.0);
        synth.note_on(69, 100);
        synth.note_on(60, 100);
        for (note, semitones) in bends {
            synth.note_expression(*note, 0, *semitones, 0.0, 0.0);
        }

        let mut left = [0.0f32; 128];
        let mut right = [0.0f32; 128];
        let mut crossings = 0;
        for _ in 0..24 {
            left.fill(0.0);
            right.fill(0.0);
            synth.process_block(&mut left, &mut right, &[]);
            crossings += zero_crossings(&left);
        }
        crossings
    }

    #[test]
    fn per_note_expression_only_reaches_the_addressed_note() {
        let unbent = render_dyad_crossings(&[]);
        let one_bent = render_dyad_crossings(&[(69, 12.0)]);
        let both_bent = render_dyad_crossings(&[(69, 12.0), (60, 12.0)]);

        // Bending A4 alone must move the dyad — otherwise expression is inert.
        assert!(
            one_bent > unbent,
            "bending A4 must raise the dyad's crossing rate ({unbent} -> {one_bent})"
        );
        // …but strictly less than bending both notes, which is what a
        // channel-wide (non per-note) bend would have produced.
        assert!(
            one_bent < both_bent,
            "bending A4 must leave C4 at its own pitch \
             (one bent {one_bent} vs both bent {both_bent})"
        );
    }

    /// Two member channels holding the *same* pitch, rendered together.
    /// `bent_channels` lists the member channels that receive a +12 st bend.
    fn render_same_pitch_pair(bent_channels: &[u8]) -> Vec<f32> {
        let mut synth = MasterSynth::new(48_000.0, 8);
        synth.set_param("cutoff", 20_000.0);
        synth.set_param("attack", 0.001);
        synth.set_param("decay", 0.001);
        synth.set_param("sustain", 1.0);
        synth.note_on_with_channel(60, 100, 2);
        synth.note_on_with_channel(60, 100, 3);
        for channel in bent_channels {
            synth.note_expression(60, *channel, 12.0, 0.0, 0.0);
        }

        let mut collected = Vec::with_capacity(24 * 128);
        let mut left = [0.0f32; 128];
        let mut right = [0.0f32; 128];
        for _ in 0..24 {
            left.fill(0.0);
            right.fill(0.0);
            synth.process_block(&mut left, &mut right, &[]);
            collected.extend_from_slice(&left);
        }
        collected
    }

    fn difference_rms(left: &[f32], right: &[f32]) -> f32 {
        let differences: Vec<f32> = left.iter().zip(right.iter()).map(|(a, b)| a - b).collect();
        rms(&differences)
    }

    #[test]
    fn muted_release_can_sleep_and_unmute_wakes_the_frozen_voice() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        synth.note_on(60, 100);
        synth.process_block(&mut left, &mut right, &[]);
        synth.note_off(60);
        synth.set_param("layer_mute", 1.0);

        for _ in 0..4_000 {
            synth.process_block(&mut left, &mut right, &[]);
            if synth.lifecycle() == ProcessLifecycle::Sleep {
                break;
            }
        }

        assert!(synth.active_voice_count() > 0);
        assert_eq!(synth.lifecycle(), ProcessLifecycle::Sleep);
        synth.set_param("layer_mute", 0.0);
        assert_eq!(synth.lifecycle(), ProcessLifecycle::Continue);
    }

    #[test]
    fn solo_exclusion_can_sleep_and_unsolo_wakes_the_frozen_voice() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        synth.set_param("num_layers", 2.0);
        synth.note_on(60, 100);
        synth.process_block(&mut left, &mut right, &[]);
        synth.note_off(60);
        synth.set_param("active_layer", 1.0);
        synth.set_param("layer_solo", 1.0);

        for _ in 0..4_000 {
            synth.process_block(&mut left, &mut right, &[]);
            if synth.lifecycle() == ProcessLifecycle::Sleep {
                break;
            }
        }

        assert!(synth.active_voice_count() > 0);
        assert_eq!(synth.lifecycle(), ProcessLifecycle::Sleep);
        synth.set_param("layer_solo", 0.0);
        assert_eq!(synth.lifecycle(), ProcessLifecycle::Continue);
    }

    #[test]
    fn lifecycle_observes_internal_audio_before_zero_master_gain() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        synth.master_gain.set(0.0);
        synth.master_gain.snap();
        synth.note_on(60, 100);

        synth.process_block(&mut left, &mut right, &[]);

        assert!(left.iter().chain(&right).all(|sample| *sample == 0.0));
        assert!(!synth.last_output_quiet);
    }

    #[test]
    fn state_revealing_control_change_wakes_a_sleeping_processor() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        assert_eq!(synth.lifecycle(), ProcessLifecycle::Sleep);

        synth.set_param("master_gain", 0.0);

        assert_eq!(synth.lifecycle(), ProcessLifecycle::ContinueIfNotQuiet);
    }

    #[test]
    fn serial_wet_effects_compose_their_tail_gap() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        synth.reverb_mix.set(1.0);
        synth.reverb_mix.snap();
        synth.delay_mix.set(1.0);
        synth.delay_mix.snap();
        synth.delay_time = 2_000.0;
        synth.chorus_mix.set(1.0);
        synth.chorus_mix.snap();

        let expected = RENDER_QUANTUM_FRAMES
            + synth.reverb.max_tail_gap_samples()
            + synth.delay.max_tail_gap_samples(synth.delay_time)
            + synth.chorus.max_tail_gap_samples();

        assert_eq!(synth.configured_tail_gap_samples(), expected);
    }

    #[test]
    fn waking_a_frozen_delay_establishes_a_full_tail_horizon() {
        let mut synth = MasterSynth::new(48_000.0, 8);
        let mut left = [0.0; 128];
        let mut right = [0.0; 128];
        synth.reverb_mix.set(0.0);
        synth.reverb_mix.snap();
        synth.delay_time = 2_000.0;
        synth.delay_mix.set(1.0);
        synth.delay_mix.snap();
        synth.note_on(60, 100);
        synth.process_block(&mut left, &mut right, &[]);
        synth.note_off(60);
        synth.delay_mix.set(0.0);
        synth.delay_mix.snap();

        for _ in 0..4_000 {
            synth.process_block(&mut left, &mut right, &[]);
            if synth.lifecycle() == ProcessLifecycle::Sleep {
                break;
            }
        }
        assert_eq!(synth.lifecycle(), ProcessLifecycle::Sleep);

        synth.set_param("delay_mix", 1.0);
        synth.delay_mix.snap();
        synth.process_block(&mut left, &mut right, &[]);

        assert!(matches!(synth.lifecycle(), ProcessLifecycle::Tail(_)));
        assert!(synth.tail_samples_remaining > RENDER_QUANTUM_FRAMES);
    }

    /// audit MD-2 (review round 1) — the audible half of the targeting fix.
    /// Two voices sounding one pitch on two member channels is ordinary MPE;
    /// bending one must not drag the other with it.
    ///
    /// Compared sample-for-sample rather than by a spectral summary: when
    /// expression is addressed by MIDI note alone, bending one member channel
    /// and bending both produce *bit-identical* audio, so any non-zero
    /// difference between them is exactly the defect being absent.
    #[test]
    fn bending_one_member_channel_leaves_the_other_at_its_pitch() {
        let neither = render_same_pitch_pair(&[]);
        let one = render_same_pitch_pair(&[2]);
        let both = render_same_pitch_pair(&[2, 3]);

        let signal = rms(&both[1024..]);
        let moved = difference_rms(&one[1024..], &neither[1024..]);
        let partial = difference_rms(&one[1024..], &both[1024..]);

        assert!(
            moved > signal * 0.05,
            "bending one member channel must change the rendered pair \
             (difference {moved} vs signal {signal})"
        );
        assert!(
            partial > signal * 0.05,
            "bending one member channel must not equal bending both — \
             note-only addressing makes these identical \
             (difference {partial} vs signal {signal})"
        );
    }

    #[test]
    fn expression_for_a_silent_note_is_ignored() {
        let sounding = render_dyad_crossings(&[]);
        let addressed_elsewhere = render_dyad_crossings(&[(72, 12.0)]);

        assert_eq!(
            sounding, addressed_elsewhere,
            "expression addressed to a note nobody is holding must change nothing"
        );
    }
}
