/// Crumbs voice — the per-voice playback unit.
///
/// Each voice handles:
///   - Fractional-position playback with 4-point cubic Hermite interpolation
///   - Per-voice AHDSR amplitude envelope
///   - Per-voice TPT SVF filter
///   - Loop handling (Forward, PingPong, Reverse) with equal-power crossfade
///   - One-pole parameter smoothing on gain and pan
///   - Linear fade-out on voice steal (1–5ms)
use super::allocator::StealPriority;
use super::envelope::{AhdsrEnvelope, EnvelopeState};
use super::filter::TptSvf;
use super::sample::SampleData;
use super::smooth::ParamSmoother;
use super::types::{
    FilterType, LoopMode, PlaybackMode, SampleId, FADE_STOLEN_SECS, LOOP_CROSSFADE_DEFAULT,
};

// ── Constants ──────────────────────────────────────────────────────────

// ── Crumbs Voice ──────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct CrumbsVoice {
    // Voice state
    pub active: bool,
    pub note: u8,
    pub velocity: f32,
    pub age: u32,

    // Sample reference
    pub sample_id: SampleId,
    pub root_note: u8,
    pub tune_cents: f32,

    // Playback position (f64 for sub-sample precision)
    position: f64,
    speed: f64,
    direction: f64,
    anti_alias_cutoff: f32,
    anti_alias_step_sin: f32,
    anti_alias_step_cos: f32,

    // Playback configuration
    playback_mode: PlaybackMode,
    loop_mode: LoopMode,
    region_start: u32,
    loop_start: u32,
    loop_end: u32,
    loop_crossfade: u32,
    has_looped: bool,

    // DSP components
    amp_envelope: AhdsrEnvelope,
    // Independent L/R filter instances — coefficients are kept in sync via
    // `set_params`, but state (ic1eq/ic2eq) must NOT be shared across channels
    // or stereo content cross-talks through the filter memory.
    filter_l: TptSvf,
    filter_r: TptSvf,
    filter_type: FilterType,
    filter_enabled: bool,

    // Parameter smoothers
    gain_smoother: ParamSmoother,
    pan_smoother: ParamSmoother,

    // Voice stealing fade
    steal_fade: f32,
    steal_fade_decrement: f32,
    stealing: bool,

    // Energy tracking for voice stealing priority
    energy: f32,
    energy_coeff: f32,

    // Choke group membership
    pub choke_group: u8,

    sample_rate: f32,
}

