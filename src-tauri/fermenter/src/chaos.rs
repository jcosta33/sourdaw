//! Chaos-based modulation sources.

/// Lorenz attractor modulator — 3D chaotic system producing organic, never-repeating modulation.
/// The x, y, z outputs can modulate different targets.
pub struct LorenzMod {
    x: f32,
    y: f32,
    z: f32,
    /// Time step scale (controls speed of chaos)
    speed: f32,
    /// Output smoothing
    smooth_x: f32,
    smooth_y: f32,
}

impl LorenzMod {
    pub fn new() -> Self {
        Self {
            x: 0.1, y: 0.0, z: 0.0,
            speed: 1.0,
            smooth_x: 0.0,
            smooth_y: 0.0,
        }
    }

    pub fn set_speed(&mut self, speed: f32) {
        self.speed = speed.clamp(0.01, 10.0);
    }

    pub fn reset(&mut self) {
        self.x = 0.1;
        self.y = 0.0;
        self.z = 0.0;
        self.smooth_x = 0.0;
        self.smooth_y = 0.0;
    }

    /// Tick the attractor. Returns (x_mod, y_mod) normalized to roughly -1..1
    #[inline]
    pub fn tick(&mut self, sample_rate: f32) -> (f32, f32) {
        // Lorenz parameters (classic values)
        let sigma = 10.0;
        let rho = 28.0;
        let beta = 8.0 / 3.0;

        // Scale dt by speed and sample rate
        let dt = self.speed * 0.0001; // Very small for stability at audio rate

        let dx = sigma * (self.y - self.x) * dt;
        let dy = (self.x * (rho - self.z) - self.y) * dt;
        let dz = (self.x * self.y - beta * self.z) * dt;

        self.x += dx;
        self.y += dy;
        self.z += dz;

        // Normalize to roughly -1..1 (Lorenz attractor typically stays in ~[-20, 20] range)
        let norm_x = (self.x / 20.0).clamp(-1.0, 1.0);
        let norm_y = (self.y / 20.0).clamp(-1.0, 1.0);

        // Smooth output (control rate smoothing)
        let smooth = 1.0 - (-1.0 / (0.01 * sample_rate)).exp();
        self.smooth_x += smooth * (norm_x - self.smooth_x);
        self.smooth_y += smooth * (norm_y - self.smooth_y);

        (self.smooth_x, self.smooth_y)
    }
}

/// Perlin-style smooth noise modulator — organic, flowing modulation.
/// Uses a simple interpolated noise approach (not true Perlin, but similar character).
pub struct PerlinMod {
    phase: f32,
    speed: f32,
    /// Two noise values for interpolation
    val_a: f32,
    val_b: f32,
    /// PRNG seed
    seed: u32,
}

impl PerlinMod {
    pub fn new() -> Self {
        Self {
            phase: 0.0,
            speed: 1.0,
            val_a: 0.0,
            val_b: 0.0,
            seed: 54321,
        }
    }

    pub fn set_speed(&mut self, speed: f32) {
        self.speed = speed.clamp(0.01, 20.0);
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.val_a = 0.0;
        self.val_b = self.next_random();
    }

    fn next_random(&mut self) -> f32 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        (self.seed as f32 / u32::MAX as f32) * 2.0 - 1.0
    }

    /// Tick. Returns value in -1..1 with smooth interpolation between random values.
    #[inline]
    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        self.phase += self.speed / sample_rate;

        if self.phase >= 1.0 {
            self.phase -= 1.0;
            self.val_a = self.val_b;
            self.val_b = self.next_random();
        }

        // Smooth cosine interpolation
        let t = self.phase;
        let smooth_t = (1.0 - (t * core::f32::consts::PI).cos()) * 0.5;
        self.val_a * (1.0 - smooth_t) + self.val_b * smooth_t
    }
}
