//! Top-level Toaster drum machine engine.
//!
//! Manages pads, polyphonic voice pool, global effects (reverb + delay),
//! and the per-block processing pipeline.

use super::engines::DrumEngineType;
use super::lofi::LofiProcessor;
use super::pad::Pad;
use super::transient::TransientShaper;
use super::voice::DrumVoice;
use crate::primitives::{flush_denormal, ProcessLifecycle};

const EFFECT_STATE_QUIET_THRESHOLD: f32 = 3.162_277_6e-8;

#[inline]
fn settle_effect_state(value: f32) -> f32 {
    if value.is_finite() && value.abs() <= EFFECT_STATE_QUIET_THRESHOLD {
        0.0
    } else {
        value
    }
}

#[inline]
fn replace_active_sample(active_samples: &mut usize, previous: f32, next: f32) {
    let was_active = previous != 0.0;
    let is_active = next != 0.0;
    if was_active == is_active {
        return;
    }
    if is_active {
        *active_samples += 1;
    } else {
        *active_samples = active_samples.saturating_sub(1);
    }
}

// ---------------------------------------------------------------------------
// Global effects (simple implementations to keep toaster self-contained)
// ---------------------------------------------------------------------------

/// Send reverb — 8-tap feedback delay network, 100% wet (send effect).
/// Input comes pre-scaled by pad send levels. Output is pure wet signal.
pub struct PlateReverb {
    buffers: [Vec<f32>; 4],
    write_pos: [usize; 4],
    feedback: [f32; 4], // per-line damping state
    decay: f32,
    damping: f32,
    mix: f32,
    active_samples: usize,
}

// Prime delay lengths for dense, non-metallic reverb (at 44100Hz)
const REV_DELAYS: [usize; 4] = [1087, 1283, 1531, 1811];

impl PlateReverb {
    pub fn new(sample_rate: f32) -> Self {
        let ratio = sample_rate / 44100.0;
        let make_buf = |base: usize| vec![0.0f32; (base as f32 * ratio) as usize + 1];
        Self {
            buffers: [
                make_buf(REV_DELAYS[0]),
                make_buf(REV_DELAYS[1]),
                make_buf(REV_DELAYS[2]),
                make_buf(REV_DELAYS[3]),
            ],
            write_pos: [0; 4],
            feedback: [0.0; 4],
            decay: 0.75,
            damping: 0.4,
            mix: 0.15,
            active_samples: 0,
        }
    }

    /// Process mono send input, returns stereo wet output.
    pub fn process(&mut self, input: f32) -> (f32, f32) {
        // Read taps
        let mut taps = [0.0f32; 4];
        for i in 0..4 {
            let _len = self.buffers[i].len();
            taps[i] = self.buffers[i][self.write_pos[i]];
        }

        // Hadamard-like mixing
        let mixed = [
            0.5 * (taps[0] + taps[1] + taps[2] + taps[3]),
            0.5 * (taps[0] - taps[1] + taps[2] - taps[3]),
            0.5 * (taps[0] + taps[1] - taps[2] - taps[3]),
            0.5 * (taps[0] - taps[1] - taps[2] + taps[3]),
        ];

        // Damping + feedback + write
        let input_per_line = input * 0.25;
        for i in 0..4 {
            // DSP-2: the tank feedback state decays toward zero once input stops.
            let damped = settle_effect_state(flush_denormal(
                self.feedback[i] + (1.0 - self.damping) * (mixed[i] - self.feedback[i]),
            ));
            self.feedback[i] = damped;
            let len = self.buffers[i].len();
            let previous = self.buffers[i][self.write_pos[i]];
            let next = settle_effect_state(input_per_line + damped * self.decay);
            replace_active_sample(&mut self.active_samples, previous, next);
            self.buffers[i][self.write_pos[i]] = next;
            self.write_pos[i] = (self.write_pos[i] + 1) % len;
        }

        // Stereo output (100% wet — this is a send effect)
        let wet_l = (taps[0] + taps[2]) * 0.5 * self.mix;
        let wet_r = (taps[1] + taps[3]) * 0.5 * self.mix;
        (wet_l, wet_r)
    }