impl CrumbsVoice {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            active: false,
            note: 0,
            velocity: 1.0,
            age: 0,
            sample_id: 0,
            root_note: 60,
            tune_cents: 0.0,
            position: 0.0,
            speed: 1.0,
            direction: 1.0,
            anti_alias_cutoff: 1.0,
            anti_alias_step_sin: 0.0,
            anti_alias_step_cos: -1.0,
            playback_mode: PlaybackMode::Sustain,
            loop_mode: LoopMode::Off,
            region_start: 0,
            loop_start: 0,
            loop_end: 0,
            loop_crossfade: LOOP_CROSSFADE_DEFAULT,
            has_looped: false,
            amp_envelope: AhdsrEnvelope::new(sample_rate),
            filter_l: TptSvf::new(sample_rate),
            filter_r: TptSvf::new(sample_rate),
            filter_type: FilterType::Lowpass,
            filter_enabled: false,
            gain_smoother: ParamSmoother::with_value(sample_rate, 0.01, 1.0),
            pan_smoother: ParamSmoother::with_value(sample_rate, 0.01, 0.0),
            steal_fade: 1.0,
            steal_fade_decrement: 0.0,
            stealing: false,
            energy: 0.0,
            energy_coeff: (-1.0 / (sample_rate * 0.01)).exp(),
            choke_group: 0,
            sample_rate,
        }
    }

    // ── Trigger / Release ──────────────────────────────────────────────

    pub fn trigger(&mut self, params: &VoiceTriggerParams) {
        self.active = true;
        self.note = params.note;
        self.velocity = params.velocity as f32 / 127.0;
        self.age = 0;
        self.sample_id = params.sample_id;
        self.root_note = params.root_note;
        self.choke_group = params.choke_group;
        self.playback_mode = params.playback_mode;
        self.loop_mode = params.loop_mode;
        self.region_start = params.start_frame;
        self.loop_start = params.loop_start;
        self.loop_end = params.loop_end;
        self.loop_crossfade = params.loop_crossfade;
        self.has_looped = self.loop_mode == LoopMode::Reverse;

        // Calculate playback speed from pitch difference
        let semitone_diff =
            (params.note as f32 - params.root_note as f32) + self.tune_cents / 100.0;
        self.set_playback_speed(semitone_diff);

        self.direction = if self.loop_mode == LoopMode::Reverse {
            -1.0
        } else {
            1.0
        };
        self.position = if self.direction < 0.0 {
            // Reverse: start at loop end (or end of sample region).
            if params.loop_end > 0 {
                (params.loop_end - 1) as f64
            } else {
                params.start_frame as f64
            }
        } else {
            params.start_frame as f64
        };

        // Reset DSP state
        self.amp_envelope.note_on();
        self.filter_l.reset();
        self.filter_r.reset();
        self.steal_fade = 1.0;
        self.stealing = false;
        self.energy = 0.0;

        // Apply filter settings
        self.filter_l
            .set_params(params.filter_cutoff, params.filter_resonance);
        self.filter_r
            .set_params(params.filter_cutoff, params.filter_resonance);
        self.filter_type = params.filter_type;
        self.filter_enabled = params.filter_cutoff < 19999.0 || params.filter_resonance > 0.01;

        // Set envelope
        self.amp_envelope.set_attack(params.attack);
        self.amp_envelope.set_hold(params.hold);
        self.amp_envelope.set_decay(params.decay);
        self.amp_envelope.set_sustain(params.sustain);
        self.amp_envelope.set_release(params.release);
    }

    pub fn release(&mut self) {
        if self.playback_mode == PlaybackMode::OneShot {
            // One-shots ignore note-off — they play to completion.
            return;
        }
        self.amp_envelope.note_off();
    }

    /// Begin a linear fade-out for voice stealing.
    pub fn begin_steal_fade(&mut self) {
        self.stealing = true;
        let fade_samples = (FADE_STOLEN_SECS * self.sample_rate).max(1.0);
        self.steal_fade_decrement = 1.0 / fade_samples;
    }

    /// Remaining gain multiplier of the de-click fade: 1.0 before it starts and
    /// falling linearly to zero once `begin_steal_fade` has been called.
    pub fn steal_fade(&self) -> f32 {
        self.steal_fade
    }

    /// Silence the voice at once and reset its fade state.
    ///
    /// This is the one path that does cut a waveform, so it exists only where
    /// there is nothing left to fade into: a fade slot that has to be recycled
    /// because every one of them is still sounding.
    ///
    /// It is *not* what silences a stolen voice. The engine swaps the recycled
    /// struct back into the playable pool, and on the `note_on` path `trigger`
    /// would overwrite `active`, `stealing` and `steal_fade` anyway. What this
    /// call is load-bearing for is the path that does not retrigger:
    /// `all_sound_off` swaps every sounding voice out and then hands its slot
    /// back to the allocator, so a recycled tail that arrived still active
    /// would sit in a free slot, sounding, waiting for the next note to
    /// overwrite it mid-fade.
    pub fn kill(&mut self) {
        self.active = false;
        self.stealing = false;
        self.steal_fade = 1.0;
    }

    // ── Per-Sample Rendering ───────────────────────────────────────────

    /// Render one sample of audio into left/right output.
    /// Returns true if the voice is still active after this sample.
    pub fn render_sample(
        &mut self,
        sample_data: &SampleData,
        out_left: &mut f32,
        out_right: &mut f32,
    ) -> bool {
        if !self.active {
            return false;
        }

        self.age += 1;

        // Advance envelope
        let env_level = self.amp_envelope.tick();

        // Handle steal fade
        let steal_gain = if self.stealing {
            self.steal_fade -= self.steal_fade_decrement;
            if self.steal_fade <= 0.0 {
                self.steal_fade = 0.0;
                self.active = false;
                return false;
            }
            self.steal_fade
        } else {
            1.0
        };

        // Check if envelope finished
        if !self.amp_envelope.is_active() && !self.stealing {
            self.active = false;
            return false;
        }

        // Pitch-up needs a narrower interpolation kernel so source content
        // above the destination Nyquist limit cannot fold into the output.
        let frame = self.position as usize;
        let frac = (self.position - frame as f64) as f32;

        let (left, right) = if self.speed > 1.0 {
            bandlimited_stereo_sample(
                sample_data,
                frame,
                frac,
                self.anti_alias_cutoff,
                self.anti_alias_step_sin,
                self.anti_alias_step_cos,
                self.region_start,
                self.loop_start,
                self.loop_end,
                self.loop_mode,
                self.has_looped,
            )
        } else {
            let left_samples = [
                sample_data.read_left(frame.wrapping_sub(3)),
                sample_data.read_left(frame.wrapping_sub(2)),
                sample_data.read_left(frame.wrapping_sub(1)),
                sample_data.read_left(frame),
                sample_data.read_left(frame + 1),
                sample_data.read_left(frame + 2),
                sample_data.read_left(frame + 3),
                sample_data.read_left(frame + 4),
            ];
            let left = windowed_sinc(frac, &left_samples);
            let right = if sample_data.is_stereo() {
                let right_samples = [
                    sample_data.read_right(frame.wrapping_sub(3)),
                    sample_data.read_right(frame.wrapping_sub(2)),
                    sample_data.read_right(frame.wrapping_sub(1)),
                    sample_data.read_right(frame),
                    sample_data.read_right(frame + 1),
                    sample_data.read_right(frame + 2),
                    sample_data.read_right(frame + 3),
                    sample_data.read_right(frame + 4),
                ];
                windowed_sinc(frac, &right_samples)
            } else {
                left
            };
            (left, right)
        };

        // Apply filter — independent state per channel so L/R don't cross-talk
        // through filter memory. Coefficients are identical (kept in sync by
        // `set_filter_params`), so this is ~2x filter cost but correct stereo.
        let (filtered_left, filtered_right) = if self.filter_enabled {
            let fl = self.filter_l.process_mono(left, self.filter_type);
            let fr = if sample_data.is_stereo() {
                self.filter_r.process_mono(right, self.filter_type)
            } else {
                fl
            };
            (fl, fr)
        } else {
            (left, right)
        };

        // Calculate gains
        let gain = self.gain_smoother.tick();
        let pan = self.pan_smoother.tick();
        // Equal-power panning: map pan ∈ [-1,1] to angle ∈ [0, π/2]
        let theta = (pan + 1.0) * 0.5 * std::f32::consts::FRAC_PI_2;
        let pan_left = theta.cos();
        let pan_right = theta.sin();

        let final_gain = self.velocity * env_level * steal_gain * gain;

        *out_left += filtered_left * final_gain * pan_left;
        *out_right += filtered_right * final_gain * pan_right;

        // Track energy (RMS approximation via one-pole)
        let sample_energy = filtered_left * filtered_left + filtered_right * filtered_right;
        self.energy = self.energy * self.energy_coeff + sample_energy * (1.0 - self.energy_coeff);

        // Advance position
        self.advance_position(sample_data.frame_count());

        self.active
    }

    // ── Position Advancement & Looping ─────────────────────────────────

    fn advance_position(&mut self, total_frames: usize) {
        self.position += self.speed * self.direction;

        let end = if self.loop_end > 0 {
            self.loop_end as f64
        } else {
            total_frames as f64
        };
        let start = self.loop_start as f64;

        match self.loop_mode {
            LoopMode::Off => {
                if self.position >= end || self.position < 0.0 {
                    self.active = false;
                }
            }

            LoopMode::Forward => {
                if self.position >= end {
                    self.has_looped = true;
                    let overshoot = self.position - end;
                    self.position = start + overshoot;
                }
            }

            LoopMode::PingPong => {
                if self.direction > 0.0 && self.position >= end {
                    self.has_looped = true;
                    self.direction = -1.0;
                    self.position = end - (self.position - end);
                } else if self.direction < 0.0 && self.position <= start {
                    self.has_looped = true;
                    self.direction = 1.0;
                    self.position = start + (start - self.position);
                }
            }

            LoopMode::Reverse => {
                if self.position < start {
                    let undershoot = start - self.position;
                    self.position = end - undershoot;
                }
            }
        }
    }

    // ── Parameter Updates ──────────────────────────────────────────────

    pub fn set_gain(&mut self, gain: f32) {
        self.gain_smoother.set(gain);
    }

    pub fn set_pan(&mut self, pan: f32) {
        self.pan_smoother.set(pan.clamp(-1.0, 1.0));
    }

    pub fn set_filter_params(&mut self, cutoff: f32, resonance: f32) {
        self.filter_l.set_params(cutoff, resonance);
        self.filter_r.set_params(cutoff, resonance);
        self.filter_enabled = cutoff < 19999.0 || resonance > 0.01;
    }

    pub fn set_filter_type(&mut self, filter_type: FilterType) {
        self.filter_type = filter_type;
    }

    pub fn set_tune(&mut self, cents: f32) {
        self.tune_cents = cents;
        let semitone_diff = (self.note as f32 - self.root_note as f32) + self.tune_cents / 100.0;
        self.set_playback_speed(semitone_diff);
    }

    fn set_playback_speed(&mut self, semitone_diff: f32) {
        self.speed = 2.0_f64.powf(semitone_diff as f64 / 12.0);
        self.anti_alias_cutoff = (1.0 / self.speed).min(1.0) as f32;
        let step = core::f32::consts::PI * self.anti_alias_cutoff;
        (self.anti_alias_step_sin, self.anti_alias_step_cos) = step.sin_cos();
    }

    // ── Steal Priority ─────────────────────────────────────────────────

    /// Compute this voice's steal priority for voice allocation decisions.
    pub fn steal_priority(&self, target_note: u8, target_choke: u8) -> StealPriority {
        if !self.active {
            return StealPriority::None;
        }
        if self.note == target_note {
            return StealPriority::SameNote;
        }
        if target_choke > 0 && self.choke_group == target_choke {
            return StealPriority::ChokeGroup;
        }
        if self.amp_envelope.state() == EnvelopeState::Release {
            return StealPriority::Releasing;
        }
        // For oldest/quietest, the caller must compare across voices.
        StealPriority::Oldest
    }

    /// Get the current energy level (for quietest-voice stealing).
    pub fn energy(&self) -> f32 {
        self.energy
    }

    /// Whether this voice is already running its de-click fade, from a choke or
    /// an earlier steal.
    ///
    /// Steal selection has to skip these. `choke_voices_in_group` deliberately
    /// leaves the allocator slot alone and starts only the fade, because
    /// releasing it would let the next `allocate` hand the same slot back and
    /// jump-cut the waveform. That protection held only while the pool had a
    /// free slot elsewhere: once saturated, `find_steal_target`'s oldest and
    /// quietest fallbacks — which run outside the priority check and skip only
    /// *inactive* voices — picked a just-choked voice anyway, so the choke pass
    /// and the steal pass undid each other.
    pub fn is_stealing(&self) -> bool {
        self.stealing
    }

    /// Get the voice age in samples (for oldest-voice stealing).
    pub fn age(&self) -> u32 {
        self.age
    }

    /// Get the current fractional playback position.
    pub fn position(&self) -> f64 {
        self.position
    }

    /// Get the current playback position as integer frames.
    pub fn position_frames(&self) -> u64 {
        self.position as u64
    }
}

