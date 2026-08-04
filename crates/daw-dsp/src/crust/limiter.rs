//! Crust's look-ahead true-peak limiter core.
//!
//! ## Standard followed
//!
//! The ceiling is advertised in **dBTP**, so the gain computer is fed the
//! inter-sample (true) peak, not the sample magnitude. The reconstruction is
//! the one **ITU-R BS.1770-4, Annex 2** specifies for true-peak measurement —
//! 4x over-sampling through the recommendation's 48-tap polyphase FIR — reused
//! verbatim from [`crate::proof::true_peak::TruePeakUpsampler`] so the number
//! the meter reports and the number the limiter enforces come from one filter.
//! **EBU Tech 3341 §2** ("True Peak level meter") is the practical reading of
//! the same requirement, and **EBU R 128 §5** is where the −1 dBTP delivery
//! ceiling the panel's streaming targets use comes from.
//!
//! The detector takes `max(sample peak, reconstructed peak)` because the 4x
//! reconstruction can read marginally *below* the sample it was built from;
//! BS.1770-4 §2 defines true peak as the maximum of the reconstructed waveform,
//! and a sample is a point on that waveform.
//!
//! ## Why the ceiling actually holds
//!
//! This is the part that has to be argued rather than hoped for, because a
//! look-ahead limiter with a non-zero attack is very easy to build so that it
//! overshoots. Write `D` for the look-ahead in samples, `G` for the detector's
//! group delay (6 base-rate samples for the BS.1770 filter, 0 when true-peak
//! detection is off), and `W` for the peak-window length.
//!
//! At step `n` the detector output `tp[n]` describes the continuous waveform
//! around `n - G`, so a window of the last `W` detector outputs describes the
//! waveform over `[n - W + 1 - G, n - G]`. The sample leaving the delay line at
//! step `n` is `x[n - D]`. For the window to cover it:
//!
//! * `D >= G` — the detector must not lag the delay line, and
//! * `W >= D - G + 1`.
//!
//! [`TruePeakLimiter`] sets `W = D - G + 1` exactly (the smallest window that
//! covers the emerging sample; a longer one would only hold gain down after the
//! peak has passed) and clamps `D` up to `G`.
//!
//! A peak at waveform position `p` enters the window at step `p + G` and its
//! sample emerges at step `p + D`, so the gain has exactly `D - G` samples to
//! reach its target. The attack is therefore a **linear** ramp of
//! `1 / attack_samples` per sample with `attack_samples <= D - G`: after
//! `D - G` steps the gain has fallen by at least 1.0, which spans the entire
//! reachable gain range `[0, 1]`, so the target is reached *before* the peak
//! emerges — not merely approached, as a one-pole would. The release branch is
//! a convex combination of the current gain and the target, so it can never
//! exceed the target either. The applied gain therefore satisfies
//! `g[n] <= ceiling / peak(x[n - D])` at every step.

use crate::proof::true_peak::TruePeakUpsampler;

/// Group delay of the BS.1770-4 4x reconstruction, in base-rate samples.
pub const TRUE_PEAK_GROUP_DELAY: usize = 6;

/// Longest look-ahead the panel can ask for (10 ms) at the highest sample rate
/// the engine is built for (192 kHz), plus headroom for the ring's spare slot.
pub const MAX_LOOKAHEAD_SAMPLES: usize = 2_048;

/// Running maximum over a sliding window, in amortised O(1) per sample.
///
/// A monotonic deque held in a fixed ring: candidates are pushed once and
/// removed once, so no per-sample allocation and no scan of the window.
struct PeakWindow {
    index: Vec<usize>,
    value: Vec<f32>,
    head: usize,
    len: usize,
    next_index: usize,
    window_start: usize,
}

impl PeakWindow {
    fn new(capacity: usize) -> Self {
        Self {
            index: vec![0; capacity],
            value: vec![0.0; capacity],
            head: 0,
            len: 0,
            next_index: 0,
            window_start: 0,
        }
    }

