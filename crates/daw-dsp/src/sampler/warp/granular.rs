/// Granular synthesis / playback engine.
///
/// Plays back audio using overlapping grains — short windowed fragments
/// of the source sample. Parameters control grain size, density, position,
/// scatter, and window shape.
///
/// Supports four window shapes (from spec):
///   - Hann: smooth, general-purpose
///   - Triangle: sharper transients
///   - Tukey: flat top with tapered edges
///   - Gaussian: minimal spectral leakage
///
/// Inter-onset time (IOT) supports up to 30% jitter for natural variation.
///
/// RT safety: window buffers are pre-allocated at construction and when
/// grain size or window shape changes. No allocations occur during `tick()`.

use std::f32::consts::PI;

// ── Constants ──────────────────────────────────────────────────────────

const MAX_GRAINS: usize = 64;
const DEFAULT_GRAIN_SIZE: usize = 2048;
const MAX_GRAIN_SIZE: usize = 65536;
const DEFAULT_DENSITY: f32 = 8.0; // grains per second overlap

// ── Window Shape ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrainWindow {
    Hann,
    Triangle,
    Tukey,
    Gaussian,
}

impl Default for GrainWindow {
    fn default() -> Self {
        Self::Hann
    }
}

// ── Single Grain ───────────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Grain {
    active: bool,
    /// Position in the source sample (fractional for pitch shifting).
    source_pos: f64,
    /// Playback speed (1.0 = original pitch).
    speed: f64,
    /// Current position within the grain envelope (0..grain_size).
    envelope_pos: usize,
    /// Size of this grain in samples.
    grain_size: usize,
}

impl Grain {
    fn new() -> Self {
        Self {
            active: false,
            source_pos: 0.0,
            speed: 1.0,
            envelope_pos: 0,
            grain_size: DEFAULT_GRAIN_SIZE,
        }
    }

    /// Tick one sample. `window` is the shared pre-allocated window buffer.
    fn tick(&mut self, source: &[f32], window: &[f32]) -> f32 {
        if !self.active {
            return 0.0;
        }

        let pos = self.source_pos as usize;
        let frac = (self.source_pos - pos as f64) as f32;

        // Linear interpolation (grains are short enough that cubic isn't critical).
        let s0 = if pos < source.len() { source[pos] } else { 0.0 };
        let s1 = if pos + 1 < source.len() {
            source[pos + 1]
        } else {
            0.0
        };
        let sample = s0 + frac * (s1 - s0);

        // Apply grain window from shared buffer.
        let env = if self.envelope_pos < window.len() && self.envelope_pos < self.grain_size {
            window[self.envelope_pos]
        } else {
            0.0
        };

        self.source_pos += self.speed;
        self.envelope_pos += 1;

        if self.envelope_pos >= self.grain_size {
            self.active = false;
        }

        sample * env
    }
}

// ── Granular Engine ────────────────────────────────────────────────────

/// Granular playback engine.
///
/// Manages a pool of overlapping grains. New grains are spawned at regular
/// intervals (IOT = inter-onset time) with optional jitter.
#[derive(Debug)]
pub struct GranularEngine {
    grains: Vec<Grain>,
    sample_rate: f32,

    // Parameters.
    grain_size: usize,
    /// Playback position in the source (0.0–1.0 normalized).
    position: f32,
    /// Position scatter range (0.0–1.0). Random offset applied to each grain.
    scatter: f32,
    /// Playback speed ratio (1.0 = original pitch).
    speed: f64,
    /// Grains spawned per second.
    density: f32,
    /// Window shape.
    window_shape: GrainWindow,
    /// IOT jitter amount (0.0–0.3 = 0%–30%).
    jitter: f32,

    // Pre-allocated window buffer (regenerated on param change, never during tick).
    window_buf: Vec<f32>,

    // Internal state.
    samples_until_next: usize,
    rng_state: u32,
}