// ── Voice Trigger Parameters ───────────────────────────────────────────

/// All parameters needed to trigger a new voice.
#[derive(Debug, Clone)]
pub struct VoiceTriggerParams {
    pub note: u8,
    pub velocity: u8,
    pub sample_id: SampleId,
    pub root_note: u8,
    pub choke_group: u8,
    pub playback_mode: PlaybackMode,
    pub loop_mode: LoopMode,
    pub loop_start: u32,
    pub loop_end: u32,
    pub loop_crossfade: u32,
    pub start_frame: u32,
    pub attack: f32,
    pub hold: f32,
    pub decay: f32,
    pub sustain: f32,
    pub release: f32,
    pub filter_cutoff: f32,
    pub filter_resonance: f32,
    pub filter_type: FilterType,
}

impl Default for VoiceTriggerParams {
    fn default() -> Self {
        Self {
            note: 60,
            velocity: 127,
            sample_id: 0,
            root_note: 60,
            choke_group: 0,
            playback_mode: PlaybackMode::Sustain,
            loop_mode: LoopMode::Off,
            loop_start: 0,
            loop_end: 0,
            loop_crossfade: LOOP_CROSSFADE_DEFAULT,
            start_frame: 0,
            attack: 0.001,
            hold: 0.0,
            decay: 0.0,
            sustain: 1.0,
            release: 0.01,
            filter_cutoff: 20000.0,
            filter_resonance: 0.0,
            filter_type: FilterType::Lowpass,
        }
    }
}