    fn capacity(&self) -> usize {
        self.value.len()
    }

    fn clear(&mut self) {
        self.head = 0;
        self.len = 0;
        self.next_index = 0;
        self.window_start = 0;
    }

    #[inline]
    fn slot(&self, offset: usize) -> usize {
        (self.head + offset) % self.capacity()
    }

    #[inline]
    fn push(&mut self, peak: f32) {
        let index = self.next_index;
        self.next_index = self.next_index.wrapping_add(1);

        while self.len > 0 {
            let back = self.slot(self.len - 1);
            if self.value[back] > peak {
                break;
            }
            self.len -= 1;
        }

        if self.len < self.capacity() {
            let back = self.slot(self.len);
            self.index[back] = index;
            self.value[back] = peak;
            self.len += 1;
        }
    }

    #[inline]
    fn max(&self) -> f32 {
        if self.len == 0 {
            return 0.0;
        }
        self.value[self.head]
    }

    #[inline]
    fn advance(&mut self) {
        if self.len > 0 && self.index[self.head] == self.window_start {
            self.head = self.slot(1);
            self.len -= 1;
        }
        self.window_start = self.window_start.wrapping_add(1);
    }
}

/// One-pole coefficient for a time constant in milliseconds.
fn release_coeff(ms: f32, sample_rate: f32) -> f32 {
    if ms <= 0.0 {
        return 0.0;
    }
    (-1.0 / (ms * 0.001 * sample_rate)).exp()
}

/// The transient branch of the automatic release. Derived from the nominal
/// setting rather than fixed, so an isolated peak always recovers about eight
/// times faster than whatever release is dialled in. Floored at 5 ms, below
/// which the branch tracks the waveform of low-frequency material rather than
/// its envelope.
fn fast_release_ms(nominal_ms: f32) -> f32 {
    (nominal_ms * 0.12).max(5.0)
}

/// How far below its running average the applied gain must sit before any of
/// the fast release is blended in, as a fraction of the average. Sustained
/// low-frequency limiting ripples the gain at the tone frequency and dips under
/// its own average every cycle; those dips are shallow where an isolated
/// transient's are deep.
const TRANSIENT_DEADBAND: f32 = 0.05;

/// Time constant of the running gain average that separates "isolated
/// transient" from "sustained limiting".
const GAIN_AVERAGE_MS: f32 = 250.0;

/// Per-channel gain state.
#[derive(Clone, Copy)]
struct ChannelState {
    gain: f32,
    gain_average: f32,
}

impl ChannelState {
    fn new() -> Self {
        Self {
            gain: 1.0,
            gain_average: 1.0,
        }
    }
}

/// Coefficients the per-sample gain update needs, lifted out of `&self` so the
/// update can take `&mut ChannelState` without borrowing the whole limiter.
#[derive(Clone, Copy)]
struct GainUpdate {
    attack_samples: usize,
    release_slow: f32,
    release_fast: f32,
    release_auto: bool,
    average_coeff: f32,
}

impl GainUpdate {
    /// Program-dependent release coefficient.
    ///
    /// `gain_average` trails the applied gain. Right after an isolated
    /// transient the applied gain sits far below it, so the release blends
    /// toward the fast branch and the sustained material underneath — which was
    /// never over the ceiling — gets its level back. Under sustained limiting
    /// the average descends to meet the applied gain, the gap collapses, and
    /// the nominal release takes over so the envelope is not tracked into
    /// distortion.
    #[inline]
    fn release_coefficient(&self, state: &ChannelState) -> f32 {
        if !self.release_auto {
            return self.release_slow;
        }
        let transient = if state.gain_average > 1e-6 {
            let gap = ((state.gain_average - state.gain) / state.gain_average).clamp(0.0, 1.0);
            ((gap - TRANSIENT_DEADBAND) / (1.0 - TRANSIENT_DEADBAND))
                .clamp(0.0, 1.0)
                .sqrt()
        } else {
            0.0
        };
        self.release_slow + (self.release_fast - self.release_slow) * transient
    }

