/// Wavetable and Virtual Analog oscillators with anti-aliasing.

const TABLE_SIZE: usize = 2048;
const NUM_TABLES: usize = 10; // Mip-map levels for band-limiting

/// Pre-computed wavetable with mip-mapped octave bands.
/// Each level has fewer harmonics to prevent aliasing at high frequencies.
pub struct Wavetable {
    tables: Vec<[f32; TABLE_SIZE]>,
    num_levels: usize,
}

impl Wavetable {
    /// Generate a band-limited wavetable from a harmonic recipe.
    /// `harmonics` is a function mapping harmonic number (1-based) to amplitude.
    pub fn from_harmonics(harmonics: impl Fn(usize) -> f32) -> Self {
        let mut tables = Vec::with_capacity(NUM_TABLES);

        for level in 0..NUM_TABLES {
            let mut table = [0.0f32; TABLE_SIZE];
            // Each level halves the max harmonic count
            let max_harmonics = (TABLE_SIZE / 2) >> level;

            for h in 1..=max_harmonics {
                let amp = harmonics(h);
                if amp.abs() < 1e-8 {
                    continue;
                }
                for i in 0..TABLE_SIZE {
                    let phase = std::f32::consts::TAU * (i as f32 / TABLE_SIZE as f32) * h as f32;
                    table[i] += amp * phase.sin();
                }
            }

            // Normalize peak to 1.0
            let peak = table.iter().fold(0.0f32, |m, &s| m.max(s.abs())).max(1e-8);
            for s in &mut table {
                *s /= peak;
            }

            tables.push(table);
        }

        Self {
            tables,
            num_levels: NUM_TABLES,
        }
    }

    /// Generate standard waveforms.
    pub fn sine() -> Self {
        Self::from_harmonics(|h| if h == 1 { 1.0 } else { 0.0 })
    }

    pub fn saw() -> Self {
        Self::from_harmonics(|h| 1.0 / h as f32 * if h % 2 == 0 { -1.0 } else { 1.0 })
    }

    pub fn square() -> Self {
        Self::from_harmonics(|h| if h % 2 == 1 { 1.0 / h as f32 } else { 0.0 })
    }

    pub fn triangle() -> Self {
        Self::from_harmonics(|h| {
            if h % 2 == 1 {
                let sign = if (h / 2) % 2 == 0 { 1.0 } else { -1.0 };
                sign / (h as f32 * h as f32)
            } else {
                0.0
            }
        })
    }

    /// Read from the table with linear interpolation and mip-map selection.
    #[inline]
    pub fn read(&self, phase: f32, freq_ratio: f32) -> f32 {
        // Select mip-map level based on frequency ratio (cycles per sample)
        let level = if freq_ratio <= 0.0 {
            0
        } else {
            let level_f = (freq_ratio * TABLE_SIZE as f32).log2().max(0.0);
            (level_f as usize).min(self.num_levels - 1)
        };

        let table = &self.tables[level];
        let pos = phase * TABLE_SIZE as f32;
        let idx = pos as usize;
        let frac = pos - idx as f32;
        let i0 = idx % TABLE_SIZE;
        let i1 = (idx + 1) % TABLE_SIZE;

        table[i0] + frac * (table[i1] - table[i0])
    }
}

/// Wavetable oscillator with phase accumulator.
pub struct WavetableOsc {
    phase: f32,
    table_index: usize, // Which waveform (0=sine, 1=saw, 2=square, 3=triangle)
}

impl WavetableOsc {
    pub fn new() -> Self {
        Self {
            phase: 0.0,
            table_index: 1,
        } // Default: saw
    }

    pub fn set_waveform(&mut self, index: usize) {
        self.table_index = index.min(3);
    }

