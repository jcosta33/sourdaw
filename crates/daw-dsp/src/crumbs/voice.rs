/// Crumbs voice — the per-voice playback unit.
///
/// Each voice handles:
///   - Fractional-position playback with 8-point Hann-windowed sinc
///     interpolation, widening to a 49–161-tap Kaiser-windowed bandlimited
///     kernel when pitched up (`bandlimited_stereo_sample`)
///   - Per-voice AHDSR amplitude envelope
///   - Per-voice TPT SVF filter
///   - Loop handling (Forward, PingPong, Reverse) with linear seam crossfade
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

const MIN_PLAYBACK_SPEED: f64 = 1.0 / 16.0;
const MAX_PLAYBACK_SPEED: f64 = 16.0;
const UNITY_RESAMPLING_WORK_UNITS: usize = 8;
const MIN_BANDLIMITED_TAPS: usize = 49;
/// Widest kernel the audio thread may run: radius 80 source frames at the 16x
/// pitch cap. Sizes the per-voice window table.
const MAX_BANDLIMITED_TAPS: usize = 161;

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
    anti_alias_taps: usize,
    /// Kaiser window weights for the anti-alias kernel, one per tap. A fixed
    /// array rather than the recursive phase rotation it replaced: the window
    /// depends only on the tap index, so a rotation recomputed it per sample
    /// for no reason, and a table admits any window shape however expensive to
    /// evaluate. Refilled by `set_playback_speed`; `anti_alias_window_key` is
    /// the fill's key, so retriggering at an unchanged pitch skips the
    /// transcendental refill.
    anti_alias_window: [f32; MAX_BANDLIMITED_TAPS],
    anti_alias_window_key: (u16, u16),

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
            anti_alias_taps: BANDLIMITED_SINC_TAPS,
            anti_alias_window: [0.0; MAX_BANDLIMITED_TAPS],
            anti_alias_window_key: (0, 0),
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

        let (left, right) = self.interpolate_stereo(sample_data, frame, frac);
        let (left, right) = self.apply_loop_crossfade(sample_data, frame, frac, left, right);

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

    // ── Interpolated Reads ─────────────────────────────────────────────

    /// Read one interpolated stereo frame at `frame + fraction`.
    ///
    /// Pitching up needs the wider bandlimited kernel so source content above
    /// the destination Nyquist limit cannot fold into the output; at or below
    /// unity the 8-point windowed sinc is enough. Both branches live here so a
    /// second read at a different position — the loop-seam crossfade's shadow
    /// read — goes through the identical filter as the primary one.
    fn interpolate_stereo(
        &self,
        sample_data: &SampleData,
        frame: usize,
        fraction: f32,
    ) -> (f32, f32) {
        if self.speed > 1.0 {
            return bandlimited_stereo_sample(
                sample_data,
                frame,
                fraction,
                self.anti_alias_cutoff,
                self.anti_alias_step_sin,
                self.anti_alias_step_cos,
                self.anti_alias_taps,
                &self.anti_alias_window,
                self.region_start,
                self.loop_start,
                self.loop_end,
                self.loop_mode,
                self.has_looped,
            );
        }

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
        let left = windowed_sinc(fraction, &left_samples);
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
            windowed_sinc(fraction, &right_samples)
        } else {
            left
        };
        (left, right)
    }

    /// Linear crossfade across a Forward loop's seam.
    ///
    /// Inside the last `span` frames before `loop_end`, blend the loop's tail
    /// against the material one loop length behind the playhead — the frames
    /// leading into `loop_start`. The shadow ends exactly on `loop_start` as
    /// the playhead reaches the seam, so the blend converges on the sample the
    /// next iteration starts with and the wrap lands on already-matched
    /// audio. (Blending against `loop_start + offset` instead — the fade's
    /// mirror rather than the loop's — ends the fade on an arbitrary interior
    /// frame and clicks even on loops that were clean.) `loop_crossfade` was
    /// stored on every voice and read by nothing (audit F14).
    ///
    /// The fade consumes pre-roll: it needs `span` frames before `loop_start`,
    /// the same material a sample editor commits into the loop when it renders
    /// a crossfaded loop destructively. The span shrinks to the pre-roll
    /// available inside the region (and to the loop length), and a loop with
    /// no pre-roll — `loop_start` at the region start — plays unfaded rather
    /// than blending against unrelated or missing audio.
    ///
    /// The shadow read reuses `interpolate_stereo`, so a pitched-up voice
    /// crossfades bandlimited content against bandlimited content rather than
    /// mixing two different resamplers.
    ///
    /// Only Forward. PingPong reverses at the seam, so its two sides are the
    /// same samples in opposite order and already continuous; Reverse wraps at
    /// `loop_start`, which this fade does not describe.
    fn apply_loop_crossfade(
        &self,
        sample_data: &SampleData,
        frame: usize,
        fraction: f32,
        left: f32,
        right: f32,
    ) -> (f32, f32) {
        let Some((crossfade_start, span, loop_length)) =
            self.seam_crossfade_window(sample_data.frame_count())
        else {
            return (left, right);
        };
        if frame < crossfade_start as usize || frame >= (crossfade_start + span) as usize {
            return (left, right);
        }

        let offset = frame as u32 - crossfade_start;
        let progress = (offset as f32 / span as f32).clamp(0.0, 1.0);
        let shadow_frame = frame - loop_length as usize;
        let (shadow_left, shadow_right) =
            self.interpolate_stereo(sample_data, shadow_frame, fraction);

        // Linear, not equal-power: the two streams are the same sustained
        // material a loop length apart, so they are highly correlated, and an
        // equal-power fade of correlated signals bulges +3 dB mid-window on
        // every pass. Linear is exact — identical streams sum to the original.
        let gain_shadow = progress;
        let gain_tail = 1.0 - progress;
        (
            left * gain_tail + shadow_left * gain_shadow,
            right * gain_tail + shadow_right * gain_shadow,
        )
    }

    /// The seam fade's `(start_frame, span, loop_length)`, or `None` when this
    /// voice cannot fade: not a Forward loop, zero crossfade, degenerate loop
    /// bounds, or no pre-roll to fade against.
    fn seam_crossfade_window(&self, sample_frames: usize) -> Option<(u32, u32, u32)> {
        if self.loop_mode != LoopMode::Forward || self.loop_crossfade == 0 {
            return None;
        }

        // The seam is wherever `advance_position` wraps, which is the end of
        // the sample when no explicit loop end was authored.
        let loop_end = if self.loop_end > 0 {
            self.loop_end
        } else {
            sample_frames as u32
        };
        if loop_end <= self.loop_start {
            return None;
        }

        let loop_length = loop_end - self.loop_start;
        let preroll = self.loop_start.saturating_sub(self.region_start);
        let span = self.loop_crossfade.min(loop_length).min(preroll);
        if span == 0 {
            return None;
        }
        Some((loop_end - span, span, loop_length))
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
                    let length = end - start;
                    if length <= 0.0 {
                        self.active = false;
                        return;
                    }
                    self.position = start + (self.position - start).rem_euclid(length);
                }
            }

            LoopMode::PingPong => {
                if self.position >= end || self.position <= start {
                    self.has_looped = true;
                    let length = end - start;
                    if length <= 0.0 {
                        self.active = false;
                        return;
                    }
                    let travel = if self.direction > 0.0 {
                        self.position - start
                    } else {
                        end - self.position
                    };
                    let phase = travel.rem_euclid(length * 2.0);
                    if phase <= length {
                        if self.direction > 0.0 {
                            self.position = start + phase;
                            self.direction = 1.0;
                        } else {
                            self.position = end - phase;
                            self.direction = -1.0;
                        }
                    } else if self.direction > 0.0 {
                        self.position = end - (phase - length);
                        self.direction = -1.0;
                    } else {
                        self.position = start + (phase - length);
                        self.direction = 1.0;
                    }
                }
            }

            LoopMode::Reverse => {
                if self.position < start {
                    let length = end - start;
                    if length <= 0.0 {
                        self.active = false;
                        return;
                    }
                    self.position = start + (self.position - start).rem_euclid(length);
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
        if !cents.is_finite() {
            return;
        }
        self.tune_cents = cents;
        let semitone_diff = (self.note as f32 - self.root_note as f32) + self.tune_cents / 100.0;
        self.set_playback_speed(semitone_diff);
    }

    fn set_playback_speed(&mut self, semitone_diff: f32) {
        let Some(speed) = bounded_playback_speed(semitone_diff) else {
            return;
        };
        self.speed = speed;
        self.anti_alias_cutoff = (1.0 / self.speed).min(1.0) as f32;
        let step = core::f32::consts::PI * self.anti_alias_cutoff;
        (self.anti_alias_step_sin, self.anti_alias_step_cos) = step.sin_cos();
        self.anti_alias_taps = bandlimited_tap_count(self.speed);
        let beta = kaiser_beta(self.anti_alias_taps, self.anti_alias_cutoff);
        let key = (self.anti_alias_taps as u16, (beta * 10.0) as u16);
        if key != self.anti_alias_window_key {
            fill_kaiser_window(&mut self.anti_alias_window, self.anti_alias_taps, beta);
            self.anti_alias_window_key = key;
        }
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
        // Everything else is the bottom tier, which no single voice can decide:
        // `find_steal_target` compares `audible_level` across the voices that
        // land here and takes the quietest.
        StealPriority::Oldest
    }

    /// Get the current energy level (for quietest-voice stealing).
    pub fn energy(&self) -> f32 {
        self.energy
    }

    /// How loud this voice is *right now*, as a linear amplitude.
    ///
    /// The three factors that scale every sample this voice writes:
    /// note velocity, the amp envelope's current level, and the smoothed voice
    /// gain. Deliberately not `energy`, which is a one-pole of the *rendered*
    /// signal: that is content-dependent, starts at zero, and takes ~10 ms to
    /// mean anything, so a voice triggered two blocks ago reads as the quietest
    /// in the pool no matter how loud it is about to be.
    ///
    /// No square root: this is only ever compared against other voices, and
    /// ordering is preserved without one.
    pub fn audible_level(&self) -> f32 {
        self.velocity * self.amp_envelope.level() * self.gain_smoother.value()
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

    pub(crate) fn resampling_work_units(&self) -> usize {
        let base = if self.speed > 1.0 {
            bandlimited_work_units(self.anti_alias_taps)
        } else {
            UNITY_RESAMPLING_WORK_UNITS
        };
        // The seam crossfade runs a second interpolated read inside its
        // window, doubling the voice's interpolation cost there. Charge the
        // doubled rate for the whole life of a fading voice rather than
        // tracking the window — the budget's job is to keep the worst block
        // schedulable, and the worst block is the one where every fading
        // voice sits inside its window at once.
        if self.seam_crossfade_possible() {
            base * 2
        } else {
            base
        }
    }

    /// Whether this voice's configuration can ever run the seam crossfade.
    /// Mirrors `seam_crossfade_window` without needing the sample's frame
    /// count: with no explicit `loop_end` the pre-roll bound alone decides,
    /// since the span only shrinks further once real bounds resolve.
    fn seam_crossfade_possible(&self) -> bool {
        self.loop_mode == LoopMode::Forward
            && self.loop_crossfade > 0
            && self.loop_start > self.region_start
            && (self.loop_end == 0 || self.loop_end > self.loop_start)
    }
}

pub(crate) fn resampling_work_units_for_pitch(
    note: u8,
    root_note: u8,
    tune_cents: f32,
    seam_crossfade: bool,
) -> usize {
    let semitone_diff = (note as f32 - root_note as f32) + tune_cents / 100.0;
    let Some(speed) = bounded_playback_speed(semitone_diff) else {
        return UNITY_RESAMPLING_WORK_UNITS;
    };
    let base = if speed > 1.0 {
        bandlimited_work_units(bandlimited_tap_count(speed))
    } else {
        UNITY_RESAMPLING_WORK_UNITS
    };
    if seam_crossfade {
        base * 2
    } else {
        base
    }
}

fn bounded_playback_speed(semitone_diff: f32) -> Option<f64> {
    if !semitone_diff.is_finite() {
        return None;
    }
    Some(
        2.0_f64
            .powf(semitone_diff as f64 / 12.0)
            .clamp(MIN_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED),
    )
}

/// Kernel radius in source frames for a playback speed, as tap count.
///
/// The floor of 24 carries an octave up; beyond that the radius grows four
/// source samples per playback step, which holds the Kaiser window's
/// transition inside the gap between the destination Nyquist and the first
/// foldback frequency the 42 dB stop-band contract covers — at 4x and above
/// it is also what keeps the kernel long enough for beta 7's passband
/// flatness. The radius caps at 80: past that the per-sample loop would break
/// the audio-thread work budget, which is also why the supported pitch range
/// caps at 16x.
fn bandlimited_tap_count(speed: f64) -> usize {
    let grown = 24.0 + 4.0 * (speed - 2.0);
    let radius = grown.ceil().clamp(24.0, 80.0) as usize;
    radius * 2 + 1
}

/// Kaiser beta for the anti-alias window, from the transition budget the
/// kernel radius leaves: `radius * cutoff` source samples span the band the
/// kernel has to roll off in.
///
/// A wide budget carries the sharper window (beta 9), whose passband stays
/// flat enough that a read landing on whole source frames returns them to
/// within 2e-5 — the accuracy chromatic octaves are measured against. A tight
/// budget (the radius clamp binds past 13x speed) cannot afford a wide main
/// lobe and drops to beta 5, which still meets the 42 dB stop-band but gives
/// up passband flatness no measurement at those ratios pins. In between, beta
/// 7 is the widest window that keeps both contracts from 4x up.
fn kaiser_beta(tap_count: usize, cutoff: f32) -> f32 {
    let budget = (tap_count as f64 / 2.0) * f64::from(cutoff);
    if budget >= 10.0 {
        9.0
    } else if budget >= 6.0 {
        7.0
    } else {
        5.0
    }
}

/// Fill `window[..tap_count]` with a Kaiser window of the given beta.
///
/// Runs at note-on, not per sample, so the Bessel series costs nothing in the
/// render loop. Writes a fixed-length array in place — no allocation.
fn fill_kaiser_window(window: &mut [f32; MAX_BANDLIMITED_TAPS], tap_count: usize, beta: f32) {
    let beta = f64::from(beta);
    let radius = (tap_count - 1) as f64 / 2.0;
    let denominator = bessel_i0(beta);
    for (tap, weight) in window.iter_mut().enumerate().take(tap_count) {
        let offset = (tap as f64 - radius) / radius;
        let inside = (1.0 - offset * offset).max(0.0).sqrt();
        *weight = (bessel_i0(beta * inside) / denominator) as f32;
    }
}

/// Modified Bessel function of the first kind, order zero, by power series.
/// Converges within the loop for the beta range above; the early exit keeps
/// the cost bounded at note-on.
fn bessel_i0(x: f64) -> f64 {
    let half = x / 2.0;
    let mut sum = 1.0;
    let mut term = 1.0;
    for k in 1..40 {
        term *= (half / f64::from(k)) * (half / f64::from(k));
        sum += term;
        if term < 1.0e-18 * sum {
            break;
        }
    }
    sum
}

fn bandlimited_work_units(tap_count: usize) -> usize {
    // Longer sinc kernels also raise the surrounding per-voice loop cost.
    // Weight growth above the 49-tap baseline so the engine budget preserves
    // 128 ordinary pitch-up voices without admitting a deadline-breaking
    // number of 161-tap voices.
    tap_count.saturating_add(tap_count.saturating_sub(MIN_BANDLIMITED_TAPS) / 2)
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

/// Minimum odd tap count; higher pitch ratios scale this to at most 161 taps.
const BANDLIMITED_SINC_TAPS: usize = 49;

/// Where a kernel tap reads when its index falls outside the playable region.
///
/// Taps that land in-range wrap for looping voices exactly as the playhead
/// does. A tap past the region's edge reads the odd mirror of an in-region
/// frame about that edge — `2 * x[edge] - x[mirror]` — because a half kernel
/// against dropped taps is not a smaller low-pass: renormalizing its one-sided
/// weight turns the sinc ring's alternating lobes into a forward bias, and a
/// read at the region's first frame lands a fifth of a sample past it. The odd
/// mirror is the extension that preserves the local slope, keeps the ring's
/// cancellation intact, and makes a read centred on the edge exact. When even
/// the mirror falls outside — a region shorter than the kernel — the tap
/// degenerates to the edge frame itself, which holds the DC gain at unity for
/// any region length.
enum MappedTap {
    /// An in-region frame.
    Frame(usize),
    /// Below the region: mirror `2 * region_start - index` about `region_start`.
    MirrorBelow { mirror: i64, edge: usize },
    /// Above a no-loop region: mirror about its last frame.
    MirrorAbove { mirror: i64, edge: usize },
    /// A degenerate region; the tap contributes nothing.
    Nothing,
}

fn bandlimited_stereo_sample(
    sample: &SampleData,
    frame: usize,
    fraction: f32,
    cutoff_scale: f32,
    sinc_step_sin: f32,
    sinc_step_cos: f32,
    tap_count: usize,
    window: &[f32],
    region_start: u32,
    loop_start: u32,
    loop_end: u32,
    loop_mode: LoopMode,
    has_looped: bool,
) -> (f32, f32) {
    let mut output_left = 0.0;
    let mut output_right = 0.0;
    let mut weight_sum = 0.0;
    let radius = (tap_count / 2) as f32;
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

    for tap in 0..tap_count {
        let lowpass = if distance.abs() < f32::EPSILON {
            cutoff_scale
        } else {
            sinc_sin / (core::f32::consts::PI * distance)
        };
        let weight = lowpass * window[tap];
        let raw_index = frame as i64 + tap as i64 - tap_count as i64 / 2;
        let mut tap_left = 0.0;
        let mut tap_right = 0.0;
        let contributes = match map_bandlimited_frame(
            raw_index,
            region_start,
            loop_start,
            region_end,
            loop_mode,
            has_looped,
        ) {
            MappedTap::Frame(index) => {
                tap_left = sample.read_left(index);
                tap_right = if stereo {
                    sample.read_right(index)
                } else {
                    tap_left
                };
                true
            }
            MappedTap::MirrorBelow { mirror, edge } | MappedTap::MirrorAbove { mirror, edge } => {
                let in_region = (region_start as i64..region_end as i64).contains(&mirror);
                tap_left = if in_region {
                    2.0 * sample.read_left(edge) - sample.read_left(mirror as usize)
                } else {
                    sample.read_left(edge)
                };
                tap_right = if stereo {
                    if in_region {
                        2.0 * sample.read_right(edge) - sample.read_right(mirror as usize)
                    } else {
                        sample.read_right(edge)
                    }
                } else {
                    tap_left
                };
                true
            }
            MappedTap::Nothing => false,
        };
        if contributes {
            output_left += tap_left * weight;
            if stereo {
                output_right += tap_right * weight;
            }
            weight_sum += weight;
        }

        let next_sinc_sin = sinc_sin * sinc_step_cos - sinc_cos * sinc_step_sin;
        sinc_cos = sinc_cos * sinc_step_cos + sinc_sin * sinc_step_sin;
        sinc_sin = next_sinc_sin;
        distance -= 1.0;
    }

    let normalization = if weight_sum.abs() > 1.0e-12 {
        1.0 / weight_sum
    } else {
        0.0
    };
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
) -> MappedTap {
    if region_end <= region_start {
        return MappedTap::Nothing;
    }
    let low_edge = region_start as i64;
    let high_edge = region_end as i64 - 1;

    if loop_mode == LoopMode::Off {
        if (low_edge..=high_edge).contains(&index) {
            return MappedTap::Frame(index as usize);
        }
        if index < low_edge {
            return MappedTap::MirrorBelow {
                mirror: 2 * low_edge - index,
                edge: region_start,
            };
        }
        return MappedTap::MirrorAbove {
            mirror: 2 * high_edge - index,
            edge: high_edge as usize,
        };
    }

    if loop_start >= region_end {
        return MappedTap::Nothing;
    }

    if !has_looped && index < low_edge {
        return MappedTap::MirrorBelow {
            mirror: 2 * low_edge - index,
            edge: region_start,
        };
    }
    if !has_looped && index < region_end as i64 {
        return MappedTap::Frame(index as usize);
    }

    let start = loop_start as i64;
    let length = region_end as i64 - start;
    let relative = (index - start).rem_euclid(length);
    if loop_mode != LoopMode::PingPong {
        return MappedTap::Frame((start + relative) as usize);
    }

    let reflected = (index - start).rem_euclid(length * 2);
    if reflected < length {
        MappedTap::Frame((start + reflected) as usize)
    } else {
        MappedTap::Frame((start + length * 2 - reflected - 1) as usize)
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

    #[test]
    fn high_ratio_playback_suppresses_foldback_by_at_least_42_db() {
        let render = |source_frequency: f32, ratio: usize, note: u8, tune_cents: f32| {
            let source_frames = (OUTPUT_SAMPLES + SETTLE_SAMPLES) * ratio + 512;
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
                note,
                root_note: 60,
                playback_mode: PlaybackMode::OneShot,
                ..VoiceTriggerParams::default()
            });
            voice.set_tune(tune_cents);

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
        };

        for (ratio, note, tune_cents) in [(4, 84, 0.0), (8, 96, 0.0), (16, 84, 2_400.0)] {
            let passband = bin_magnitude(
                &render(8_000.0 / ratio as f32, ratio, note, tune_cents),
                8_000.0,
                SAMPLE_RATE,
            );
            let foldback = bin_magnitude(
                &render(32_000.0 / ratio as f32, ratio, note, tune_cents),
                16_000.0,
                SAMPLE_RATE,
            );
            let alias_to_signal_db = 20.0 * (foldback / passband.max(1.0e-12)).log10();

            assert!(passband > 0.1, "{ratio}x passband reference was inaudible");
            assert!(
                alias_to_signal_db <= -42.0,
                "{ratio}x playback must suppress foldback by at least 42 dB, got \
                 {alias_to_signal_db:.1} dB"
            );
        }
    }

    #[test]
    fn pitched_up_reader_preserves_short_region_dc_gain() {
        let sample = SampleData::from_mono(vec![1.0], SAMPLE_RATE as u32);
        let step = core::f32::consts::PI * 0.5;
        let (step_sin, step_cos) = step.sin_cos();
        let mut window = [0.0_f32; MAX_BANDLIMITED_TAPS];
        fill_kaiser_window(&mut window, BANDLIMITED_SINC_TAPS, 9.0);

        let (left, right) = bandlimited_stereo_sample(
            &sample,
            0,
            0.0,
            0.5,
            step_sin,
            step_cos,
            BANDLIMITED_SINC_TAPS,
            &window,
            0,
            0,
            1,
            LoopMode::Off,
            false,
        );

        assert!((left - 1.0).abs() < 1.0e-6, "left DC gain was {left}");
        assert!((right - 1.0).abs() < 1.0e-6, "right DC gain was {right}");
    }

    #[test]
    fn non_finite_tune_preserves_the_last_finite_playback_state() {
        let mut voice = CrumbsVoice::new(SAMPLE_RATE);
        voice.trigger(&VoiceTriggerParams::default());
        voice.set_tune(1_200.0);

        voice.set_tune(f32::NAN);
        voice.set_tune(f32::INFINITY);

        assert_eq!(voice.tune_cents, 1_200.0);
        assert_eq!(voice.speed, 2.0);
        assert!(voice.position.is_finite());
    }

    #[test]
    fn high_speed_loop_overshoot_stays_inside_the_active_region() {
        let sample = SampleData::from_mono(vec![0.25; 64], SAMPLE_RATE as u32);

        for loop_mode in [LoopMode::Forward, LoopMode::PingPong, LoopMode::Reverse] {
            let mut voice = CrumbsVoice::new(SAMPLE_RATE);
            voice.trigger(&VoiceTriggerParams {
                note: 84,
                root_note: 60,
                playback_mode: PlaybackMode::Sustain,
                loop_mode,
                loop_start: 16,
                loop_end: 20,
                start_frame: 16,
                ..VoiceTriggerParams::default()
            });
            voice.set_tune(2_400.0);

            for _ in 0..8 {
                let mut left = 0.0;
                let mut right = 0.0;
                assert!(voice.render_sample(&sample, &mut left, &mut right));
                assert!(left.is_finite() && right.is_finite());
                assert!(
                    (16.0..20.0).contains(&voice.position),
                    "{loop_mode:?} left the loop at position {}",
                    voice.position
                );
            }
        }
    }

    /// The seam crossfade runs a second interpolated read inside its window,
    /// so a crossfade-capable voice must cost double at admission and in live
    /// accounting — otherwise a full pool of fading voices schedules twice the
    /// budgeted interpolation work.
    #[test]
    fn a_crossfade_capable_voice_charges_double_work_units() {
        let trigger = |loop_crossfade| {
            let mut voice = CrumbsVoice::new(SAMPLE_RATE);
            voice.trigger(&VoiceTriggerParams {
                note: 60,
                root_note: 60,
                playback_mode: PlaybackMode::Sustain,
                loop_mode: LoopMode::Forward,
                start_frame: 0,
                loop_start: 512,
                loop_end: 4_096,
                loop_crossfade,
                ..VoiceTriggerParams::default()
            });
            voice
        };

        let plain = trigger(0).resampling_work_units();
        let fading = trigger(256).resampling_work_units();
        assert_eq!(
            fading,
            plain * 2,
            "a Forward loop with a crossfade and pre-roll must cost double"
        );

        // No pre-roll: the fade can never run, so it must not be charged.
        let mut no_preroll_voice = CrumbsVoice::new(SAMPLE_RATE);
        no_preroll_voice.trigger(&VoiceTriggerParams {
            note: 60,
            root_note: 60,
            playback_mode: PlaybackMode::Sustain,
            loop_mode: LoopMode::Forward,
            start_frame: 0,
            loop_start: 0,
            loop_end: 4_096,
            loop_crossfade: 256,
            ..VoiceTriggerParams::default()
        });
        assert_eq!(
            no_preroll_voice.resampling_work_units(),
            plain,
            "a loop without pre-roll never fades and must cost the plain rate"
        );

        // The admission-time estimate must agree with the live accounting.
        assert_eq!(
            resampling_work_units_for_pitch(60, 60, 0.0, true),
            resampling_work_units_for_pitch(60, 60, 0.0, false) * 2,
            "admission must charge the same doubling the live accounting does"
        );
    }
}