    pub fn is_active(&self) -> bool {
        self.active_samples > 0 || self.feedback.iter().any(|value| *value != 0.0)
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "reverb_decay" => self.decay = value.clamp(0.1, 0.99),
            "reverb_damping" => self.damping = value.clamp(0.0, 1.0),
            "reverb_mix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}

/// Simple stereo ping-pong delay.
pub struct StereoDelay {
    buf_l: Vec<f32>,
    buf_r: Vec<f32>,
    write_pos: usize,
    size: usize,
    delay_samples: usize,
    feedback: f32,
    mix: f32,
    active_samples: usize,
}

impl StereoDelay {
    pub fn new(sample_rate: f32) -> Self {
        // Max 2 seconds
        let size = (sample_rate * 2.0) as usize;
        let delay_samples = (sample_rate * 0.375) as usize; // 3/8 beat at 120bpm
        Self {
            buf_l: vec![0.0; size],
            buf_r: vec![0.0; size],
            write_pos: 0,
            size,
            delay_samples: delay_samples.min(size.saturating_sub(1)),
            feedback: 0.4,
            mix: 0.0,
            active_samples: 0,
        }
    }

    /// Process mono input, returns stereo (left, right).
    pub fn process(&mut self, input: f32) -> (f32, f32) {
        if self.size == 0 {
            return (input, input);
        }

        let read_pos = (self.write_pos + self.size - self.delay_samples) % self.size;

        let tap_l = self.buf_l[read_pos];
        let tap_r = self.buf_r[read_pos];

        // Ping-pong: left feedback from right, right from left
        let next_l = settle_effect_state(input + tap_r * self.feedback);
        let next_r = settle_effect_state(input + tap_l * self.feedback);
        replace_active_sample(
            &mut self.active_samples,
            self.buf_l[self.write_pos],
            next_l,
        );
        replace_active_sample(
            &mut self.active_samples,
            self.buf_r[self.write_pos],
            next_r,
        );
        self.buf_l[self.write_pos] = next_l;
        self.buf_r[self.write_pos] = next_r;

        self.write_pos = (self.write_pos + 1) % self.size;

        (tap_l * self.mix, tap_r * self.mix)
    }

    pub fn is_active(&self) -> bool {
        self.active_samples > 0
    }

    pub fn set_param(&mut self, name: &str, value: f32, sample_rate: f32) {
        match name {
            "delay_time" => {
                let samples = (value * sample_rate) as usize;
                self.delay_samples = samples.clamp(1, self.size.saturating_sub(1));
            }
            "delay_feedback" => self.feedback = value.clamp(0.0, 0.95),
            "delay_mix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}

// ---------------------------------------------------------------------------
// Bus effects (simple compressor via envelope follower + gain reduction)
// ---------------------------------------------------------------------------

/// Number of internal mix buses.
const NUM_BUSES: usize = 4;

/// Simple compressor-like effect: one-pole envelope follower with gain
/// reduction.  Intentionally minimal — just enough for group bus processing.
struct BusEffects {
    comp_threshold: f32, // 0-1 (linear)
    comp_ratio: f32,     // >= 1.0
    comp_env: f32,       // envelope follower state
    attack_coeff: f32,
    release_coeff: f32,
}

impl BusEffects {
    fn new(sample_rate: f32) -> Self {
        Self {
            comp_threshold: 0.8,
            comp_ratio: 4.0,
            comp_env: 0.0,
            attack_coeff: 1.0 - (-1.0 / (0.002 * sample_rate)).exp(), // ~2ms attack
            release_coeff: 1.0 - (-1.0 / (0.050 * sample_rate)).exp(), // ~50ms release
        }
    }

    /// Process a single sample in-place (mono).  Returns the gain-reduced
    /// sample.
    #[inline]
    fn process(&mut self, sample: f32) -> f32 {
        // One-pole envelope follower
        let abs = sample.abs();
        let coeff = if abs > self.comp_env {
            self.attack_coeff
        } else {
            self.release_coeff
        };
        self.comp_env = flush_denormal(self.comp_env + coeff * (abs - self.comp_env));

        let gain = if self.comp_env > self.comp_threshold && self.comp_threshold > 0.0 {
            let over = self.comp_env / self.comp_threshold;
            (1.0 / over).powf(1.0 - 1.0 / self.comp_ratio)
        } else {
            1.0
        };
        sample * gain
    }

    fn is_active(&self) -> bool {
        self.comp_env != 0.0
    }
}

// ---------------------------------------------------------------------------
// ToasterEngine
// ---------------------------------------------------------------------------

/// Maximum polyphony (simultaneous drum hits).
const MAX_VOICES: usize = 32;

/// The top-level Toaster drum machine engine.
pub struct ToasterEngine {
    pads: Vec<Pad>,
    voices: Vec<DrumVoice>,
    transient_shapers: Vec<TransientShaper>,
    // Internal mix buses (4 stereo buses)
    bus_buffers_l: [Vec<f32>; NUM_BUSES],
    bus_buffers_r: [Vec<f32>; NUM_BUSES],
    bus_effects: [BusEffects; NUM_BUSES],
    global_reverb: PlateReverb,
    global_delay: StereoDelay,
    global_lofi: LofiProcessor,
    pad_l_gains: Vec<f32>,
    pad_r_gains: Vec<f32>,
    pad_dry_routed_mask: u16,
    sample_rate: f32,
    master_gain: f32,
}

impl ToasterEngine {
    pub fn new(sample_rate: f32, num_pads: usize) -> Self {
        // Create default pad layout (typical drum machine mapping)
        let default_types = [
            DrumEngineType::Kick,    // kick-808
            DrumEngineType::Snare,   // snare-808
            DrumEngineType::HiHat,   // hihat-closed
            DrumEngineType::HiHat,   // hihat-open
            DrumEngineType::Clap,    // clap
            DrumEngineType::Rim,     // rimshot
            DrumEngineType::Tom,     // tom (Low)
            DrumEngineType::Tom,     // tom (Mid)
            DrumEngineType::Tom,     // tom (High)
            DrumEngineType::Cymbal,  // cymbal
            DrumEngineType::Cymbal,  // cymbal
            DrumEngineType::Cowbell, // cowbell
            DrumEngineType::Clave,   // clave
            DrumEngineType::Shaker,  // shaker
            DrumEngineType::Perc,    // perc-generic
            DrumEngineType::Perc,    // perc-generic
        ];

        let pads: Vec<Pad> = (0..num_pads)
            .map(|i| {
                let et = default_types
                    .get(i)
                    .copied()
                    .unwrap_or(DrumEngineType::Perc);
                let mut pad = Pad::new(et);
                // Set open hi-hat on pad 3 with choke group 1 (shared with closed hat)
                if i == 2 {
                    pad.choke_group = 1; // closed hat
                }
                if i == 3 {
                    pad.choke_group = 1; // open hat chokes with closed
                }
                // Native Base Frequencies for Toms
                if i == 6 {
                    pad.base_freq = 80.0;
                } // Low Tom
                if i == 7 {
                    pad.base_freq = 120.0;
                } // Mid Tom
                if i == 8 {
                    pad.base_freq = 200.0;
                } // High Tom
                pad
            })
            .collect();

        let voices: Vec<DrumVoice> = (0..MAX_VOICES)
            .map(|_| DrumVoice::new(sample_rate))
            .collect();

        let transient_shapers: Vec<TransientShaper> = (0..num_pads)
            .map(|_| TransientShaper::new(sample_rate))
            .collect();

        // Pre-allocate bus buffers rigidly to prevent dynamic resizing in the hotpath.
        let max_block = 4096;
        let bus_buffers_l = std::array::from_fn(|_| vec![0.0; max_block]);
        let bus_buffers_r = std::array::from_fn(|_| vec![0.0; max_block]);
        let bus_effects = std::array::from_fn(|_| BusEffects::new(sample_rate));

        Self {
            pads,
            voices,
            transient_shapers,
            bus_buffers_l,
            bus_buffers_r,
            bus_effects,
            global_reverb: PlateReverb::new(sample_rate),
            global_delay: StereoDelay::new(sample_rate),
            global_lofi: LofiProcessor::new(),
            pad_l_gains: vec![0.70710677; num_pads],
            pad_r_gains: vec![0.70710677; num_pads],
            pad_dry_routed_mask: 0,
            sample_rate,
            master_gain: 0.8,
        }
    }

    pub fn note_on(&mut self, pad: u8, velocity: f32, midi_note: u8) {
        let pad_idx = pad as usize;
        if pad_idx >= self.pads.len() {
            return;
        }

        let pad_cfg = &self.pads[pad_idx];
        if pad_cfg.muted {
            return;
        }

        // Choke group: kill any active voices in the same group
        let choke = pad_cfg.choke_group;
        if choke > 0 {
            for voice in self.voices.iter_mut() {
                if voice.active {
                    let vpad = voice.pad_index as usize;
                    if vpad < self.pads.len() && self.pads[vpad].choke_group == choke {
                        voice.release();
                    }
                }
            }
        }

        let voice_idx = self.find_free_voice();

        // Normalize velocity from MIDI 0-127 to 0.0-1.0
        let vel_norm = (velocity / 127.0).clamp(0.0, 1.0);

        let pad_cfg = &self.pads[pad_idx];
        self.voices[voice_idx].trigger(
            pad,
            pad_cfg.engine_type,
            vel_norm * pad_cfg.volume,
            self.sample_rate,
            pad_cfg.filter_cutoff,
            pad_cfg.filter_resonance,
            pad_cfg.is_open,
        );

        // Pitch from MIDI note: 60 = pad's base pitch, each semitone shifts ±1
        let pitch_offset = (midi_note as f32) - 60.0 + pad_cfg.tune;
        self.voices[voice_idx].set_engine_param("tune", pitch_offset);

        // Forward pad-specific engine params
        self.voices[voice_idx].set_engine_param("decay", pad_cfg.decay);
        self.voices[voice_idx].set_engine_param("tone", pad_cfg.tone);
        self.voices[voice_idx].set_engine_param("drive", pad_cfg.drive);
        self.voices[voice_idx].set_engine_param("snappy", pad_cfg.snappy);
        self.voices[voice_idx].set_engine_param("noise_color", pad_cfg.noise_color);
        if pad_cfg.base_freq > 1.0 {
            self.voices[voice_idx].set_engine_param("base_freq", pad_cfg.base_freq);
        }
        self.voices[voice_idx].set_engine_param("pitch_amount", pad_cfg.pitch_amount);
        self.voices[voice_idx].set_engine_param("pitch_decay", pad_cfg.pitch_decay);
        self.voices[voice_idx].set_engine_param("noise_level", pad_cfg.noise_level);
    }

    pub fn note_off(&mut self, pad: u8) {
        for voice in self.voices.iter_mut() {
            if voice.active && voice.pad_index == pad {
                voice.release();
            }
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "master_gain" => self.master_gain = value.clamp(0.0, 2.0),
            n if n.starts_with("reverb_") => self.global_reverb.set_param(n, value),
            n if n.starts_with("delay_") => self.global_delay.set_param(n, value, self.sample_rate),
            "lofi_bits" => self.global_lofi.set_bit_depth(value as u8),
            "lofi_rate" => self.global_lofi.set_rate_reduction(value, self.sample_rate),
            "lofi_mix" => self.global_lofi.set_mix(value),
            // Per-bus compressor: bus1_threshold..bus4_ratio
            n if n.starts_with("bus") && n.len() > 4 => {
                if let Some(idx) = n.as_bytes().get(3).and_then(|b| {
                    let d = (*b as char).to_digit(10)?;
                    if d >= 1 && d <= NUM_BUSES as u32 {
                        Some((d - 1) as usize)
                    } else {
                        None
                    }
                }) {
                    let suffix = &n[5..]; // skip "busN_"
                    match suffix {
                        "threshold" => self.bus_effects[idx].comp_threshold = value.clamp(0.0, 1.0),
                        "ratio" => self.bus_effects[idx].comp_ratio = value.clamp(1.0, 20.0),
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    pub fn set_param_by_id(&mut self, param_id: u32, value: f32) {
        match param_id {
            0 => self.master_gain = value.clamp(0.0, 2.0),
            1 => self.global_reverb.set_param("reverb_mix", value),
            2 => self
                .global_delay
                .set_param("delay_mix", value, self.sample_rate),
            _ => {}
        }
    }

    pub fn set_pad_param(&mut self, pad: u8, name: &str, value: f32) {
        let pad_idx = pad as usize;
        if pad_idx >= self.pads.len() {
            return;
        }
        self.pads[pad_idx].set_param(name, value);

        // Forward transient shaper params to the per-pad shaper
        if pad_idx < self.transient_shapers.len() {
            match name {
                "transient_attack" => self.transient_shapers[pad_idx].set_attack(value),
                "transient_sustain" => self.transient_shapers[pad_idx].set_sustain(value),
                _ => {}
            }
        }
    }

    pub fn set_pad_dry_routed(&mut self, pad: u8, routed: bool) {
        let pad_idx = pad as usize;
        if pad_idx >= self.pads.len() || pad_idx >= u16::BITS as usize {
            return;
        }
        let pad_bit = 1_u16 << pad_idx;
        if routed {
            self.pad_dry_routed_mask |= pad_bit;
        } else {
            self.pad_dry_routed_mask &= !pad_bit;
        }
    }

    pub fn reset_pad_dry_routing(&mut self) {
        self.pad_dry_routed_mask = 0;
    }

    pub fn lifecycle(&self) -> ProcessLifecycle {
        if self.voices.iter().any(|voice| voice.active) {
            return ProcessLifecycle::Continue;
        }
        if self.global_reverb.is_active()
            || self.global_delay.is_active()
            || self.bus_effects.iter().any(BusEffects::is_active)
            || self.global_lofi.is_active()
        {
            return ProcessLifecycle::ContinueIfNotQuiet;
        }
        ProcessLifecycle::Sleep
    }

    pub fn advance_silence(&mut self, frames: usize) {
        self.global_lofi.advance_silence(frames, self.sample_rate);
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.process_block_inner(left, right, None, 0);
    }

    pub fn process_block_with_pad_outputs(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        pad_outputs: &mut [f32],
        pad_stride: usize,
    ) {
        self.process_block_inner(left, right, Some(pad_outputs), pad_stride);
    }

    fn process_block_inner(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        mut pad_outputs: Option<&mut [f32]>,
        pad_stride: usize,
    ) {
        let len = left.len().min(right.len()).min(self.bus_buffers_l[0].len());
        let required_pad_samples = self.pads.len().saturating_mul(2).saturating_mul(pad_stride);
        let pad_outputs_valid = pad_stride >= len
            && pad_outputs
                .as_ref()
                .is_some_and(|outputs| outputs.len() >= required_pad_samples);

        if pad_outputs_valid {
            let outputs = pad_outputs
                .as_deref_mut()
                .expect("validated pad output buffer");
            for channel in 0..self.pads.len() * 2 {
                let start = channel * pad_stride;
                outputs[start..start + len].fill(0.0);
            }
        }

        // Precompute panning gains per pad for this block to avoid sqrt() in the inner loop
        for p in 0..self.pads.len() {
            let pan = self.pads[p].pan;
            self.pad_l_gains[p] = ((1.0_f32 - pan) * 0.5_f32).sqrt();
            self.pad_r_gains[p] = ((1.0_f32 + pan) * 0.5_f32).sqrt();
        }

        // --- Clear the required length of pre-allocated bus buffers -----------
        for b in 0..NUM_BUSES {
            self.bus_buffers_l[b][..len].fill(0.0);
            self.bus_buffers_r[b][..len].fill(0.0);
        }

        // Clear master output
        for i in 0..len {
            left[i] = 0.0;
            right[i] = 0.0;
        }

        // --- Accumulate voices into buses or master --------------------------
        for i in 0..len {
            let mut reverb_send = 0.0_f32;
            let mut delay_send = 0.0_f32;

            for voice in self.voices.iter_mut() {
                if !voice.active {
                    continue;
                }

                let mut sample = voice.tick(self.sample_rate);
                let pad_idx = voice.pad_index as usize;

                if pad_idx < self.pads.len() {
                    // Per-pad transient shaping
                    if pad_idx < self.transient_shapers.len() {
                        sample = self.transient_shapers[pad_idx].process(sample);
                    }

                    let pad = &self.pads[pad_idx];

                    // Constant-power pan
                    let l_gain = self.pad_l_gains[pad_idx];
                    let r_gain = self.pad_r_gains[pad_idx];
                    let sl = sample * l_gain;
                    let sr = sample * r_gain;

                    if pad_outputs_valid {
                        let outputs = pad_outputs
                            .as_deref_mut()
                            .expect("validated pad output buffer");
                        let tap_start = pad_idx * 2 * pad_stride;
                        // The engine owns master gain for both the parent mix and
                        // routed pad taps so every output follows one render-quantum
                        // automation clock.
                        outputs[tap_start + i] += sl * self.master_gain;
                        outputs[tap_start + pad_stride + i] += sr * self.master_gain;
                    }

                    let pad_dry_routed = pad_idx < u16::BITS as usize
                        && self.pad_dry_routed_mask & (1_u16 << pad_idx) != 0;
                    if !pad_dry_routed {
                        let bus = pad.bus_route;
                        if bus >= 1 && (bus as usize) <= NUM_BUSES {
                            let bi = (bus as usize) - 1;
                            self.bus_buffers_l[bi][i] += sl;
                            self.bus_buffers_r[bi][i] += sr;
                        } else {
                            // Route directly to master
                            left[i] += sl;
                            right[i] += sr;
                        }
                    }

                    // Send levels (always go to global fx regardless of bus)
                    reverb_send += sample * pad.send_reverb;
                    delay_send += sample * pad.send_delay;
                } else {
                    // Fallback: straight to master
                    left[i] += sample;
                    right[i] += sample;
                }
            }

            // Process sends through global effects
            let (rev_l, rev_r) = self.global_reverb.process(reverb_send);
            let (del_l, del_r) = self.global_delay.process(delay_send);
            left[i] += rev_l + del_l;
            right[i] += rev_r + del_r;
        }

        // --- Process bus effects and sum into master -------------------------
        for b in 0..NUM_BUSES {
            for i in 0..len {
                let cl = self.bus_effects[b].process(self.bus_buffers_l[b][i]);
                let cr = self.bus_effects[b].process(self.bus_buffers_r[b][i]);
                left[i] += cl;
                right[i] += cr;
            }
        }

        // --- Apply master gain -----------------------------------------------
        for i in 0..len {
            left[i] *= self.master_gain;
            right[i] *= self.master_gain;
        }

        // Apply lo-fi processing after reverb/delay (operates on the full block)
        self.global_lofi
            .process_block(left, right, self.sample_rate);
    }

    fn find_free_voice(&self) -> usize {
        // First: find an inactive voice
        for (i, voice) in self.voices.iter().enumerate() {
            if !voice.active {
                return i;
            }
        }
        // All busy: steal the oldest
        let mut oldest_idx = 0;
        let mut oldest_age = 0;
        for (i, voice) in self.voices.iter().enumerate() {
            if voice.age > oldest_age {
                oldest_age = voice.age;
                oldest_idx = i;
            }
        }
        oldest_idx
    }
}