    /// Advance phase and return sample.
    #[inline]
    pub fn tick(&mut self, freq: f32, sample_rate: f32, tables: &[Wavetable]) -> f32 {
        let inc = freq / sample_rate;
        self.phase += inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        if self.phase < 0.0 {
            self.phase += 1.0;
        }

        let table = &tables[self.table_index.min(tables.len() - 1)];
        table.read(self.phase, inc)
    }

    /// Return the current phase (0..1) for use by time-domain warp processing.
    #[inline]
    pub fn phase(&self) -> f32 {
        self.phase
    }

    pub fn reset_phase(&mut self) {
        self.phase = 0.0;
    }
}

/// PolyBLEP anti-aliased virtual analog oscillator.
/// Produces sine, saw, pulse and triangle waves with minimal aliasing.
pub struct PolyBlepOsc {
    phase: f32,
    pulse_width: f32,
    /// 0=sine, 1=saw, 2=square, 3=triangle — the same order as
    /// `WavetableOsc::table_index` and `FermenterPatch.oscWaveform`, so one
    /// selector value means the same waveform on either oscillator path.
    waveform: usize,
}

impl PolyBlepOsc {
    pub fn new() -> Self {
        Self {
            phase: 0.0,
            pulse_width: 0.5,
            // Saw, matching `WavetableOsc::new` and `Layer`'s `osc_waveform`
            // default, so a voice that renders before either configuration
            // path runs is on the same waveform as the wavetable engines.
            waveform: 1,
        }
    }

    pub fn set_pulse_width(&mut self, pw: f32) {
        self.pulse_width = pw.clamp(0.05, 0.95);
    }

    pub fn set_waveform(&mut self, index: usize) {
        self.waveform = index.min(3);
    }

    /// Advance phase and return one sample of the selected waveform.
    #[inline]
    pub fn tick(&mut self, freq: f32, sample_rate: f32) -> f32 {
        match self.waveform {
            0 => self.sine(freq, sample_rate),
            2 => self.pulse(freq, sample_rate),
            3 => self.triangle(freq, sample_rate),
            _ => self.saw(freq, sample_rate),
        }
    }

    /// Generate a sine sample.
    ///
    /// A sine has no harmonics above its fundamental, so it needs no
    /// band-limiting correction — the phase accumulator alone is alias-free.
    #[inline]
    pub fn sine(&mut self, freq: f32, sample_rate: f32) -> f32 {
        let inc = freq / sample_rate;
        self.phase += inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        (std::f32::consts::TAU * self.phase).sin()
    }

    /// Generate a polyBLAMP-corrected triangle sample.
    ///
    /// A triangle has no step discontinuity for polyBLEP to correct — it is
    /// continuous, and it is its *first derivative* that jumps, at the peak and
    /// at the trough. Those corners are what alias, so the correction is the
    /// band-limited ramp (BLAMP) residual rather than the band-limited step.
    ///
    /// The trivial triangle runs from +1 at phase 0 down to -1 at phase 0.5 and
    /// back, so its per-sample slope is `4 * inc` and the slope *changes* by
    /// `8 * inc` at each corner: downward at the peak, upward at the trough.
    /// The residual is scaled by that change and added at both corners, which
    /// is the synthesis case worked in Sec. 4.1 of the source cited on
    /// [`poly_blamp`] (its slope parameter `2 * mu` is this `8 * inc`).
    ///
    /// No delay line is needed even though the four-point residual reaches two
    /// samples either side of a corner: an oscillator knows where its corners
    /// are from the phase and the increment, so the ones just ahead of the
    /// current sample are as available as the ones just behind it.
    #[inline]
    pub fn triangle(&mut self, freq: f32, sample_rate: f32) -> f32 {
        let inc = freq / sample_rate;
        self.phase += inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let mut sample = 4.0 * (self.phase - 0.5).abs() - 1.0;

        let slope_change = 8.0 * inc;
        sample -= slope_change * poly_blamp(corner_distance(self.phase, 0.0, inc));
        sample += slope_change * poly_blamp(corner_distance(self.phase, 0.5, inc));
        sample
    }

