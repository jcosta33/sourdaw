//! Real-time granular processor for Bacteria.
//!
//! Operates on live incoming audio using a circular buffer.
//! Supports grain size, density, position offset, pitch shift,
//! grain windowing (Hann/Gaussian), and freeze mode.

use std::f32::consts::PI;

/// Grain window shape.
#[derive(Clone, Copy)]
pub enum GrainWindow {
    Hann,
    Gaussian,
}

/// Single grain state.
struct Grain {
    active: bool,
    read_pos: f32,
    size_samples: usize,
    progress: usize,
    pitch_ratio: f32,
    window: GrainWindow,
}

impl Grain {
    fn new() -> Self {
        Self {
            active: false,
            read_pos: 0.0,
            size_samples: 0,
            progress: 0,
            pitch_ratio: 1.0,
            window: GrainWindow::Hann,
        }
    }

    fn window_value(&self) -> f32 {
        if self.size_samples == 0 { return 0.0; }
        let phase = self.progress as f32 / self.size_samples as f32;
        match self.window {
            GrainWindow::Hann => 0.5 * (1.0 - (2.0 * PI * phase).cos()),
            GrainWindow::Gaussian => {
                let x = (phase - 0.5) * 4.0; // ±2 sigma
                (-0.5 * x * x).exp()
            }
        }
    }
}

/// Real-time granular engine.
pub struct GranularProcessor {
    buffer: Vec<f32>,
    write_pos: usize,
    buffer_size: usize,

    grains: Vec<Grain>,
    max_grains: usize,

    // Parameters
    grain_size_ms: f32,
    density: f32,       // grains per second
    pos_offset_ms: f32,
    pitch_semitones: f32,
    window: GrainWindow,
    freeze: bool,
    mix: f32,

    sample_rate: f32,
    spawn_counter: f32,
}

impl GranularProcessor {
    pub fn new(sample_rate: f32) -> Self {
        let buffer_size = (sample_rate * 2.0) as usize; // 2 seconds circular buffer
        Self {
            buffer: vec![0.0; buffer_size],
            write_pos: 0,
            buffer_size,
            grains: (0..64).map(|_| Grain::new()).collect(),
            max_grains: 64,
            grain_size_ms: 80.0,
            density: 15.0,
            pos_offset_ms: 100.0,
            pitch_semitones: 0.0,
            window: GrainWindow::Hann,
            freeze: false,
            mix: 0.5,
            sample_rate,
            spawn_counter: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "grainSize" => self.grain_size_ms = value.clamp(1.0, 500.0),
            "grainDensity" => self.density = value.clamp(0.1, 100.0),
            "grainPosOffset" => self.pos_offset_ms = value.clamp(0.0, 2000.0),
            "grainPitch" => self.pitch_semitones = value,
            "grainWindow" => {
                self.window = if value < 0.5 { GrainWindow::Hann } else { GrainWindow::Gaussian };
            }
            "grainFreeze" => self.freeze = value > 0.5,
            "grainMix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        // Write to circular buffer (unless frozen)
        if !self.freeze {
            self.buffer[self.write_pos] = input;
            self.write_pos = (self.write_pos + 1) % self.buffer_size;
        }

        // Spawn new grains based on density
        self.spawn_counter += self.density / self.sample_rate;
        while self.spawn_counter >= 1.0 {
            self.spawn_counter -= 1.0;
            self.spawn_grain();
        }

        // Sum active grains
        let mut grain_sum = 0.0;
        for grain in &mut self.grains {
            if !grain.active { continue; }

            let win = grain.window_value();
            let read_idx = grain.read_pos as usize % self.buffer_size;
            let sample = self.buffer[read_idx];
            grain_sum += sample * win;

            grain.read_pos += grain.pitch_ratio;
            grain.progress += 1;
            if grain.progress >= grain.size_samples {
                grain.active = false;
            }
        }

        // Mix dry and granular
        input * (1.0 - self.mix) + grain_sum * self.mix
    }

    fn spawn_grain(&mut self) {
        let grain_size = (self.grain_size_ms * 0.001 * self.sample_rate) as usize;
        let offset = (self.pos_offset_ms * 0.001 * self.sample_rate) as usize;
        let pitch_ratio = 2.0_f32.powf(self.pitch_semitones / 12.0);

        // Find inactive grain slot
        for grain in &mut self.grains {
            if !grain.active {
                grain.active = true;
                grain.size_samples = grain_size.max(1);
                grain.progress = 0;
                grain.pitch_ratio = pitch_ratio;
                grain.window = self.window;

                // Read position: write head minus offset
                let start = if self.write_pos >= offset {
                    self.write_pos - offset
                } else {
                    self.buffer_size - (offset - self.write_pos)
                };
                grain.read_pos = start as f32;
                break;
            }
        }
    }

    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
        for grain in &mut self.grains {
            grain.active = false;
        }
        self.spawn_counter = 0.0;
    }
}
