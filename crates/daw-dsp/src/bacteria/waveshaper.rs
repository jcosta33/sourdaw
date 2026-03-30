//! Custom waveshaper with Bezier transfer function for Bacteria.
//!
//! Users draw a transfer function f(x) using cubic Bezier segments.
//! The curve is evaluated in real-time using the Bernstein basis
//! with C1 continuity preservation.

/// A single cubic Bezier segment of the transfer function.
#[derive(Clone)]
pub struct BezierSegment {
    pub p0: (f32, f32), // Start point
    pub p1: (f32, f32), // Control point 1
    pub p2: (f32, f32), // Control point 2
    pub p3: (f32, f32), // End point
}

impl BezierSegment {
    /// Evaluate the curve at parameter t ∈ [0, 1].
    /// P(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
    fn evaluate(&self, t: f32) -> (f32, f32) {
        let t2 = t * t;
        let t3 = t2 * t;
        let mt = 1.0 - t;
        let mt2 = mt * mt;
        let mt3 = mt2 * mt;

        let x = mt3 * self.p0.0 + 3.0 * mt2 * t * self.p1.0
            + 3.0 * mt * t2 * self.p2.0 + t3 * self.p3.0;
        let y = mt3 * self.p0.1 + 3.0 * mt2 * t * self.p1.1
            + 3.0 * mt * t2 * self.p2.1 + t3 * self.p3.1;
        (x, y)
    }
}

/// Custom waveshaper using piecewise cubic Bezier transfer function.
pub struct CustomWaveshaper {
    segments: Vec<BezierSegment>,
    /// Pre-computed lookup table for fast evaluation (1024 entries for [-1, 1]).
    lut: Vec<f32>,
    lut_size: usize,
    lut_dirty: bool,
}

impl CustomWaveshaper {
    pub fn new() -> Self {
        // Default: identity transfer function (y = x)
        let segments = vec![BezierSegment {
            p0: (-1.0, -1.0),
            p1: (-0.33, -0.33),
            p2: (0.33, 0.33),
            p3: (1.0, 1.0),
        }];

        let mut ws = Self {
            segments,
            lut: vec![0.0; 1024],
            lut_size: 1024,
            lut_dirty: true,
        };
        ws.rebuild_lut();
        ws
    }

    /// Set the transfer function from a flat array of control points.
    /// Format: [p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, ...]
    /// Each 8 floats define one Bezier segment.
    pub fn set_curve(&mut self, points: &[f32]) {
        self.segments.clear();
        let mut i = 0;
        while i + 7 < points.len() {
            self.segments.push(BezierSegment {
                p0: (points[i], points[i + 1]),
                p1: (points[i + 2], points[i + 3]),
                p2: (points[i + 4], points[i + 5]),
                p3: (points[i + 6], points[i + 7]),
            });
            i += 8;
        }
        if self.segments.is_empty() {
            // Fallback: identity
            self.segments.push(BezierSegment {
                p0: (-1.0, -1.0),
                p1: (-0.33, -0.33),
                p2: (0.33, 0.33),
                p3: (1.0, 1.0),
            });
        }
        self.lut_dirty = true;
    }

    /// Rebuild the lookup table from current Bezier segments.
    fn rebuild_lut(&mut self) {
        // Sample each segment across its x range and interpolate into LUT
        // First, collect all (x, y) pairs by evaluating each segment densely
        let mut samples: Vec<(f32, f32)> = Vec::with_capacity(256);
        for seg in &self.segments {
            for step in 0..64 {
                let t = step as f32 / 63.0;
                let (x, y) = seg.evaluate(t);
                samples.push((x, y));
            }
        }

        // Sort by x
        samples.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        // Interpolate into LUT
        for i in 0..self.lut_size {
            let x = -1.0 + 2.0 * (i as f32) / (self.lut_size - 1) as f32;

            // Find surrounding samples
            let mut y = x; // default: identity
            for w in samples.windows(2) {
                if x >= w[0].0 && x <= w[1].0 {
                    let t = if (w[1].0 - w[0].0).abs() > 1e-6 {
                        (x - w[0].0) / (w[1].0 - w[0].0)
                    } else {
                        0.5
                    };
                    y = w[0].1 + t * (w[1].1 - w[0].1);
                    break;
                }
            }

            self.lut[i] = y.clamp(-1.5, 1.5);
        }

        self.lut_dirty = false;
    }

    /// Process a single sample through the transfer function.
    pub fn process_sample(&mut self, input: f32) -> f32 {
        if self.lut_dirty {
            self.rebuild_lut();
        }

        // LUT lookup with linear interpolation
        let x = input.clamp(-1.0, 1.0);
        let idx_f = (x + 1.0) * 0.5 * (self.lut_size - 1) as f32;
        let i0 = (idx_f as usize).min(self.lut_size - 2);
        let i1 = i0 + 1;
        let frac = idx_f - i0 as f32;

        self.lut[i0] * (1.0 - frac) + self.lut[i1] * frac
    }

    pub fn reset(&mut self) {
        // LUT persists — no state to reset
    }
}