    /// Generate a PolyBLEP sawtooth sample.
    #[inline]
    pub fn saw(&mut self, freq: f32, sample_rate: f32) -> f32 {
        let inc = freq / sample_rate;
        self.phase += inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let mut sample = 2.0 * self.phase - 1.0;
        sample -= poly_blep(self.phase, inc);
        sample
    }

    /// Generate a PolyBLEP pulse/square sample.
    #[inline]
    pub fn pulse(&mut self, freq: f32, sample_rate: f32) -> f32 {
        let inc = freq / sample_rate;
        self.phase += inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let mut sample = if self.phase < self.pulse_width {
            1.0
        } else {
            -1.0
        };
        sample += poly_blep(self.phase, inc);
        sample -= poly_blep((self.phase - self.pulse_width + 1.0) % 1.0, inc);
        sample
    }

    /// Return the current phase (0..1).
    #[inline]
    pub fn phase(&self) -> f32 {
        self.phase
    }

    pub fn reset_phase(&mut self) {
        self.phase = 0.0;
    }
}

/// Unison oscillator — wraps multiple WavetableOsc voices with detune and stereo spread.
pub struct UnisonOsc {
    voices: Vec<WavetableOsc>,
    detune_cents: f32,  // 0-100
    stereo_spread: f32, // 0-1
    voice_count: usize,
    /// The bank's waveform, held here as well as on each voice so that growing
    /// the bank cannot resurrect `WavetableOsc::new`'s saw default. Without it
    /// the fix would depend on `set_waveform` being called after `set_voices`
    /// at every call site.
    table_index: usize,
}

impl UnisonOsc {
    pub fn new() -> Self {
        // Capacity for the whole clamp range that `set_voices` accepts, not for
        // the one voice it starts with. `set_voices` is reachable from
        // `note_on` on the audio thread — a steal hands the incoming note a
        // freshly built `Voice` from the crossfade pool, so its unison `Vec` is
        // at count 1 and the early return does not fire — and `resize_with`
        // would then reallocate inside `process`. Reserving 16 up front means
        // it can only ever write into storage that already exists.
        let mut voices = Vec::with_capacity(16);
        voices.push(WavetableOsc::new());
        Self {
            voices,
            detune_cents: 0.0,
            stereo_spread: 0.5,
            voice_count: 1,
            table_index: 1,
        }
    }

    /// Set unison voice count (1-16). Resizes the voice array.
    pub fn set_voices(&mut self, count: usize) {
        let count = count.clamp(1, 16);
        if count == self.voice_count {
            return;
        }
        self.voice_count = count;
        // Appended oscillators are born on `WavetableOsc::new`'s saw default,
        // so they are stamped with the bank's waveform as they are created.
        // Without this the bank's waveform would depend on every caller
        // ordering `set_waveform` after `set_voices`.
        let table_index = self.table_index;
        self.voices.resize_with(count, || {
            let mut osc = WavetableOsc::new();
            osc.set_waveform(table_index);
            osc
        });
    }

    pub fn set_detune(&mut self, cents: f32) {
        self.detune_cents = cents.clamp(0.0, 100.0);
    }

    pub fn set_spread(&mut self, spread: f32) {
        self.stereo_spread = spread.clamp(0.0, 1.0);
    }

    pub fn set_waveform(&mut self, index: usize) {
        self.table_index = index.min(3);
        for v in &mut self.voices {
            v.set_waveform(self.table_index);
        }
    }

    /// Return the phase of the first unison voice (0..1).
    #[inline]
    pub fn phase(&self) -> f32 {
        if let Some(v) = self.voices.first() {
            v.phase()
        } else {
            0.0
        }
    }

    pub fn reset_phase(&mut self) {
        for v in &mut self.voices {
            v.reset_phase();
        }
    }

