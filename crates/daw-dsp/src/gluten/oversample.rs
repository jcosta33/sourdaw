//! Configurable oversampling (1x/2x/4x) for nonlinear distortion elements.
//!
//! Uses half-band polyphase FIR filters for up/downsampling.
//! Applied only around the nonlinear elements (JFET, transformer, diode bridge),
//! not the entire signal chain, to minimize CPU cost.

/// Simple 2x oversampler with half-band FIR anti-alias filter.
/// 7-tap half-band: only 2 non-trivial multiplies per sample.
pub struct Oversample2x {
    up_z: [f32; 4],
    down_z: [f32; 4],
}

const HA: f32 = -0.0625;
const HB: f32 = 0.5625;

impl Oversample2x {
    pub fn new() -> Self {
        Self {
            up_z: [0.0; 4],
            down_z: [0.0; 4],
        }
    }

    #[inline]
    pub fn upsample(&mut self, x: f32) -> (f32, f32) {
        let even = HA * (self.up_z[3] + x) + HB * (self.up_z[1] + self.up_z[1]);
        let odd = x;
        self.up_z[3] = self.up_z[2];
        self.up_z[2] = self.up_z[1];
        self.up_z[1] = self.up_z[0];
        self.up_z[0] = x;
        (even * 2.0, odd)
    }

    #[inline]
    pub fn downsample(&mut self, s0: f32, s1: f32) -> f32 {
        let filtered =
            HA * (self.down_z[3] + s1) + HB * (self.down_z[1] + s0) + 0.5 * self.down_z[0];
        self.down_z[3] = self.down_z[2];
        self.down_z[2] = self.down_z[1];
        self.down_z[1] = self.down_z[0];
        self.down_z[0] = s1;
        filtered
    }

    pub fn reset(&mut self) {
        self.up_z = [0.0; 4];
        self.down_z = [0.0; 4];
    }
}

/// Process a nonlinear function at 2x oversampled rate.
#[inline]
pub fn process_oversampled<F: Fn(f32) -> f32>(os: &mut Oversample2x, input: f32, f: F) -> f32 {
    let (s0, s1) = os.upsample(input);
    let p0 = f(s0);
    let p1 = f(s1);
    os.downsample(p0, p1)
}

/// Configurable oversampler: supports 1x (bypass), 2x, or 4x.
/// 4x cascades two 2x stages.
pub struct ConfigurableOversample {
    stage1: Oversample2x,
    stage2: Oversample2x, // only used for 4x
    pub rate: u8,         // 1, 2, or 4
}

impl ConfigurableOversample {
    pub fn new(rate: u8) -> Self {
        Self {
            stage1: Oversample2x::new(),
            stage2: Oversample2x::new(),
            rate: rate.clamp(1, 4),
        }
    }

    pub fn set_rate(&mut self, rate: u8) {
        self.rate = match rate {
            0 | 1 => 1,
            2 => 2,
            _ => 4,
        };
        self.reset();
    }

    /// Process a nonlinear function at the configured oversampled rate.
    #[inline]
    pub fn process<F: Fn(f32) -> f32>(&mut self, input: f32, f: &F) -> f32 {
        match self.rate {
            1 => f(input),
            2 => {
                let (s0, s1) = self.stage1.upsample(input);
                let p0 = f(s0);
                let p1 = f(s1);
                self.stage1.downsample(p0, p1)
            }
            _ => {
                // 4x: cascade two 2x stages
                let (a0, a1) = self.stage1.upsample(input);
                // Each 2x sample gets upsampled again
                let (b0, b1) = self.stage2.upsample(a0);
                let r0 = f(b0);
                let r1 = f(b1);
                let d0 = self.stage2.downsample(r0, r1);

                let (b2, b3) = self.stage2.upsample(a1);
                let r2 = f(b2);
                let r3 = f(b3);
                let d1 = self.stage2.downsample(r2, r3);

                self.stage1.downsample(d0, d1)
            }
        }
    }

    pub fn reset(&mut self) {
        self.stage1.reset();
        self.stage2.reset();
    }
}
