//! Stereo imager — per-band width control, auto mono bass, correlation meter.
//!
//! ## Auto Mono Bass
//!
//! The switch and the per-band widths interact by one rule: **while the
//! switch is engaged it overrides the first band's width below the mono-bass
//! crossover; the width still applies above it and resumes below it the
//! moment the switch is disengaged.**
//!
//! - Engaged, the bass band's side component is scaled by a factor ramping to
//!   exactly 0.0, so low-frequency side content follows the LR-4 lowpass
//!   response down to silence regardless of `img_width0`. The stored width is
//!   never overwritten.
//! - Disengaged, the factor settles at exactly 1.0 and a multiply by 1.0 is
//!   exact, so the audio path is bit-identical to a plain width read.
//! - While engaged, the first crossover *is* the mono-bass frequency:
//!   engaging the switch re-points the low crossover at the stored
//!   `img_mono_bass_freq`, and a frequency write retargets it immediately. A
//!   frequency write while disengaged only stores the value for the next
//!   engage, so both edit orders converge on the same transfer function.
//! - Toggle transitions ramp the factor over the same 5 ms counted-linear
//!   ramp the crossover coefficients use, so the switch never steps a live
//!   signal.

use crate::primitives::flush_denormal_f64;

use super::biquad::COEFF_SMOOTHING_SECONDS;
use super::crossover::FourBandSplitter;

const NUM_BANDS: usize = 4;
const INV_SQRT2: f32 = std::f32::consts::FRAC_1_SQRT_2;

pub struct StereoImager {
    splitter: FourBandSplitter,
    band_width: [f32; NUM_BANDS], // 0.0 = mono, 1.0 = unity, 2.0 = doubled
    crossover_freqs: [f64; 3],
    sample_rate: f64,
    auto_mono_bass: bool,
    mono_bass_freq: f64,
    /// Bass-band side factor: exactly 0.0 while Auto Mono Bass is engaged,
    /// exactly 1.0 while disengaged, ramped between the two on a toggle.
    mono_bass_side: SmoothedFactor,
    bypassed: bool,
    // Correlation meter state
    lr_sum: f64,
    l_sq_sum: f64,
    r_sq_sum: f64,
    corr_alpha: f64,
    meter_correlation: f32,
}

impl StereoImager {
    pub fn new(sr: f64) -> Self {
        let freqs = [120.0, 1000.0, 8000.0];
        // Smoothing for ~300ms window
        let corr_alpha = (-1.0 / (0.3 * sr)).exp();
        Self {
            splitter: FourBandSplitter::new(freqs[0], freqs[1], freqs[2], sr),
            band_width: [0.0, 0.8, 1.0, 1.3], // mono bass, slightly narrow low-mid, unity mid, wider high
            crossover_freqs: freqs,
            sample_rate: sr,
            auto_mono_bass: true,
            mono_bass_freq: 80.0,
            // The default state ships with the switch engaged.
            mono_bass_side: SmoothedFactor::snap(0.0, sr),
            bypassed: false,
            lr_sum: 0.0,
            l_sq_sum: 0.0,
            r_sq_sum: 0.0,
            corr_alpha,
            meter_correlation: 1.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "img_bypass" => self.bypassed = value > 0.5,
            "img_auto_mono_bass" => {
                let on = value > 0.5;
                if on != self.auto_mono_bass {
                    self.auto_mono_bass = on;
                    if on {
                        self.apply_mono_bass_crossover();
                    }
                    // Ramp between passthrough and full suppression so the
                    // switch never steps a live signal.
                    self.mono_bass_side.set_target(if on { 0.0 } else { 1.0 });
                }
            }
            "img_mono_bass_freq" => {
                self.mono_bass_freq = (value as f64).clamp(40.0, 200.0);
                if self.auto_mono_bass {
                    self.apply_mono_bass_crossover();
                }
            }
            _ => {}
        }

        // Per-band width: img_width0..img_width3
        if name.starts_with("img_width") {
            if let Some(idx_char) = name.as_bytes().get(9) {
                let idx = (*idx_char - b'0') as usize;
                if idx < NUM_BANDS {
                    self.band_width[idx] = value.clamp(0.0, 2.0);
                }
            }
        }

        // Crossover: img_xover0..img_xover2
        if name.starts_with("img_xover") {
            if let Some(idx_char) = name.as_bytes().get(9) {
                let idx = (*idx_char - b'0') as usize;
                if idx < 3 {
                    self.crossover_freqs[idx] = (value as f64).clamp(20.0, 20000.0);
                    self.splitter.set_freqs(
                        self.crossover_freqs[0],
                        self.crossover_freqs[1],
                        self.crossover_freqs[2],
                        self.sample_rate,
                    );
                }
            }
        }
    }