    #[inline]
    fn advance(&self, state: &mut ChannelState, target: f32) -> f32 {
        if target < state.gain {
            if self.attack_samples == 0 {
                state.gain = target;
            } else {
                let step = 1.0 / self.attack_samples as f32;
                state.gain = (state.gain - step).max(target);
            }
        } else {
            let coefficient = self.release_coefficient(state);
            state.gain = coefficient * state.gain + (1.0 - coefficient) * target;
        }
        state.gain_average =
            self.average_coeff * state.gain_average + (1.0 - self.average_coeff) * state.gain;
        state.gain
    }
}

/// Stereo look-ahead true-peak limiter.
pub struct TruePeakLimiter {
    delay_left: Vec<f32>,
    delay_right: Vec<f32>,
    write: usize,
    upsampler_left: TruePeakUpsampler,
    upsampler_right: TruePeakUpsampler,
    window_left: PeakWindow,
    window_right: PeakWindow,
    /// Samples currently held in the peak windows, saturating at the window
    /// length. A raw sample counter would wrap on `wasm32`'s 32-bit `usize`
    /// after about a day of continuous audio and stop retiring slots.
    window_filled: usize,
    left: ChannelState,
    right: ChannelState,

    sample_rate: f32,
    ceiling: f32,
    lookahead_samples: usize,
    true_peak: bool,
    attack_samples: usize,
    release_ms: f32,
    release_auto: bool,
    release_coeff_slow: f32,
    release_coeff_fast: f32,
    gain_average_coeff: f32,
    link_transient: f32,
    link_release: f32,

    /// Deepest gain reduction applied since the last meter read, in dB
    /// (negative).
    meter_gr_db: f32,
}

impl TruePeakLimiter {
    pub fn new(sample_rate: f32) -> Self {
        let capacity = MAX_LOOKAHEAD_SAMPLES + 1;
        let mut limiter = Self {
            delay_left: vec![0.0; capacity],
            delay_right: vec![0.0; capacity],
            write: 0,
            upsampler_left: TruePeakUpsampler::new(),
            upsampler_right: TruePeakUpsampler::new(),
            window_left: PeakWindow::new(capacity + 1),
            window_right: PeakWindow::new(capacity + 1),
            window_filled: 0,
            left: ChannelState::new(),
            right: ChannelState::new(),
            sample_rate,
            ceiling: 10.0_f32.powf(-0.3 / 20.0),
            lookahead_samples: TRUE_PEAK_GROUP_DELAY,
            true_peak: true,
            attack_samples: 0,
            release_ms: 150.0,
            release_auto: true,
            release_coeff_slow: release_coeff(150.0, sample_rate),
            release_coeff_fast: release_coeff(fast_release_ms(150.0), sample_rate),
            gain_average_coeff: release_coeff(GAIN_AVERAGE_MS, sample_rate),
            link_transient: 1.0,
            link_release: 1.0,
            meter_gr_db: 0.0,
        };
        limiter.reset();
        limiter
    }

    pub fn reset(&mut self) {
        self.delay_left.fill(0.0);
        self.delay_right.fill(0.0);
        self.write = 0;
        self.upsampler_left.reset();
        self.upsampler_right.reset();
        self.window_left.clear();
        self.window_right.clear();
        self.window_filled = 0;
        self.left = ChannelState::new();
        self.right = ChannelState::new();
        self.meter_gr_db = 0.0;
    }

    /// Detector group delay for the current detection mode.
    fn group_delay(&self) -> usize {
        if self.true_peak {
            TRUE_PEAK_GROUP_DELAY
        } else {
            0
        }
    }

    /// Window length that covers exactly the sample leaving the delay line.
    fn window_length(&self) -> usize {
        self.lookahead_samples - self.group_delay() + 1
    }

    pub fn set_ceiling_db(&mut self, ceiling_db: f32) {
        self.ceiling = 10.0_f32.powf(ceiling_db.clamp(-24.0, 0.0) / 20.0);
    }

