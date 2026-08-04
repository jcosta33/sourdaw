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

    // Playback configuration
    playback_mode: PlaybackMode,
    loop_mode: LoopMode,
    loop_start: u32,
    loop_end: u32,
    loop_crossfade: u32,

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
            playback_mode: PlaybackMode::Sustain,
            loop_mode: LoopMode::Off,
            loop_start: 0,
            loop_end: 0,
            loop_crossfade: LOOP_CROSSFADE_DEFAULT,
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
        self.loop_start = params.loop_start;
        self.loop_end = params.loop_end;
        self.loop_crossfade = params.loop_crossfade;

        // Calculate playback speed from pitch difference
        let semitone_diff =
            (params.note as f32 - params.root_note as f32) + self.tune_cents / 100.0;
        self.speed = 2.0_f64.powf(semitone_diff as f64 / 12.0);

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

        // Read sample with 8-point windowed Sinc interpolation
        let frame = self.position as usize;
        let frac = (self.position - frame as f64) as f32;

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
                    let overshoot = self.position - end;
                    self.position = start + overshoot;
                }
            }

            LoopMode::PingPong => {
                if self.direction > 0.0 && self.position >= end {
                    self.direction = -1.0;
                    self.position = end - (self.position - end);
                } else if self.direction < 0.0 && self.position <= start {
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
        self.speed = 2.0_f64.powf(semitone_diff as f64 / 12.0);
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
