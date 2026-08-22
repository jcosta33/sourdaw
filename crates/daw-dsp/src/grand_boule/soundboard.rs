//! Fixed finite-impulse-response body renderer for the Grand Boule piano.
//!
//! Four project-authored warm/open stereo kernels are built from cascades of
//! two-tap feed-forward delays. The body runs once on the aggregate bridge bus;
//! it has no feedback path and reaches exact silence after its bounded tail.

use crate::primitives::flush_denormal;

const FIR_STAGE_COUNT: usize = 12;
const EARLY_STAGE_COUNT: usize = 4;
const BODY_OUTPUT_GAIN: f32 = 0.18;

#[derive(Clone, Copy)]
struct KernelSpec {
    delay_ms: [f32; FIR_STAGE_COUNT],
    delayed_gain: [f32; FIR_STAGE_COUNT],
}

const WARM_LEFT: KernelSpec = KernelSpec {
    delay_ms: [
        17.0, 29.0, 43.0, 61.0, 79.0, 97.0, 113.0, 131.0, 149.0, 157.0, 173.0, 191.0,
    ],
    delayed_gain: [
        0.34, 0.28, -0.25, 0.31, 0.24, -0.22, 0.27, -0.20, 0.23, 0.18, -0.17, 0.15,
    ],
};

const WARM_RIGHT: KernelSpec = KernelSpec {
    delay_ms: [
        19.0, 31.0, 47.0, 59.0, 73.0, 101.0, 109.0, 137.0, 151.0, 163.0, 179.0, 193.0,
    ],
    delayed_gain: [
        0.32, -0.27, 0.29, 0.23, -0.26, 0.21, 0.25, -0.19, 0.22, -0.18, 0.16, 0.14,
    ],
};

const OPEN_LEFT: KernelSpec = KernelSpec {
    delay_ms: [
        13.0, 37.0, 41.0, 67.0, 71.0, 103.0, 107.0, 139.0, 143.0, 167.0, 181.0, 197.0,
    ],
    delayed_gain: [
        0.23, -0.31, 0.35, -0.28, 0.30, -0.24, 0.27, 0.22, -0.21, 0.19, -0.18, 0.16,
    ],
};

const OPEN_RIGHT: KernelSpec = KernelSpec {
    delay_ms: [
        23.0, 27.0, 53.0, 57.0, 83.0, 89.0, 127.0, 133.0, 147.0, 157.0, 187.0, 199.0,
    ],
    delayed_gain: [
        -0.25, 0.33, -0.29, 0.36, -0.27, 0.26, -0.23, 0.24, 0.20, -0.19, 0.17, -0.15,
    ],
};

/// The rendered bridge bus delivered to the independent soundboard stage.
///
/// This is intentionally a private-to-Grand-Boule boundary type rather than a
/// synthesis control: voices render their string-derived bridge signal first,
/// then the global soundboard consumes that completed signal.
#[derive(Clone, Copy, Debug)]
pub(crate) struct RenderedBridgeSignal(f32);

impl RenderedBridgeSignal {
    pub(crate) const fn new(sample: f32) -> Self {
        Self(sample)
    }
}

#[derive(Clone, Debug)]
struct FeedForwardDelay {
    buffer: Box<[f32]>,
    cursor: usize,
    delayed_gain: f32,
}

impl FeedForwardDelay {
    fn new(sample_rate: f32, delay_ms: f32, delayed_gain: f32) -> Self {
        let delay_samples = (sample_rate.max(1.0) * delay_ms * 0.001).round() as usize;
        Self {
            buffer: vec![0.0; delay_samples.max(1)].into_boxed_slice(),
            cursor: 0,
            delayed_gain,
        }
    }

    fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.cursor = 0;
    }

    #[inline]
    fn tick(&mut self, input: f32) -> f32 {
        let delayed = self.buffer[self.cursor];
        self.buffer[self.cursor] = input;
        self.cursor += 1;
        if self.cursor == self.buffer.len() {
            self.cursor = 0;
        }
        flush_denormal(input + delayed * self.delayed_gain)
    }
}