    pub fn ceiling(&self) -> f32 {
        self.ceiling
    }

    /// Set the look-ahead in milliseconds.
    ///
    /// The request is raised to the detector's group delay when true-peak
    /// detection is on: a shorter delay than the detector's own latency cannot
    /// be limited to a true-peak ceiling at all, and reporting the request
    /// rather than the delay actually imposed would be a latency lie. At the
    /// 6-sample floor this costs 0.125 ms at 48 kHz.
    pub fn set_lookahead_ms(&mut self, lookahead_ms: f32) {
        let requested = (lookahead_ms.clamp(0.0, 10.0) * 0.001 * self.sample_rate).round() as usize;
        let clamped = requested
            .max(self.group_delay())
            .min(MAX_LOOKAHEAD_SAMPLES);
        if clamped == self.lookahead_samples {
            return;
        }
        self.lookahead_samples = clamped;
        self.clamp_attack();
        self.reset();
    }

    /// Set the look-ahead directly in samples.
    ///
    /// The engine's safety stage sizes itself off the detector's filter length
    /// rather than off a musical time, so it needs a sample-domain setter; the
    /// millisecond one would quantise a handful of samples to zero.
    pub fn set_lookahead_samples(&mut self, samples: usize) {
        let clamped = samples.max(self.group_delay()).min(MAX_LOOKAHEAD_SAMPLES);
        if clamped == self.lookahead_samples {
            return;
        }
        self.lookahead_samples = clamped;
        self.clamp_attack();
        self.reset();
    }

    pub fn set_true_peak(&mut self, enabled: bool) {
        if enabled == self.true_peak {
            return;
        }
        self.true_peak = enabled;
        if self.lookahead_samples < self.group_delay() {
            self.lookahead_samples = self.group_delay();
        }
        self.clamp_attack();
        self.reset();
    }

    /// Set the attack in milliseconds.
    ///
    /// Clamped to the ramp budget `D - G`: a longer ramp could not finish
    /// before the peak it is reacting to emerges from the delay line, and the
    /// ceiling would be breached. The clamp is what makes the attack control
    /// safe to expose at all.
    pub fn set_attack_ms(&mut self, attack_ms: f32) {
        self.attack_samples = (attack_ms.max(0.0) * 0.001 * self.sample_rate).round() as usize;
        self.clamp_attack();
    }

    fn clamp_attack(&mut self) {
        let budget = self.lookahead_samples.saturating_sub(self.group_delay());
        if self.attack_samples > budget {
            self.attack_samples = budget;
        }
    }

    pub fn attack_samples(&self) -> usize {
        self.attack_samples
    }

    pub fn set_release_ms(&mut self, release_ms: f32) {
        let ms = release_ms.clamp(1.0, 1_000.0);
        self.release_ms = ms;
        self.release_coeff_slow = release_coeff(ms, self.sample_rate);
        self.release_coeff_fast = release_coeff(fast_release_ms(ms), self.sample_rate);
    }

    pub fn set_release_auto(&mut self, auto: bool) {
        self.release_auto = auto;
    }

    pub fn set_link(&mut self, transient: f32, release: f32) {
        self.link_transient = transient.clamp(0.0, 1.0);
        self.link_release = release.clamp(0.0, 1.0);
    }

    /// Delay imposed on the audio path, in samples. This is the number the host
    /// is told to compensate, and it is the *only* delay this stage adds.
    pub fn latency_samples(&self) -> usize {
        self.lookahead_samples
    }

    /// Deepest gain reduction seen since [`Self::take_gr_db`] was last called.
    pub fn take_gr_db(&mut self) -> f32 {
        let value = self.meter_gr_db;
        self.meter_gr_db = 0.0;
        value
    }