    /// Re-point the first crossover at the stored mono-bass frequency. Only
    /// ever called while Auto Mono Bass is engaged: with the switch off, the
    /// low crossover keeps whatever `img_xover0` last set — the flag must not
    /// move filters it is not enforcing, so a frequency write while
    /// disengaged only stores the value for the next engage.
    fn apply_mono_bass_crossover(&mut self) {
        if self.crossover_freqs[0] != self.mono_bass_freq {
            self.crossover_freqs[0] = self.mono_bass_freq;
            self.splitter.set_freqs(
                self.crossover_freqs[0],
                self.crossover_freqs[1],
                self.crossover_freqs[2],
                self.sample_rate,
            );
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            self.update_correlation(left, right);
            return;
        }

        for i in 0..left.len() {
            let mono_bass_side = self.mono_bass_side.next();
            let band_signals = self.splitter.process(left[i], right[i]);
            let mut out_l = 0.0_f32;
            let mut out_r = 0.0_f32;

            for (b_idx, (bl, br)) in band_signals.iter().enumerate() {
                let mut width = self.band_width[b_idx];
                if b_idx == 0 {
                    // Auto Mono Bass overrides the first band's width below
                    // the crossover; settled at exactly 1.0 the multiply is
                    // exact and the disengaged path reads the width unchanged.
                    width *= mono_bass_side;
                }
                let (l, r) = apply_width(*bl, *br, width);
                out_l += l;
                out_r += r;
            }

            left[i] = out_l;
            right[i] = out_r;
        }

        self.update_correlation(left, right);
    }

    fn update_correlation(&mut self, left: &[f32], right: &[f32]) {
        let a = self.corr_alpha;
        for i in 0..left.len() {
            let l = left[i] as f64;
            let r = right[i] as f64;
            // DSP-2: the correlation meter runs every sample even when bypassed,
            // so these leaky sums keep decaying long after the signal stops.
            self.lr_sum = flush_denormal_f64(a * self.lr_sum + (1.0 - a) * l * r);
            self.l_sq_sum = flush_denormal_f64(a * self.l_sq_sum + (1.0 - a) * l * l);
            self.r_sq_sum = flush_denormal_f64(a * self.r_sq_sum + (1.0 - a) * r * r);
        }
        let denom = (self.l_sq_sum * self.r_sq_sum).sqrt();
        self.meter_correlation = if denom < 1e-9 {
            0.0
        } else {
            (self.lr_sum / denom) as f32
        };
    }

    pub fn get_correlation(&self) -> f32 {
        self.meter_correlation
    }
    pub fn is_bypassed(&self) -> bool {
        self.bypassed
    }
}

/// Counted linear ramp for the mono-bass side factor — the scalar twin of
/// `SmoothedBiquadCoeffs`: same ramp length, same exact arrival on a known
/// sample, same restart-from-wherever on a mid-ramp re-target. A one-pole
/// would stall short of the target and leave a low-level bass side residue;
/// the counted ramp lands on exactly 0.0 (suppressed) or exactly 1.0
/// (passthrough), which is what keeps the disengaged path bit-identical to a
/// plain width read.
struct SmoothedFactor {
    current: f32,
    start: f32,
    target: f32,
    remaining: u32,
    ramp_samples: u32,
}

impl SmoothedFactor {
    /// Jump straight to `value` — construction, where there is no continuous
    /// signal to protect.
    fn snap(value: f32, sample_rate: f64) -> Self {
        let ramp_samples = ((COEFF_SMOOTHING_SECONDS * sample_rate.max(1.0)).round() as u32).max(1);
        Self {
            current: value,
            start: value,
            target: value,
            remaining: 0,
            ramp_samples,
        }
    }

    /// Aim at `target`; the ramp runs on subsequent [`Self::next`] calls.
    /// Re-targeting mid-ramp restarts from wherever the ramp currently sits,
    /// so a stream of automation writes stays continuous.
    fn set_target(&mut self, target: f32) {
        self.start = self.current;
        self.target = target;
        self.remaining = self.ramp_samples;
    }

