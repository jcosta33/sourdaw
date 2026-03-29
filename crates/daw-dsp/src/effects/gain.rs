/// Gain utility: volume control, phase invert, mono/stereo, stereo width, DC offset removal.

pub struct GainUtility {
    gain_linear: f32,
    pan: f32,          // -1..1 (L..R)
    phase_invert_l: bool,
    phase_invert_r: bool,
    mono: bool,
    width: f32,        // 0..2 (0=mono, 1=normal, 2=extra wide)
    dc_block: bool,

    // DC blocker state (one-pole highpass at ~5 Hz)
    dc_state_l: f32,
    dc_prev_l: f32,
    dc_state_r: f32,
    dc_prev_r: f32,
    dc_coeff: f32,
}

impl GainUtility {
    pub fn new() -> Self {
        Self {
            gain_linear: 1.0,
            pan: 0.0,
            phase_invert_l: false,
            phase_invert_r: false,
            mono: false,
            width: 1.0,
            dc_block: false,
            dc_state_l: 0.0,
            dc_prev_l: 0.0,
            dc_state_r: 0.0,
            dc_prev_r: 0.0,
            dc_coeff: 0.9995, // ~5 Hz at 44.1kHz
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "gain" => { self.gain_linear = 10.0_f32.powf(value.clamp(-60.0, 24.0) / 20.0); }
            "pan" => { self.pan = value.clamp(-1.0, 1.0); }
            "phase_l" => { self.phase_invert_l = value > 0.5; }
            "phase_r" => { self.phase_invert_r = value > 0.5; }
            "mono" => { self.mono = value > 0.5; }
            "width" => { self.width = value.clamp(0.0, 2.0); }
            "dc_block" => { self.dc_block = value > 0.5; }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        // Compute pan gains (equal-power)
        let pan_angle = (self.pan + 1.0) * 0.25 * core::f32::consts::PI;
        let pan_l = pan_angle.cos();
        let pan_r = pan_angle.sin();
        let phase_l = if self.phase_invert_l { -1.0 } else { 1.0 };
        let phase_r = if self.phase_invert_r { -1.0 } else { 1.0 };

        for i in 0..left.len() {
            let mut l = left[i];
            let mut r = right[i];

            // DC blocker
            if self.dc_block {
                let new_l = l - self.dc_prev_l + self.dc_coeff * self.dc_state_l;
                self.dc_prev_l = l;
                self.dc_state_l = new_l;
                l = new_l;

                let new_r = r - self.dc_prev_r + self.dc_coeff * self.dc_state_r;
                self.dc_prev_r = r;
                self.dc_state_r = new_r;
                r = new_r;
            }

            // Stereo width (mid-side processing)
            if (self.width - 1.0).abs() > 0.001 {
                let mid = (l + r) * 0.5;
                let side = (l - r) * 0.5;
                l = mid + side * self.width;
                r = mid - side * self.width;
            }

            // Mono sum
            if self.mono {
                let mono = (l + r) * 0.5;
                l = mono;
                r = mono;
            }

            // Phase invert + gain + pan
            left[i] = l * phase_l * self.gain_linear * pan_l;
            right[i] = r * phase_r * self.gain_linear * pan_r;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec!["gain", "pan", "phase_l", "phase_r", "mono", "width", "dc_block"]
    }
}