    #[inline]
    fn detect(&mut self, left: f32, right: f32) -> (f32, f32) {
        if !self.true_peak {
            return (left.abs(), right.abs());
        }
        let reconstructed_left = self.upsampler_left.push_max_abs(left);
        let reconstructed_right = self.upsampler_right.push_max_abs(right);
        (
            left.abs().max(reconstructed_left),
            right.abs().max(reconstructed_right),
        )
    }

    #[inline]
    fn required_gain(&self, peak: f32) -> f32 {
        if peak > self.ceiling {
            self.ceiling / peak
        } else {
            1.0
        }
    }

    #[inline]
    fn gain_update(&self) -> GainUpdate {
        GainUpdate {
            attack_samples: self.attack_samples,
            release_slow: self.release_coeff_slow,
            release_fast: self.release_coeff_fast,
            release_auto: self.release_auto,
            average_coeff: self.gain_average_coeff,
        }
    }

    /// Limit one stereo sample, returning the delayed and gain-reduced pair.
    #[inline]
    pub fn process_sample(&mut self, left: f32, right: f32) -> (f32, f32) {
        self.process_sample_detected(left, right, left, right)
    }

    /// Limit one stereo sample against a separate detector signal.
    ///
    /// The sidechain high-pass filters the detector, not the audio, so bass
    /// stops driving the gain computer. That deliberately lets low-frequency
    /// content through above the ceiling, which is why the engine follows a
    /// filtered stage with an unfiltered wideband one.
    #[inline]
    pub fn process_sample_detected(
        &mut self,
        left: f32,
        right: f32,
        detector_left: f32,
        detector_right: f32,
    ) -> (f32, f32) {
        let capacity = self.delay_left.len();
        self.delay_left[self.write] = left;
        self.delay_right[self.write] = right;
        let read = (self.write + capacity - self.lookahead_samples) % capacity;
        let delayed_left = self.delay_left[read];
        let delayed_right = self.delay_right[read];
        self.write = (self.write + 1) % capacity;

        // Retire the oldest window slot *before* pushing this sample's peak, so
        // the window read below spans exactly `window_length` entries. Retiring
        // after the read would let the window run one sample long, which holds
        // gain down past the peak; retiring earlier would drop a peak the
        // emerging sample still has to be protected from.
        let length = self.window_length();
        if self.window_filled < length {
            self.window_filled += 1;
        } else {
            self.window_left.advance();
            self.window_right.advance();
        }

        let (peak_left, peak_right) = self.detect(detector_left, detector_right);
        self.window_left.push(peak_left);
        self.window_right.push(peak_right);
        let window_left_max = self.window_left.max();
        let window_right_max = self.window_right.max();

        let required_left = self.required_gain(window_left_max);
        let required_right = self.required_gain(window_right_max);
        let linked = required_left.min(required_right);

        // Direction decides which link control applies: a transient link of 0
        // lets one channel duck alone on a snare hit, while a release link of
        // 100 keeps the two recovering together so the image does not wander.
        let target_left = if required_left < self.left.gain {
            required_left + (linked - required_left) * self.link_transient
        } else {
            required_left + (linked - required_left) * self.link_release
        };
        let target_right = if required_right < self.right.gain {
            required_right + (linked - required_right) * self.link_transient
        } else {
            required_right + (linked - required_right) * self.link_release
        };

        let update = self.gain_update();
        let gain_left = update.advance(&mut self.left, target_left);
        let gain_right = update.advance(&mut self.right, target_right);

        let deepest = gain_left.min(gain_right);
        if deepest < 1.0 {
            let gr_db = 20.0 * deepest.max(1e-6).log10();
            if gr_db < self.meter_gr_db {
                self.meter_gr_db = gr_db;
            }
        }

        (delayed_left * gain_left, delayed_right * gain_right)
    }
}

#[cfg(test)]
mod tests {
    use super::{TruePeakLimiter, TRUE_PEAK_GROUP_DELAY};

    const SAMPLE_RATE: f32 = 48_000.0;