#[derive(Clone, Copy, Debug)]
struct CascadeOutput {
    early: f32,
    diffuse: f32,
}

#[derive(Clone, Debug)]
struct FeedForwardCascade {
    stages: [FeedForwardDelay; FIR_STAGE_COUNT],
}

impl FeedForwardCascade {
    fn new(sample_rate: f32, spec: KernelSpec) -> Self {
        Self {
            stages: core::array::from_fn(|index| {
                FeedForwardDelay::new(sample_rate, spec.delay_ms[index], spec.delayed_gain[index])
            }),
        }
    }

    fn reset(&mut self) {
        for stage in &mut self.stages {
            stage.reset();
        }
    }

    #[inline]
    fn tick(&mut self, input: f32) -> CascadeOutput {
        let mut sample = input;
        let mut early = input;
        for (index, stage) in self.stages.iter_mut().enumerate() {
            sample = stage.tick(sample);
            if index + 1 == EARLY_STAGE_COUNT {
                early = sample;
            }
        }
        CascadeOutput {
            early,
            diffuse: sample,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Soundboard {
    warm_left: FeedForwardCascade,
    warm_right: FeedForwardCascade,
    open_left: FeedForwardCascade,
    open_right: FeedForwardCascade,
    brightness: f32,
    late_diffusion_gain: f32,
    early_diffuse_mix: f32,
    #[cfg(test)]
    rendered_bridge_process_count: usize,
}

impl Soundboard {
    /// Construct all delay storage and fixed kernels. Processing and control
    /// updates allocate nothing after this returns.
    pub fn new(sample_rate: f32) -> Self {
        Self {
            warm_left: FeedForwardCascade::new(sample_rate, WARM_LEFT),
            warm_right: FeedForwardCascade::new(sample_rate, WARM_RIGHT),
            open_left: FeedForwardCascade::new(sample_rate, OPEN_LEFT),
            open_right: FeedForwardCascade::new(sample_rate, OPEN_RIGHT),
            brightness: 0.55,
            late_diffusion_gain: 0.6,
            early_diffuse_mix: 0.5,
            #[cfg(test)]
            rendered_bridge_process_count: 0,
        }
    }

    pub fn reset(&mut self) {
        self.warm_left.reset();
        self.warm_right.reset();
        self.open_left.reset();
        self.open_right.reset();
        #[cfg(test)]
        {
            self.rendered_bridge_process_count = 0;
        }
    }

    pub fn set_brightness(&mut self, value: f32) {
        if value.is_finite() {
            self.brightness = value.clamp(0.0, 1.0);
        }
    }

    pub fn set_body_resonance(&mut self, value: f32) {
        if value.is_finite() {
            self.late_diffusion_gain = value.clamp(0.0, 1.0);
        }
    }

    pub fn set_tone_color(&mut self, value: f32) {
        if value.is_finite() {
            self.early_diffuse_mix = (value.clamp(-1.0, 1.0) + 1.0) * 0.5;
        }
    }

    /// Process one bridge-input sample and return a stereo soundboard pair.
    #[inline]
    pub fn tick(&mut self, input: f32) -> (f32, f32) {
        self.process_rendered_bridge(RenderedBridgeSignal::new(input))
    }

    /// Process the completed aggregate bridge bus exactly once. Warm/open
    /// kernels remain state-aligned while brightness crossfades them; body
    /// resonance scales only the late cascade contribution, and tone color
    /// crossfades the early and fully diffused taps.
    #[inline]
    pub(crate) fn process_rendered_bridge(&mut self, bridge: RenderedBridgeSignal) -> (f32, f32) {
        #[cfg(test)]
        {
            self.rendered_bridge_process_count += 1;
        }

        let input = bridge.0;
        let warm_left = self.warm_left.tick(input);
        let warm_right = self.warm_right.tick(input);
        let open_left = self.open_left.tick(input);
        let open_right = self.open_right.tick(input);

        let left = self.render_channel(warm_left, open_left);
        let right = self.render_channel(warm_right, open_right);
        (left, right)
    }

    #[inline]
    fn render_channel(&self, warm: CascadeOutput, open: CascadeOutput) -> f32 {
        let early = warm.early + (open.early - warm.early) * self.brightness;
        let diffuse = warm.diffuse + (open.diffuse - warm.diffuse) * self.brightness;
        let controlled_diffuse = early + (diffuse - early) * self.late_diffusion_gain;
        let body = early + (controlled_diffuse - early) * self.early_diffuse_mix;
        flush_denormal(body * BODY_OUTPUT_GAIN)
    }

    #[cfg(test)]
    pub(crate) const fn rendered_bridge_process_count(&self) -> usize {
        self.rendered_bridge_process_count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soundboard_constructs_with_fixed_stage_count() {
        let board = Soundboard::new(48_000.0);
        assert_eq!(board.warm_left.stages.len(), FIR_STAGE_COUNT);
        assert_eq!(board.open_right.stages.len(), FIR_STAGE_COUNT);
        for spec in [WARM_LEFT, WARM_RIGHT, OPEN_LEFT, OPEN_RIGHT] {
            let tail_ms: f32 = spec.delay_ms.iter().sum();
            assert!((1_000.0..=1_500.0).contains(&tail_ms));
        }
    }

    #[test]
    fn impulse_response_has_a_finite_tail() {
        let mut board = Soundboard::new(48_000.0);
        let (left, right) = board.tick(1.0);
        assert!(left.abs() + right.abs() > 0.0);

        let mut tail_energy = 0.0_f32;
        let mut late_tail_energy = 0.0_f32;
        for frame in 0..72_000 {
            let (left, right) = board.tick(0.0);
            tail_energy += left.abs() + right.abs();
            if frame >= 48_000 {
                late_tail_energy += left.abs() + right.abs();
            }
        }
        assert!(
            tail_energy > 0.0,
            "the FIR body should emit a non-trivial tail"
        );
        assert!(
            late_tail_energy > 0.0,
            "the FIR body tail should extend beyond one second"
        );
        for _ in 0..512 {
            assert_eq!(board.tick(0.0), (0.0, 0.0));
        }
    }

    #[test]
    fn reset_clears_every_delay_stage() {
        let mut board = Soundboard::new(48_000.0);
        board.tick(1.0);
        for _ in 0..4_000 {
            board.tick(0.0);
        }
        board.reset();
        assert_eq!(board.tick(0.0), (0.0, 0.0));
    }

    #[test]
    fn stereo_channels_use_distinct_kernels() {
        let mut board = Soundboard::new(48_000.0);
        board.tick(1.0);
        let mut total_diff = 0.0_f32;
        for _ in 0..9_600 {
            let (left, right) = board.tick(0.0);
            total_diff += (left - right).abs();
        }
        assert!(
            total_diff > 0.0,
            "left and right kernels should decorrelate"
        );
    }

    #[test]
    fn controls_select_fixed_kernel_contributions_without_rebuilding() {
        let render = |brightness: f32, body: f32, tone: f32| {
            let mut board = Soundboard::new(48_000.0);
            board.set_brightness(brightness);
            board.set_body_resonance(body);
            board.set_tone_color(tone);
            let mut output = Vec::with_capacity(24_000);
            output.push(board.tick(1.0));
            for _ in 1..24_000 {
                output.push(board.tick(0.0));
            }
            output
        };

        assert_ne!(render(0.0, 1.0, 1.0), render(1.0, 1.0, 1.0));
        assert_ne!(render(0.5, 0.0, 1.0), render(0.5, 1.0, 1.0));
        assert_ne!(render(0.5, 1.0, -1.0), render(0.5, 1.0, 1.0));
    }

    #[test]
    fn rendered_bridge_signal_drives_an_independent_body_stage() {
        let mut board = Soundboard::new(48_000.0);
        let _ = board.process_rendered_bridge(RenderedBridgeSignal::new(1.0));

        let mut retained_tail = 0.0_f32;
        for _ in 0..9_600 {
            let (left, right) = board.process_rendered_bridge(RenderedBridgeSignal::new(0.0));
            retained_tail += left.abs() + right.abs();
        }
        assert!(
            retained_tail > 0.0,
            "the body must retain its finite FIR tail"
        );
    }
}