    /// Advance one sample and return the factor to scale the bass side with.
    #[inline]
    fn next(&mut self) -> f32 {
        if self.remaining == 0 {
            return self.current;
        }

        self.remaining -= 1;
        if self.remaining == 0 {
            self.current = self.target;
            return self.current;
        }

        let progress = (1.0 - f64::from(self.remaining) / f64::from(self.ramp_samples)) as f32;
        self.current = self.start + (self.target - self.start) * progress;
        self.current
    }
}

#[inline]
fn apply_width(l: f32, r: f32, width: f32) -> (f32, f32) {
    // Standard M/S width: leave mid unscaled, scale side by `width`.
    // width=0 → pure mono (mid only); width=1 → original; width>1 → widened.
    // The previous formula zeroed the mid channel at width=2, destroying the
    // centre image.
    let m = (l + r) * INV_SQRT2;
    let s = (l - r) * INV_SQRT2;
    let s_scaled = s * width.max(0.0);
    let out_l = (m + s_scaled) * INV_SQRT2;
    let out_r = (m - s_scaled) * INV_SQRT2;
    (out_l, out_r)
}

#[cfg(test)]
mod tests {
    //! Auto Mono Bass. The switch engages a bass-band side factor that
    //! overrides `img_width0` below the mono-bass crossover; these tests pin
    //! the suppression depth against a width-zero positive control, the
    //! untouched pass paths, the width override, edit-order convergence, and
    //! click-free runtime toggling.

    use super::StereoImager;
    use std::f64::consts::TAU;

    const SAMPLE_RATE: f64 = 48_000.0;
    /// Peak amplitude of each stimulus channel.
    const AMPLITUDE: f32 = 0.25;
    const WARMUP_CYCLES: usize = 30;
    const MEASURED_CYCLES: usize = 30;
    /// 40 Hz against the 80 Hz cutoff sits at half the crossover, deep enough
    /// that the LR-4 highpass rejection of the neighbouring band bounds the
    /// surviving side leakage near -24 dB.
    const PROBE_HZ: f64 = 40.0;
    const CUTOFF_HZ: f64 = 80.0;
    /// The crossover tests pin the four-band sum flat within 0.5 dB, so any
    /// pass path this switch must not touch gets 1.0 dB here.
    const PASS_TOLERANCE_DB: f64 = 1.0;
    /// Band-1 leakage through an 80 Hz LR-4 highpass at 40 Hz measures near
    /// -24 dB; -18 dB bounds it without depending on that exact figure.
    const MIN_SUPPRESSION_DB: f64 = 18.0;
    /// Widths all at unity: every band passes unchanged, so any suppression
    /// is the switch's doing alone.
    const UNITY_WIDTHS: [f32; 4] = [1.0, 1.0, 1.0, 1.0];
    /// Input side RMS of `side_stimulus`: the channels are ±s, so the side
    /// signal is s·√2 and its RMS is the stimulus peak amplitude.
    const INPUT_SIDE_RMS: f64 = AMPLITUDE as f64;

    fn samples_per_cycle(freq: f64) -> usize {
        (SAMPLE_RATE / freq).round() as usize
    }

    fn set_widths(imager: &mut StereoImager, widths: [f32; 4]) {
        for (band, width) in widths.into_iter().enumerate() {
            imager.set_param(&format!("img_width{band}"), width);
        }
    }

    /// Configures a fresh imager the way the panel syncs a patch: switch
    /// first, then cutoff, then widths. With the switch disengaged the low
    /// crossover only moves through `img_xover0` — the documented disengaged
    /// behaviour — so the cutoff is routed accordingly.
    fn imager_with(mono_bass: bool, cutoff_hz: f64, widths: [f32; 4]) -> StereoImager {
        let mut imager = StereoImager::new(SAMPLE_RATE);
        imager.set_param("img_auto_mono_bass", if mono_bass { 1.0 } else { 0.0 });
        if mono_bass {
            imager.set_param("img_mono_bass_freq", cutoff_hz as f32);
        } else {
            imager.set_param("img_xover0", cutoff_hz as f32);
        }
        set_widths(&mut imager, widths);
        imager
    }

    /// Pure side stimulus: equal and opposite channels, mid exactly zero.
    fn side_stimulus(freq: f64, sample: usize) -> (f32, f32) {
        let phase = TAU * freq * sample as f64 / SAMPLE_RATE;
        let s = AMPLITUDE * phase.sin() as f32;
        (s, -s)
    }

    /// Correlated stimulus: identical channels, pure mid.
    fn mono_stimulus(freq: f64, sample: usize) -> (f32, f32) {
        let phase = TAU * freq * sample as f64 / SAMPLE_RATE;
        let s = AMPLITUDE * phase.sin() as f32;
        (s, s)
    }