    /// The alignment claim, at the one stage that makes it — no safety stage
    /// behind it to hide a mistake.
    ///
    /// An isolated burst on a near-silent bed is the case a look-ahead window
    /// gets wrong: between bursts the required gain is unity, so the gain has to
    /// arrive exactly as the burst leaves the delay line. A window that does not
    /// span `D - G + 1` computes the gain from a peak in the wrong place and the
    /// burst walks straight through at full level. Sustained over-ceiling
    /// material would pass either way, which is why this bed is quiet.
    #[test]
    fn an_isolated_burst_is_limited_at_the_moment_it_leaves_the_delay_line() {
        const BURST_AT: usize = 3_000;
        let ceiling_db = -1.0_f32;
        let ceiling = 10.0_f32.powf(ceiling_db / 20.0);

        let mut limiter = TruePeakLimiter::new(SAMPLE_RATE);
        limiter.set_true_peak(true);
        limiter.set_ceiling_db(ceiling_db);
        limiter.set_lookahead_ms(2.0);
        limiter.set_release_auto(false);
        // A fast release on purpose. With a slow one the gain is still deeply
        // reduced 90 samples after the detector saw the burst, so a misaligned
        // window is masked by inertia rather than caught. At 5 ms the gain is
        // most of the way back before the burst emerges, and only a window that
        // actually holds the peak across the delay keeps the ceiling.
        limiter.set_release_ms(5.0);

        let mut worst = 0.0_f32;
        for n in 0..8_000 {
            let bed = 0.02 * (2.0 * std::f32::consts::PI * 220.0 * n as f32 / SAMPLE_RATE).sin();
            let burst = if (BURST_AT..BURST_AT + 12).contains(&n) {
                3.0
            } else {
                0.0
            };
            let (left, right) = limiter.process_sample(bed + burst, bed + burst);
            worst = worst.max(left.abs()).max(right.abs());
        }

        assert!(
            worst <= ceiling * 1.001,
            "the burst left the delay line at {worst:.4} against a ceiling of {ceiling:.4} — \
             the look-ahead window is not covering the sample it is protecting"
        );
    }

    #[test]
    fn look_ahead_is_raised_to_the_detector_group_delay_when_true_peak_is_on() {
        let mut limiter = TruePeakLimiter::new(SAMPLE_RATE);
        limiter.set_true_peak(true);
        limiter.set_lookahead_ms(0.0);

        assert_eq!(limiter.latency_samples(), TRUE_PEAK_GROUP_DELAY);
    }

    #[test]
    fn sample_peak_mode_can_run_with_no_delay_at_all() {
        let mut limiter = TruePeakLimiter::new(SAMPLE_RATE);
        limiter.set_true_peak(false);
        limiter.set_lookahead_ms(0.0);

        assert_eq!(limiter.latency_samples(), 0);
    }

    /// The attack cannot outrun the ramp budget `D - G`, because a ramp that
    /// finished after the peak emerged would breach the ceiling.
    #[test]
    fn attack_is_clamped_to_the_look_ahead_ramp_budget() {
        let mut limiter = TruePeakLimiter::new(SAMPLE_RATE);
        limiter.set_true_peak(true);
        limiter.set_lookahead_ms(1.0); // 48 samples
        limiter.set_attack_ms(100.0); // would be 4800 samples

        assert_eq!(limiter.attack_samples(), 48 - TRUE_PEAK_GROUP_DELAY);
    }

    /// Shortening the look-ahead must re-clamp an attack that was legal at the
    /// longer setting. Without this the ramp budget silently goes negative.
    #[test]
    fn shortening_the_look_ahead_re_clamps_a_previously_legal_attack() {
        let mut limiter = TruePeakLimiter::new(SAMPLE_RATE);
        limiter.set_lookahead_ms(5.0);
        limiter.set_attack_ms(2.0);
        assert_eq!(limiter.attack_samples(), 96);

        limiter.set_lookahead_ms(1.0);

        assert_eq!(limiter.attack_samples(), 48 - TRUE_PEAK_GROUP_DELAY);
    }
}