    /// Render all unison voices into stereo buffers with detune and panning.
    pub fn process_stereo(
        &mut self,
        freq: f32,
        sample_rate: f32,
        tables: &[Wavetable],
        left: &mut [f32],
        right: &mut [f32],
        block_size: usize,
    ) {
        let n = self.voice_count;
        let gain = 1.0 / (n as f32).sqrt(); // Normalize amplitude

        for vi in 0..n {
            // Compute detune offset: evenly spread from -detune_cents/2 to +detune_cents/2
            let detune_offset = if n > 1 {
                let t = vi as f32 / (n - 1) as f32; // 0..1
                (t - 0.5) * self.detune_cents
            } else {
                0.0
            };
            let voice_freq = freq * (2.0f32).powf(detune_offset / 1200.0);

            // Compute pan position: spread evenly from -spread to +spread
            let pan = if n > 1 {
                let t = vi as f32 / (n - 1) as f32; // 0..1
                (t - 0.5) * 2.0 * self.stereo_spread
            } else {
                0.0
            };
            // Equal-power panning: pan in -1..1
            let pan_norm = (pan + 1.0) * 0.5; // 0..1
            let angle = pan_norm * std::f32::consts::FRAC_PI_2;
            let gain_l = angle.cos() * gain;
            let gain_r = angle.sin() * gain;

            let voice = &mut self.voices[vi];
            for i in 0..block_size {
                let sample = voice.tick(voice_freq, sample_rate, tables);
                left[i] += sample * gain_l;
                right[i] += sample * gain_r;
            }
        }
    }

    /// Render one sample of all unison voices into stereo outputs.
    #[inline]
    pub fn process_sample_stereo(
        &mut self,
        freq: f32,
        sample_rate: f32,
        tables: &[Wavetable],
        out_l: &mut f32,
        out_r: &mut f32,
    ) {
        let n = self.voice_count;
        let gain = 1.0 / (n as f32).sqrt();

        for vi in 0..n {
            let detune_offset = if n > 1 {
                let t = vi as f32 / (n - 1) as f32;
                (t - 0.5) * self.detune_cents
            } else {
                0.0
            };
            let voice_freq = freq * (2.0f32).powf(detune_offset / 1200.0);

            let pan = if n > 1 {
                let t = vi as f32 / (n - 1) as f32;
                (t - 0.5) * 2.0 * self.stereo_spread
            } else {
                0.0
            };
            let pan_norm = (pan + 1.0) * 0.5;
            let angle = pan_norm * std::f32::consts::FRAC_PI_2;
            let gain_l = angle.cos() * gain;
            let gain_r = angle.sin() * gain;

            let sample = self.voices[vi].tick(voice_freq, sample_rate, tables);
            *out_l += sample * gain_l;
            *out_r += sample * gain_r;
        }
    }
}

/// Distance in samples from the sample at `phase` to the corner at `corner`,
/// measured the short way around the phase circle and returned unsigned.
///
/// Unsigned is enough because [`poly_blamp`] is symmetric about the corner, so
/// a corner two samples ahead is corrected by the same value as one two samples
/// behind. A zero increment yields a non-finite distance, which `poly_blamp`
/// reads as "no corner in range".
#[inline]
fn corner_distance(phase: f32, corner: f32, inc: f32) -> f32 {
    let mut delta = phase - corner;
    if delta > 0.5 {
        delta -= 1.0;
    }
    if delta < -0.5 {
        delta += 1.0;
    }
    (delta / inc).abs()
}

