//! Sampler engine — plays wavetable data as sample playback.
//! Supports one-shot, looping, and ping-pong modes.
//! Start/end points and crossfade for seamless loops.

pub const SAMPLE_BUFFER_SIZE: usize = 44100; // 1 second at 44.1kHz

#[derive(Clone, Copy, PartialEq)]
pub enum PlaybackMode {
    OneShot,  // Play once, stop at end
    Loop,     // Loop between start and end
    PingPong, // Bounce between start and end
}

#[derive(Clone)]
pub struct SamplerEngine {
    /// Internal sample buffer (populated from wavetable or external source)
    buffer: Vec<f32>,
    /// Playback position (fractional for pitch shifting)
    position: f32,
    /// Playback rate (1.0 = original pitch)
    rate: f32,
    /// Playback direction (1.0 = forward, -1.0 = reverse in ping-pong)
    direction: f32,
    /// Loop start point (0-1 normalized)
    loop_start: f32,
    /// Loop end point (0-1 normalized)
    loop_end: f32,
    /// Playback mode
    mode: PlaybackMode,
    /// Whether currently playing
    active: bool,
    /// Crossfade length in samples for loop smoothing
    crossfade: usize,
}

impl SamplerEngine {
    pub fn new() -> Self {
        // Initialize with a saw-like waveform as default "sample"
        let mut buffer = vec![0.0f32; SAMPLE_BUFFER_SIZE];
        for i in 0..SAMPLE_BUFFER_SIZE {
            let t = i as f32 / SAMPLE_BUFFER_SIZE as f32;
            // Default: a decaying saw burst (interesting for percussion)
            let env = (-t * 8.0).exp();
            buffer[i] = (t * 440.0 * core::f32::consts::TAU).sin() * env;
        }

        Self {
            buffer,
            position: 0.0,
            rate: 1.0,
            direction: 1.0,
            loop_start: 0.0,
            loop_end: 1.0,
            mode: PlaybackMode::OneShot,
            active: false,
            crossfade: 64,
        }
    }

    pub fn set_mode(&mut self, mode: u8) {
        self.mode = match mode {
            1 => PlaybackMode::Loop,
            2 => PlaybackMode::PingPong,
            _ => PlaybackMode::OneShot,
        };
    }

    pub fn set_loop_points(&mut self, start: f32, end: f32) {
        self.loop_start = start.clamp(0.0, 0.99);
        self.loop_end = end.clamp(0.01, 1.0).max(self.loop_start + 0.01);
    }

    /// Start playback at a pitch ratio relative to the original.
    pub fn trigger(&mut self, pitch_ratio: f32) {
        self.rate = pitch_ratio;
        self.position = self.loop_start * self.buffer.len() as f32;
        self.direction = 1.0;
        self.active = true;
    }

    pub fn stop(&mut self) {
        self.active = false;
    }

    pub fn reset(&mut self) {
        self.position = 0.0;
        self.active = false;
        self.direction = 1.0;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Process one sample. Returns the sample value.
    #[inline]
    pub fn tick(&mut self, _sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        let buf_len = self.buffer.len();
        let pos_f = self.position;
        let pos_i = pos_f as usize;
        let frac = pos_f - pos_i as f32;

        // Linear interpolation
        let idx0 = pos_i % buf_len;
        let idx1 = (pos_i + 1) % buf_len;
        let sample = self.buffer[idx0] * (1.0 - frac) + self.buffer[idx1] * frac;

        // Advance position
        self.position += self.rate * self.direction;

        let start_sample = self.loop_start * buf_len as f32;
        let end_sample = self.loop_end * buf_len as f32;

        match self.mode {
            PlaybackMode::OneShot => {
                if self.position >= buf_len as f32 {
                    self.active = false;
                }
            }
            PlaybackMode::Loop => {
                if self.position >= end_sample {
                    self.position = start_sample + (self.position - end_sample);
                }
            }
            PlaybackMode::PingPong => {
                if self.direction > 0.0 && self.position >= end_sample {
                    self.direction = -1.0;
                    self.position = end_sample - (self.position - end_sample);
                } else if self.direction < 0.0 && self.position <= start_sample {
                    self.direction = 1.0;
                    self.position = start_sample + (start_sample - self.position);
                }
            }
        }

        sample
    }
}