// ── Windowed Sinc Interpolation ────────────────────────────────────────

/// 8-point Hann-windowed Sinc interpolation for bandlimited fractional resampling.
///
/// Given eight consecutive samples (y[-3] to y[4]) and a fractional
/// position `t` between y[0] and y[1] (0.0–1.0), returns the interpolated value.
fn windowed_sinc(t: f32, samples: &[f32; 8]) -> f32 {
    let mut sum = 0.0;

    // For n from -3 to 4
    for i in 0..8 {
        let n = i as f32 - 3.0;
        let x = t - n;

        if x == 0.0 {
            sum += samples[i];
        } else {
            let pi_x = std::f32::consts::PI * x;
            let sinc = pi_x.sin() / pi_x;

            // Hann window over [-4, 4]
            let window = 0.5 * (1.0 + (std::f32::consts::PI * x / 4.0).cos());

            sum += samples[i] * sinc * window;
        }
    }

    sum
}

const BANDLIMITED_SINC_TAPS: usize = 49;
/// Fixed Blackman-Harris window. Keeping it as coefficients avoids evaluating
/// four trigonometric functions per tap on the audio thread.
const BANDLIMITED_SINC_WINDOW: [f32; BANDLIMITED_SINC_TAPS] = [
    0.000060000,
    0.000312476,
    0.001191140,
    0.003059167,
    0.006518456,
    0.012399195,
    0.021735837,
    0.035722840,
    0.055645000,
    0.082780374,
    0.118278187,
    0.163019107,
    0.217470000,
    0.281548891,
    0.354517675,
    0.434919534,
    0.520575000,
    0.608645251,
    0.695764163,
    0.778232715,
    0.852261544,
    0.914240925,
    0.961012998,
    0.990119525,
    1.000000000,
    0.990119525,
    0.961012998,
    0.914240925,
    0.852261544,
    0.778232715,
    0.695764163,
    0.608645251,
    0.520575000,
    0.434919534,
    0.354517675,
    0.281548891,
    0.217470000,
    0.163019107,
    0.118278187,
    0.082780374,
    0.055645000,
    0.035722840,
    0.021735837,
    0.012399195,
    0.006518456,
    0.003059167,
    0.001191140,
    0.000312476,
    0.000060000,
];