/// Four-point polyBLAMP residual, `t` in samples from the corner.
///
/// The polyBLAMP function is the second integral of the third-order B-spline
/// that stands in for the band-limited impulse; the *residual* is its
/// difference from the trivial ramp, and that is what gets added to a
/// waveform's corners. Method and derivation: Esqueda, Välimäki and Bilbao,
/// "Rounding Corners with BLAMP", Proc. DAFx-16, Brno, pp. 121-128 — Sec. 3
/// and Table 1 for the residual, Sec. 4.1 for the triangle-oscillator case.
///
/// Integrating the cubic B-spline twice and subtracting `max(t, 0)` gives a
/// residual that is even in `t`:
///
/// ```text
///   |t| <= 1      |t|^5/40 - t^4/12 + t^2/3 - |t|/2 + 7/30
///   1 < |t| < 2   (2 - |t|)^5 / 120
///   |t| >= 2      0
/// ```
///
/// Two checks that the coefficients are the paper's and not a plausible
/// mistranscription: the value at the corner is 7/30, the peak labelled on
/// Fig. 3(d), and the two branches agree at |t| = 1 on 1/120. Both are
/// asserted in this module's tests.
///
/// The `!(t < 2.0)` guard is written against the negation so that a NaN
/// distance — a zero-frequency oscillator, where the corner is neither in
/// range nor out of it — returns 0 instead of falling through.
#[inline]
fn poly_blamp(t: f32) -> f32 {
    let t = t.abs();
    if !(t < 2.0) {
        return 0.0;
    }
    if t > 1.0 {
        let u = 2.0 - t;
        let u2 = u * u;
        return u2 * u2 * u / 120.0;
    }
    let t2 = t * t;
    let t4 = t2 * t2;
    t4 * t / 40.0 - t4 / 12.0 + t2 / 3.0 - t / 2.0 + 7.0 / 30.0
}