    fn step(
        imager: &mut StereoImager,
        stimulus: &dyn Fn(usize) -> (f32, f32),
        sample: usize,
    ) -> (f32, f32) {
        let (l, r) = stimulus(sample);
        let mut left = [l];
        let mut right = [r];
        imager.process(&mut left, &mut right);
        (left[0], right[0])
    }

    /// Runs `WARMUP_CYCLES` whole cycles to settle the filters, then returns
    /// the output of exactly `MEASURED_CYCLES` whole cycles. Whole cycles keep
    /// the RMS clean, and the shared phase grid lets tests compare outputs
    /// bit for bit across configurations.
    fn render_cycles(
        imager: &mut StereoImager,
        stimulus: &dyn Fn(usize) -> (f32, f32),
        freq: f64,
    ) -> Vec<(f32, f32)> {
        let cycle = samples_per_cycle(freq);
        for sample in 0..WARMUP_CYCLES * cycle {
            step(imager, stimulus, sample);
        }
        (WARMUP_CYCLES * cycle..(WARMUP_CYCLES + MEASURED_CYCLES) * cycle)
            .map(|sample| step(imager, stimulus, sample))
            .collect()
    }

    fn side_rms(rendered: &[(f32, f32)]) -> f64 {
        let inv_sqrt2 = std::f32::consts::FRAC_1_SQRT_2 as f64;
        let sum_sq: f64 = rendered
            .iter()
            .map(|&(l, r)| {
                let side = (l - r) as f64 * inv_sqrt2;
                side * side
            })
            .sum();
        (sum_sq / rendered.len() as f64).sqrt()
    }

    fn rms_db(reference: f64, measured: f64) -> f64 {
        20.0 * (measured / reference).log10()
    }

    #[test]
    fn engaged_switch_suppresses_low_side_at_least_as_deeply_as_width_zero() {
        let stimulus = |sample: usize| side_stimulus(PROBE_HZ, sample);

        let mut disengaged = imager_with(false, CUTOFF_HZ, UNITY_WIDTHS);
        let disengaged_rms = side_rms(&render_cycles(&mut disengaged, &stimulus, PROBE_HZ));

        let mut engaged = imager_with(true, CUTOFF_HZ, UNITY_WIDTHS);
        let engaged_rms = side_rms(&render_cycles(&mut engaged, &stimulus, PROBE_HZ));

        // Positive control: the same mechanism without the switch — band 0
        // width zero at the same crossover — must not suppress less.
        let mut width_zero = imager_with(false, CUTOFF_HZ, [0.0, 1.0, 1.0, 1.0]);
        let control_rms = side_rms(&render_cycles(&mut width_zero, &stimulus, PROBE_HZ));

        let pass_error_db = rms_db(INPUT_SIDE_RMS, disengaged_rms);
        let suppression_db = rms_db(disengaged_rms, engaged_rms);
        eprintln!(
            "40 Hz side RMS: disengaged={disengaged_rms:.6} ({pass_error_db:+.3} dB), \
             engaged={engaged_rms:.6} ({suppression_db:.2} dB), \
             width-zero control={control_rms:.6}"
        );

        assert!(
            pass_error_db.abs() <= PASS_TOLERANCE_DB,
            "disengaged switch must leave the 40 Hz side tone alone, \
             moved {pass_error_db:.3} dB"
        );
        assert!(
            suppression_db <= -MIN_SUPPRESSION_DB,
            "engaged switch must suppress the 40 Hz side tone by at least \
             {MIN_SUPPRESSION_DB} dB, measured {suppression_db:.2} dB"
        );
        assert!(
            engaged_rms <= control_rms * 1.000_001,
            "engaged switch ({engaged_rms:.6}) must suppress at least as \
             deeply as the width-zero control ({control_rms:.6})"
        );
    }