fn bandlimited_stereo_sample(
    sample: &SampleData,
    frame: usize,
    fraction: f32,
    cutoff_scale: f32,
    sinc_step_sin: f32,
    sinc_step_cos: f32,
    region_start: u32,
    loop_start: u32,
    loop_end: u32,
    loop_mode: LoopMode,
    has_looped: bool,
) -> (f32, f32) {
    let mut output_left = 0.0;
    let mut output_right = 0.0;
    let mut weight_sum = 0.0;
    let radius = (BANDLIMITED_SINC_TAPS / 2) as f32;
    let stereo = sample.is_stereo();
    let mut distance = fraction + radius;
    let sinc_angle = core::f32::consts::PI * distance * cutoff_scale;
    let (mut sinc_sin, mut sinc_cos) = sinc_angle.sin_cos();
    let region_start = region_start as usize;
    let loop_start = loop_start as usize;
    let region_end = if loop_end > 0 {
        (loop_end as usize).min(sample.frame_count())
    } else {
        sample.frame_count()
    };

    for tap in 0..BANDLIMITED_SINC_TAPS {
        let lowpass = if distance.abs() < f32::EPSILON {
            cutoff_scale
        } else {
            sinc_sin / (core::f32::consts::PI * distance)
        };
        let weight = lowpass * BANDLIMITED_SINC_WINDOW[tap];
        let raw_index = frame as i64 + tap as i64 - BANDLIMITED_SINC_TAPS as i64 / 2;
        if let Some(index) = map_bandlimited_frame(
            raw_index,
            region_start,
            loop_start,
            region_end,
            loop_mode,
            has_looped,
        ) {
            output_left += sample.read_left(index) * weight;
            if stereo {
                output_right += sample.read_right(index) * weight;
            }
        }
        weight_sum += weight;

        let next_sinc_sin = sinc_sin * sinc_step_cos - sinc_cos * sinc_step_sin;
        sinc_cos = sinc_cos * sinc_step_cos + sinc_sin * sinc_step_sin;
        sinc_sin = next_sinc_sin;
        distance -= 1.0;
    }

    let normalization = 1.0 / weight_sum.max(1.0e-12);
    let left = output_left * normalization;
    let right = if stereo {
        output_right * normalization
    } else {
        left
    };
    (left, right)
}