/// PolyBLEP correction for band-limited discontinuities.
#[inline]
fn poly_blep(t: f32, dt: f32) -> f32 {
    if t < dt {
        let t = t / dt;
        2.0 * t - t * t - 1.0
    } else if t > 1.0 - dt {
        let t = (t - 1.0) / dt;
        t * t + 2.0 * t + 1.0
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::{poly_blamp, PolyBlepOsc, UnisonOsc, Wavetable};

    const SAMPLE_RATE: f32 = 48_000.0;
    const FRAMES: usize = 256;
    /// Any table other than saw, so that a voice left on `WavetableOsc::new`'s
    /// default is distinguishable from one carrying the bank's waveform.
    const SINE: usize = 0;

    fn tables() -> Vec<Wavetable> {
        vec![
            Wavetable::sine(),
            Wavetable::saw(),
            Wavetable::square(),
            Wavetable::triangle(),
        ]
    }

    fn render(osc: &mut UnisonOsc, tables: &[Wavetable]) -> Vec<f32> {
        let mut left = vec![0.0f32; FRAMES];
        let mut right = vec![0.0f32; FRAMES];
        osc.process_stereo(440.0, SAMPLE_RATE, tables, &mut left, &mut right, FRAMES);
        left
    }

    /// Growing the bank must not drop the waveform it was already set to.
    ///
    /// `set_voices` appends `WavetableOsc::new` oscillators, which start on
    /// saw. If it did not stamp them with the bank's waveform, this order of
    /// calls would leave three of four voices on the wrong table — and the
    /// engine's two callers would be silently required to always order
    /// `set_waveform` last.
    #[test]
    fn growing_the_bank_keeps_the_waveform_it_was_set_to() {
        let tables = tables();

        let mut grown_after_selection = UnisonOsc::new();
        grown_after_selection.set_spread(0.0);
        grown_after_selection.set_waveform(SINE);
        grown_after_selection.set_voices(4);

        let mut selected_after_growth = UnisonOsc::new();
        selected_after_growth.set_spread(0.0);
        selected_after_growth.set_voices(4);
        selected_after_growth.set_waveform(SINE);

        let grown = render(&mut grown_after_selection, &tables);
        let selected = render(&mut selected_after_growth, &tables);

        let peak = selected.iter().fold(0.0f32, |best, s| best.max(s.abs()));
        assert!(
            peak > 0.1,
            "the reference bank should be audible; peaked at {peak:.5}"
        );

        assert_eq!(
            grown, selected,
            "setting the waveform before growing the bank should render the \
             same as setting it after"
        );
    }

    /// The polyBLAMP residual is transcribed from a paper, so the transcription
    /// is checked against values the paper states independently of the
    /// coefficients: the peak of 7/30 labelled on Fig. 3(d), and the two
    /// branches meeting at |t| = 1.
    ///
    /// A coefficient typo would still produce a smooth, plausible-looking bump,
    /// so "it rounds the corner" is not evidence the residual is the right one.
    #[test]
    fn the_polyblamp_residual_matches_the_values_its_source_states() {
        assert!(
            (poly_blamp(0.0) - 7.0 / 30.0).abs() < 1e-6,
            "the residual at the corner should be the 7/30 peak on Fig. 3(d); \
             got {}",
            poly_blamp(0.0)
        );

        let from_inner = poly_blamp(1.0);
        let from_outer = poly_blamp(1.0 + f32::EPSILON * 8.0);
        assert!(
            (from_inner - 1.0 / 120.0).abs() < 1e-6,
            "the inner branch should reach 1/120 at |t| = 1; got {from_inner}"
        );
        assert!(
            (from_inner - from_outer).abs() < 1e-6,
            "the two branches should agree at |t| = 1; inner {from_inner}, \
             outer {from_outer}"
        );

        assert_eq!(
            poly_blamp(2.0),
            0.0,
            "the residual should vanish at |t| = 2"
        );
        assert_eq!(
            poly_blamp(-0.25),
            poly_blamp(0.25),
            "the residual should be even in t"
        );
        assert_eq!(
            poly_blamp(f32::NAN),
            0.0,
            "a zero-frequency oscillator yields a NaN corner distance, which \
             must read as no correction rather than fall through"
        );
    }

    /// A triangle's corners are what alias, and the correction is what removes
    /// them: without it the peak sample sits on the trivial `4|p-0.5|-1` value.
    ///
    /// Driven at an increment that puts a sample close to the peak, so the
    /// correction is near its full 7/30 weight and the claim is about a real
    /// rounding rather than a rounding error. The band-limited peak must sit
    /// *below* the trivial one — the residual is subtracted at a maximum.
    #[test]
    fn the_triangle_rounds_its_corners_below_the_trivial_waveform() {
        // 1/64 cycle per sample places a sample exactly on the phase-0 corner.
        const INC: f32 = 1.0 / 64.0;
        let mut osc = PolyBlepOsc::new();
        osc.set_waveform(3);

        let mut rendered = Vec::with_capacity(64);
        let mut trivial = Vec::with_capacity(64);
        let mut phase = 0.0f32;
        for _ in 0..64 {
            rendered.push(osc.tick(INC, 1.0));
            phase += INC;
            if phase >= 1.0 {
                phase -= 1.0;
            }
            trivial.push(4.0 * (phase - 0.5).abs() - 1.0);
        }

        let rendered_peak = rendered.iter().fold(f32::MIN, |best, s| best.max(*s));
        let trivial_peak = trivial.iter().fold(f32::MIN, |best, s| best.max(*s));
        assert!(
            (trivial_peak - 1.0).abs() < 1e-5,
            "the trivial reference should reach +1 at the corner; got \
             {trivial_peak}"
        );
        assert!(
            rendered_peak < trivial_peak - 0.01,
            "the corrected peak should be rounded down from the trivial {trivial_peak}; \
             got {rendered_peak}"
        );

        // Away from both corners the two must agree — the residual has finite
        // support, so a correction bleeding across the whole ramp would mean
        // the distance or the support bound is wrong.
        let mid = rendered.len() / 4;
        assert!(
            (rendered[mid] - trivial[mid]).abs() < 1e-5,
            "a quarter cycle from either corner the correction should be zero; \
             rendered {} against trivial {}",
            rendered[mid],
            trivial[mid]
        );
    }
}