impl GranularEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut grains = Vec::with_capacity(MAX_GRAINS);
        for _ in 0..MAX_GRAINS {
            grains.push(Grain::new());
        }

        let window_buf = generate_window(GrainWindow::Hann, DEFAULT_GRAIN_SIZE);

        Self {
            grains,
            sample_rate,
            grain_size: DEFAULT_GRAIN_SIZE,
            position: 0.0,
            scatter: 0.0,
            speed: 1.0,
            density: DEFAULT_DENSITY,
            window_shape: GrainWindow::Hann,
            jitter: 0.0,
            window_buf,
            samples_until_next: 0,
            rng_state: 12345,
        }
    }

    // ── Parameter Setters ──────────────────────────────────────────────

    pub fn set_grain_size(&mut self, samples: usize) {
        let clamped = samples.clamp(64, MAX_GRAIN_SIZE);
        if clamped != self.grain_size {
            self.grain_size = clamped;
            self.regenerate_window();
        }
    }

    pub fn set_position(&mut self, normalized: f32) {
        self.position = normalized.clamp(0.0, 1.0);
    }

    pub fn set_scatter(&mut self, amount: f32) {
        self.scatter = amount.clamp(0.0, 1.0);
    }

    pub fn set_speed(&mut self, ratio: f64) {
        self.speed = ratio;
    }

    pub fn set_density(&mut self, grains_per_sec: f32) {
        self.density = grains_per_sec.clamp(0.5, 100.0);
    }

    pub fn set_window(&mut self, shape: GrainWindow) {
        if shape != self.window_shape {
            self.window_shape = shape;
            self.regenerate_window();
        }
    }

    pub fn set_jitter(&mut self, amount: f32) {
        self.jitter = amount.clamp(0.0, 0.3);
    }

    // ── Processing ─────────────────────────────────────────────────────

    /// Process one sample of granular output from the given source buffer.
    pub fn tick(&mut self, source: &[f32]) -> f32 {
        // Check if we should spawn a new grain.
        if self.samples_until_next == 0 {
            self.spawn_grain(source.len());
            self.schedule_next();
        } else {
            self.samples_until_next -= 1;
        }

        // Sum all active grains, passing the shared window buffer.
        let mut output = 0.0f32;
        for grain in &mut self.grains {
            output += grain.tick(source, &self.window_buf);
        }

        output
    }

    /// Process a block of samples.
    pub fn process_block(&mut self, source: &[f32], output: &mut [f32]) {
        for sample in output.iter_mut() {
            *sample += self.tick(source);
        }
    }

    pub fn reset(&mut self) {
        for grain in &mut self.grains {
            grain.active = false;
        }
        self.samples_until_next = 0;
    }

    // ── Internal ───────────────────────────────────────────────────────

    fn spawn_grain(&mut self, source_len: usize) {
        // Find a free grain slot.
        let slot = match self.grains.iter().position(|g| !g.active) {
            Some(idx) => idx,
            None => return, // All grains busy.
        };

        // Calculate source position with scatter.
        let base_pos = self.position * source_len as f32;
        let scatter_offset = if self.scatter > 0.0 {
            let rng = self.next_random_float() * 2.0 - 1.0; // -1..1
            rng * self.scatter * source_len as f32
        } else {
            0.0
        };
        let start_pos = (base_pos + scatter_offset)
            .max(0.0)
            .min((source_len.saturating_sub(self.grain_size)) as f32);

        let grain = &mut self.grains[slot];
        grain.active = true;
        grain.source_pos = start_pos as f64;
        grain.speed = self.speed;
        grain.envelope_pos = 0;
        grain.grain_size = self.grain_size;
        // Window is read from self.window_buf during tick() — no allocation here.
    }

    /// Regenerate the pre-allocated window buffer. Called from setters only
    /// (management thread), never from `tick()`.
    fn regenerate_window(&mut self) {
        self.window_buf = generate_window(self.window_shape, self.grain_size);
    }

    fn schedule_next(&mut self) {
        let base_iot = self.sample_rate / self.density;
        let jitter_offset = if self.jitter > 0.0 {
            let rng = self.next_random_float() * 2.0 - 1.0;
            rng * self.jitter * base_iot
        } else {
            0.0
        };
        self.samples_until_next = (base_iot + jitter_offset).max(1.0) as usize;
    }

    /// Simple xorshift32 PRNG — no allocation, deterministic.
    fn next_random_float(&mut self) -> f32 {
        self.rng_state ^= self.rng_state << 13;
        self.rng_state ^= self.rng_state >> 17;
        self.rng_state ^= self.rng_state << 5;
        (self.rng_state as f32) / (u32::MAX as f32)
    }
}

// ── Window Generation ──────────────────────────────────────────────────

fn generate_window(shape: GrainWindow, size: usize) -> Vec<f32> {
    let mut window = Vec::with_capacity(size);
    let n = size as f32;

    match shape {
        GrainWindow::Hann => {
            for i in 0..size {
                window.push(0.5 * (1.0 - (2.0 * PI * i as f32 / n).cos()));
            }
        }
        GrainWindow::Triangle => {
            let half = n / 2.0;
            for i in 0..size {
                let pos = i as f32;
                window.push(1.0 - ((pos - half) / half).abs());
            }
        }
        GrainWindow::Tukey => {
            // Tukey window with alpha = 0.5 (50% taper).
            let alpha = 0.5f32;
            let taper = (alpha * n / 2.0) as usize;
            for i in 0..size {
                let val = if i < taper {
                    0.5 * (1.0 - (PI * i as f32 / (alpha * n / 2.0)).cos())
                } else if i >= size - taper {
                    0.5 * (1.0 - (PI * (size - 1 - i) as f32 / (alpha * n / 2.0)).cos())
                } else {
                    1.0
                };
                window.push(val);
            }
        }
        GrainWindow::Gaussian => {
            // Gaussian with sigma = 0.4.
            let sigma = 0.4f32;
            let center = (size - 1) as f32 / 2.0;
            for i in 0..size {
                let x = (i as f32 - center) / (sigma * center);
                window.push((-0.5 * x * x).exp());
            }
        }
    }

    window
}