fn map_bandlimited_frame(
    index: i64,
    region_start: usize,
    loop_start: usize,
    region_end: usize,
    loop_mode: LoopMode,
    has_looped: bool,
) -> Option<usize> {
    if region_end <= region_start {
        return None;
    }

    if loop_mode == LoopMode::Off {
        return ((region_start as i64)..(region_end as i64))
            .contains(&index)
            .then_some(index as usize);
    }

    if loop_start >= region_end {
        return None;
    }

    if !has_looped && index < region_start as i64 {
        return None;
    }
    if !has_looped && index < region_end as i64 {
        return Some(index as usize);
    }

    let start = loop_start as i64;
    let length = region_end as i64 - start;
    let relative = (index - start).rem_euclid(length);
    if loop_mode != LoopMode::PingPong {
        return Some((start + relative) as usize);
    }

    let reflected = (index - start).rem_euclid(length * 2);
    if reflected < length {
        Some((start + reflected) as usize)
    } else {
        Some((start + length * 2 - reflected - 1) as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::primitives::alias_probe::bin_magnitude;

    const SAMPLE_RATE: f32 = 48_000.0;
    const OUTPUT_SAMPLES: usize = 8_192;
    const SETTLE_SAMPLES: usize = 2_048;

    fn render_pitched_tone(source_frequency: f32, use_tune_control: bool) -> Vec<f32> {
        let source_frames = (OUTPUT_SAMPLES + SETTLE_SAMPLES) * 2 + 128;
        let source = (0..source_frames)
            .map(|frame| {
                let phase =
                    2.0 * core::f32::consts::PI * source_frequency * frame as f32 / SAMPLE_RATE;
                phase.sin()
            })
            .collect();
        let sample = SampleData::from_mono(source, SAMPLE_RATE as u32);
        let mut voice = CrumbsVoice::new(SAMPLE_RATE);
        voice.trigger(&VoiceTriggerParams {
            note: if use_tune_control { 60 } else { 72 },
            root_note: 60,
            playback_mode: PlaybackMode::OneShot,
            ..VoiceTriggerParams::default()
        });
        if use_tune_control {
            voice.set_tune(1_200.0);
        }

        let mut output = Vec::with_capacity(OUTPUT_SAMPLES);
        for frame in 0..(OUTPUT_SAMPLES + SETTLE_SAMPLES) {
            let mut left = 0.0;
            let mut right = 0.0;
            voice.render_sample(&sample, &mut left, &mut right);
            if frame >= SETTLE_SAMPLES {
                output.push(left);
            }
        }
        output
    }

    fn render_unfiltered_pitched_tone(source_frequency: f32) -> Vec<f32> {
        (SETTLE_SAMPLES..(OUTPUT_SAMPLES + SETTLE_SAMPLES))
            .map(|frame| {
                let source_frame = frame * 2;
                let phase = 2.0 * core::f32::consts::PI * source_frequency * source_frame as f32
                    / SAMPLE_RATE;
                phase.sin()
            })
            .collect()
    }

    fn render_region_boundary(loop_mode: LoopMode, outside_value: f32) -> (f32, f32) {
        let mut left = vec![outside_value; 256];
        let mut right = vec![-outside_value; 256];
        left[64..128].fill(0.25);
        right[64..128].fill(-0.5);
        let sample = SampleData::from_stereo(left, right, SAMPLE_RATE as u32);
        let mut voice = CrumbsVoice::new(SAMPLE_RATE);
        voice.trigger(&VoiceTriggerParams {
            note: 72,
            root_note: 60,
            playback_mode: PlaybackMode::Sustain,
            loop_mode,
            loop_start: 64,
            loop_end: 128,
            start_frame: 64,
            ..VoiceTriggerParams::default()
        });

        let mut output_left = 0.0;
        let mut output_right = 0.0;
        voice.render_sample(&sample, &mut output_left, &mut output_right);
        (output_left, output_right)
    }

    #[test]
    fn pitched_up_reader_does_not_cross_voice_region_boundaries() {
        for loop_mode in [
            LoopMode::Off,
            LoopMode::Forward,
            LoopMode::PingPong,
            LoopMode::Reverse,
        ] {
            let clean = render_region_boundary(loop_mode, 0.0);
            let poisoned = render_region_boundary(loop_mode, 8.0);

            assert!(
                clean.0 > 0.0 && clean.1 < 0.0,
                "{loop_mode:?} must preserve stereo"
            );
            assert!(
                (clean.0 - poisoned.0).abs() < 1.0e-6 && (clean.1 - poisoned.1).abs() < 1.0e-6,
                "{loop_mode:?} mixed adjacent-region audio: clean {clean:?}, poisoned {poisoned:?}"
            );
        }
    }

    #[test]
    fn pitched_up_playback_suppresses_foldback_by_at_least_42_db() {
        let unfiltered_signal = bin_magnitude(
            &render_unfiltered_pitched_tone(5_000.0),
            10_000.0,
            SAMPLE_RATE,
        );
        let unfiltered_foldback = bin_magnitude(
            &render_unfiltered_pitched_tone(15_000.0),
            18_000.0,
            SAMPLE_RATE,
        );
        let unfiltered_db = 20.0 * (unfiltered_foldback / unfiltered_signal.max(1.0e-12)).log10();
        assert!(
            unfiltered_db > -3.0,
            "unfiltered pitch-up must genuinely alias, got {unfiltered_db:.1} dB"
        );

        for use_tune_control in [false, true] {
            let passband = render_pitched_tone(5_000.0, use_tune_control);
            let aliased = render_pitched_tone(15_000.0, use_tune_control);
            let signal = bin_magnitude(&passband, 10_000.0, SAMPLE_RATE);
            let foldback = bin_magnitude(&aliased, 18_000.0, SAMPLE_RATE);
            let alias_to_signal_db = 20.0 * (foldback / signal.max(1.0e-12)).log10();

            assert!(
                signal > 0.1,
                "passband reference must remain audible, got {signal}"
            );
            assert!(
                alias_to_signal_db <= -42.0,
                "pitched playback must suppress foldback by at least 42 dB, got \
                 {alias_to_signal_db:.1} dB (tune control: {use_tune_control})"
            );
        }
    }
}