    #[test]
    fn engaged_switch_leaves_mid_side_and_mono_bass_content_intact() {
        // 400 Hz side content sits a decade above the cutoff: the crossover
        // must be respected and the side must pass with widths at unity.
        let mid_stimulus = |sample: usize| side_stimulus(400.0, sample);

        let mut disengaged = imager_with(false, CUTOFF_HZ, UNITY_WIDTHS);
        let disengaged_rms = side_rms(&render_cycles(&mut disengaged, &mid_stimulus, 400.0));

        let mut engaged = imager_with(true, CUTOFF_HZ, UNITY_WIDTHS);
        let engaged_rms = side_rms(&render_cycles(&mut engaged, &mid_stimulus, 400.0));

        let pass_db = rms_db(disengaged_rms, engaged_rms);
        eprintln!("400 Hz side pass with the switch engaged: {pass_db:+.3} dB");
        assert!(
            pass_db.abs() <= PASS_TOLERANCE_DB,
            "400 Hz side content must pass with the switch engaged, \
             moved {pass_db:.3} dB"
        );

        // Mono bass itself rides the mid channel, which neither a width nor
        // the switch ever scales: a correlated 40 Hz tone must pass.
        let mono_tone = |sample: usize| mono_stimulus(PROBE_HZ, sample);
        let mut engaged_mono = imager_with(true, CUTOFF_HZ, UNITY_WIDTHS);
        let mono_rendered = render_cycles(&mut engaged_mono, &mono_tone, PROBE_HZ);
        let channel_rms = f64::from(AMPLITUDE) / std::f64::consts::SQRT_2;
        let mono_l_rms = {
            let sum_sq: f64 = mono_rendered
                .iter()
                .map(|&(l, _)| (l as f64) * (l as f64))
                .sum();
            (sum_sq / mono_rendered.len() as f64).sqrt()
        };
        let mono_error_db = rms_db(channel_rms, mono_l_rms);
        eprintln!("40 Hz mono pass with the switch engaged: {mono_error_db:+.3} dB");
        assert!(
            mono_error_db.abs() <= PASS_TOLERANCE_DB,
            "correlated 40 Hz content must pass with the switch engaged, \
             moved {mono_error_db:.3} dB"
        );
    }

    /// The interaction pin: engaged, the switch overrides the first band's
    /// width below the crossover. Widths 0.5 and 1.0 must render the bass
    /// band identically — the stored width stays untouched for the moment the
    /// switch is disengaged, but below the cutoff it has no say.
    #[test]
    fn engaged_switch_overrides_first_band_width_below_the_crossover() {
        let stimulus = |sample: usize| side_stimulus(PROBE_HZ, sample);

        let mut width_half = imager_with(true, CUTOFF_HZ, [0.5, 1.0, 1.0, 1.0]);
        let half_rendered = render_cycles(&mut width_half, &stimulus, PROBE_HZ);

        let mut width_unity = imager_with(true, CUTOFF_HZ, UNITY_WIDTHS);
        let unity_rendered = render_cycles(&mut width_unity, &stimulus, PROBE_HZ);

        assert_eq!(half_rendered.len(), unity_rendered.len());
        for (index, (half, unity)) in half_rendered.iter().zip(&unity_rendered).enumerate() {
            assert_eq!(
                half.0.to_bits(),
                unity.0.to_bits(),
                "left sample {index}: first-band width changed the bass-band transfer"
            );
            assert_eq!(
                half.1.to_bits(),
                unity.1.to_bits(),
                "right sample {index}: first-band width changed the bass-band transfer"
            );
        }
    }

    /// Switch and cutoff writes must converge on one transfer function
    /// however they interleave: engaging the switch applies the stored
    /// frequency, a frequency write while engaged applies immediately, and
    /// disengaging moves neither. Cutoff-then-switch, switch-then-cutoff, and
    /// a full off/on cycle around the cutoff must render bit-identically.
    #[test]
    fn switch_and_cutoff_writes_converge_regardless_of_edit_order() {
        let stimulus = |sample: usize| side_stimulus(PROBE_HZ, sample);

        // Cutoff written while disengaged (stored, no retarget), then the
        // switch engaged (applies the stored cutoff).
        let mut cutoff_first = imager_with(false, CUTOFF_HZ, UNITY_WIDTHS);
        cutoff_first.set_param("img_mono_bass_freq", 100.0);
        cutoff_first.set_param("img_auto_mono_bass", 1.0);

        // Switch engaged first, cutoff written after (applies immediately).
        let mut switch_first = imager_with(true, CUTOFF_HZ, UNITY_WIDTHS);
        switch_first.set_param("img_mono_bass_freq", 100.0);

        // A full off/on cycle around the cutoff write.
        let mut toggled_around = imager_with(true, CUTOFF_HZ, UNITY_WIDTHS);
        toggled_around.set_param("img_auto_mono_bass", 0.0);
        toggled_around.set_param("img_mono_bass_freq", 100.0);
        toggled_around.set_param("img_auto_mono_bass", 1.0);

        let rendered: Vec<Vec<(f32, f32)>> =
            [&mut cutoff_first, &mut switch_first, &mut toggled_around]
                .into_iter()
                .map(|imager| render_cycles(imager, &stimulus, PROBE_HZ))
                .collect();

        let first = &rendered[0];
        for (route, window) in rendered.iter().enumerate().skip(1) {
            assert_eq!(first.len(), window.len(), "route {route} length");
            for (index, (a, b)) in first.iter().zip(window).enumerate() {
                assert_eq!(
                    a.0.to_bits(),
                    b.0.to_bits(),
                    "route {route} left sample {index}"
                );
                assert_eq!(
                    a.1.to_bits(),
                    b.1.to_bits(),
                    "route {route} right sample {index}"
                );
            }
        }
    }

