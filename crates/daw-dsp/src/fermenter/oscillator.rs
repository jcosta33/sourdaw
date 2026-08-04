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
/// Produces saw and pulse waves with minimal aliasing.
pub struct PolyBlepOsc {
    phase: f32,
    pulse_width: f32,
}

impl PolyBlepOsc {
    pub fn new() -> Self {
        Self {
            phase: 0.0,
            pulse_width: 0.5,
        }
    }

    pub fn set_pulse_width(&mut self, pw: f32) {
        self.pulse_width = pw.clamp(0.05, 0.95);
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
        }
    }

    /// Set unison voice count (1-16). Resizes the voice array.
    pub fn set_voices(&mut self, count: usize) {
        let count = count.clamp(1, 16);
        if count == self.voice_count {
            return;
        }
        self.voice_count = count;
        self.voices.resize_with(count, WavetableOsc::new);
    }

    pub fn set_detune(&mut self, cents: f32) {
        self.detune_cents = cents.clamp(0.0, 100.0);
    }

    pub fn set_spread(&mut self, spread: f32) {
        self.stereo_spread = spread.clamp(0.0, 1.0);
    }

    pub fn set_waveform(&mut self, index: usize) {
        for v in &mut self.voices {
            v.set_waveform(index);
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
