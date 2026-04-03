/// Noise generator with white, pink, and brown noise.
/// Uses a simple xorshift32 PRNG — no external dependencies.

/// Noise color constants.
pub const NOISE_WHITE: u8 = 0;
pub const NOISE_PINK: u8 = 1;
pub const NOISE_BROWN: u8 = 2;

/// Xorshift32 PRNG — simple, fast, deterministic.
struct Xorshift32 {
    state: u32,
}

impl Xorshift32 {
    fn new(seed: u32) -> Self {
        Self {
            state: if seed == 0 { 1 } else { seed },
        }
    }

    #[inline]
    fn next(&mut self) -> u32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        x
    }

    /// Return a random f32 in -1.0..1.0.
    #[inline]
    fn next_f32(&mut self) -> f32 {
        (self.next() as f32 / u32::MAX as f32) * 2.0 - 1.0
    }
}

/// Noise generator supporting white, pink, and brown noise.
pub struct NoiseGen {
    pub color: u8,
    rng: Xorshift32,
    // Pink noise: Voss-McCartney with 8 octave bands
    pink_rows: [f32; 8],
    pink_running_sum: f32,
    pink_counter: u32,
    // Brown noise: leaky integrator state
    brown_state: f32,
}

impl NoiseGen {
    pub fn new() -> Self {
        Self {
            color: NOISE_WHITE,
            rng: Xorshift32::new(0xDEAD_BEEF),
            pink_rows: [0.0; 8],
            pink_running_sum: 0.0,
            pink_counter: 0,
            brown_state: 0.0,
        }
    }

    /// Generate one sample of noise.
    #[inline]
    pub fn tick(&mut self) -> f32 {
        match self.color {
            NOISE_PINK => self.tick_pink(),
            NOISE_BROWN => self.tick_brown(),
            _ => self.rng.next_f32(), // White
        }
    }

    /// Voss-McCartney pink noise.
    #[inline]
    fn tick_pink(&mut self) -> f32 {
        self.pink_counter = self.pink_counter.wrapping_add(1);
        // Determine which rows to update based on trailing zeros of counter
        let changed = self.pink_counter.trailing_zeros() as usize;
        if changed < 8 {
            self.pink_running_sum -= self.pink_rows[changed];
            let new_val = self.rng.next_f32();
            self.pink_rows[changed] = new_val;
            self.pink_running_sum += new_val;
        }
        // Add white noise for the highest octave + sum of rows
        let white = self.rng.next_f32();
        // Normalize: 8 rows + 1 white, each in -1..1, max sum ~9
        (self.pink_running_sum + white) / 9.0
    }

    /// Brown noise via leaky integration of white noise.
    #[inline]
    fn tick_brown(&mut self) -> f32 {
        let white = self.rng.next_f32();
        self.brown_state = self.brown_state * 0.995 + white * 0.05;
        // Normalize to roughly -1..1 range
        (self.brown_state * 10.0).clamp(-1.0, 1.0)
    }
}