    /// Engaging the switch mid-stream must land exactly where a persistently
    /// engaged switch sits. Before the toggle the signal is bit-identical to
    /// the persistently disengaged configuration — the flag-off guarantee —
    /// the ramp stays finite and inside the tone envelope, and afterwards the
    /// signal is bit-identical to the persistently engaged one.
    #[test]
    fn runtime_toggle_settles_on_the_persistent_signal() {
        let cycle = samples_per_cycle(PROBE_HZ);
        let stimulus = |sample: usize| side_stimulus(PROBE_HZ, sample);

        let mut always_off = imager_with(false, CUTOFF_HZ, UNITY_WIDTHS);
        let mut always_on = imager_with(true, CUTOFF_HZ, UNITY_WIDTHS);
        let mut toggled = imager_with(false, CUTOFF_HZ, UNITY_WIDTHS);

        let disengaged_end = (WARMUP_CYCLES + MEASURED_CYCLES) * cycle;
        let mut disengaged_window = Vec::with_capacity(MEASURED_CYCLES * cycle);
        let mut reference_off_window = Vec::with_capacity(MEASURED_CYCLES * cycle);
        for sample in 0..disengaged_end {
            let off_sample = step(&mut always_off, &stimulus, sample);
            step(&mut always_on, &stimulus, sample);
            let toggled_sample = step(&mut toggled, &stimulus, sample);
            if sample >= WARMUP_CYCLES * cycle {
                disengaged_window.push(toggled_sample);
                reference_off_window.push(off_sample);
            }
        }
        for (index, (toggled_sample, off_sample)) in disengaged_window
            .iter()
            .zip(&reference_off_window)
            .enumerate()
        {
            assert_eq!(
                toggled_sample.0.to_bits(),
                off_sample.0.to_bits(),
                "pre-toggle left sample {index}"
            );
            assert_eq!(
                toggled_sample.1.to_bits(),
                off_sample.1.to_bits(),
                "pre-toggle right sample {index}"
            );
        }

        toggled.set_param("img_auto_mono_bass", 1.0);
        let ramp_samples = (super::COEFF_SMOOTHING_SECONDS * SAMPLE_RATE).round() as usize;

        let mut envelope_peak = 0.0_f32;
        for &(l, r) in &disengaged_window {
            envelope_peak = envelope_peak.max(l.abs()).max(r.abs());
        }

        let mut engaged_window = Vec::with_capacity(MEASURED_CYCLES * cycle);
        let mut reference_on_window = Vec::with_capacity(MEASURED_CYCLES * cycle);
        for offset in 0..ramp_samples + MEASURED_CYCLES * cycle {
            let sample = disengaged_end + offset;
            let toggled_sample = step(&mut toggled, &stimulus, sample);
            assert!(
                toggled_sample.0.is_finite() && toggled_sample.1.is_finite(),
                "toggle ramp produced a non-finite sample at offset {offset}"
            );
            assert!(
                toggled_sample.0.abs() <= envelope_peak * 1.1
                    && toggled_sample.1.abs() <= envelope_peak * 1.1,
                "toggle ramp exceeded the tone envelope at offset {offset}: \
                 {toggled_sample:?} against peak {envelope_peak}"
            );
            let on_sample = step(&mut always_on, &stimulus, sample);
            if offset >= ramp_samples {
                engaged_window.push(toggled_sample);
                reference_on_window.push(on_sample);
            }
        }
        for (index, (toggled_sample, on_sample)) in
            engaged_window.iter().zip(&reference_on_window).enumerate()
        {
            assert_eq!(
                toggled_sample.0.to_bits(),
                on_sample.0.to_bits(),
                "post-toggle left sample {index}"
            );
            assert_eq!(
                toggled_sample.1.to_bits(),
                on_sample.1.to_bits(),
                "post-toggle right sample {index}"
            );
        }
    }
}
