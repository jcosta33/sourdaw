//! Jon Dattorro's 1997 JAES Plate Reverb Algorithm.

use crate::reverb::delay::DelayLine;
use std::f32::consts::PI;

fn scale_delay(delay: usize, target_sr: f32) -> usize {
    ((delay as f32) * target_sr / 29761.0).round() as usize
}

// Simple One-Pole Low Pass Filter for Damping/Bandwidth
pub struct OnePoleLpf {
    z1: f32,
}

impl OnePoleLpf {
    pub fn new() -> Self {
        Self { z1: 0.0 }
    }

    #[inline(always)]
    pub fn process(&mut self, input: f32, coefficient: f32) -> f32 {
        let output = input * (1.0 - coefficient) + self.z1 * coefficient;
        self.z1 = output;
        output
    }
}

pub struct DattorroTank {
    sample_rate: f32,

    // Input Diffusion Allpasses
    in_ap1: (DelayLine, f32),
    in_ap2: (DelayLine, f32),
    in_ap3: (DelayLine, f32),
    in_ap4: (DelayLine, f32),

    bandwidth_lpf: OnePoleLpf,

    // Left half
    l_mod_ap: DelayLine,
    l_mod_prev: f32,
    l_delay1: DelayLine,
    l_damp_lpf: OnePoleLpf,
    l_fixed_ap: (DelayLine, f32),
    l_delay2: DelayLine,

    // Right half
    r_mod_ap: DelayLine,
    r_mod_prev: f32,
    r_delay1: DelayLine,
    r_damp_lpf: OnePoleLpf,
    r_fixed_ap: (DelayLine, f32),
    r_delay2: DelayLine,

    // LFO State
    lfo_phase: f32,

    // Parameters
    pub bandwidth: f32,
    pub damping: f32,
    pub decay: f32,
    pub decay_diffusion_1: f32,
    pub decay_diffusion_2: f32,
    pub input_diffusion_1: f32,
    pub input_diffusion_2: f32,
    pub excursion_samples: f32,
}

impl DattorroTank {
    pub fn new(sample_rate: f32) -> Self {
        let sc = |d| scale_delay(d, sample_rate);

        let exc = scale_delay(16, sample_rate) as f32; // Default excursion peak

        Self {
            sample_rate,

            in_ap1: (DelayLine::new(sc(142) + 10), 0.750),
            in_ap2: (DelayLine::new(sc(107) + 10), 0.750),
            in_ap3: (DelayLine::new(sc(379) + 10), 0.625),
            in_ap4: (DelayLine::new(sc(277) + 10), 0.625),

            bandwidth_lpf: OnePoleLpf::new(),

            l_mod_ap: DelayLine::new(sc(672) + exc as usize * 2 + 10),
            l_mod_prev: 0.0,
            l_delay1: DelayLine::new(sc(4453) + 10),
            l_damp_lpf: OnePoleLpf::new(),
            l_fixed_ap: (DelayLine::new(sc(1800) + 10), 0.50),
            l_delay2: DelayLine::new(sc(3720) + 10),

            r_mod_ap: DelayLine::new(sc(908) + exc as usize * 2 + 10),
            r_mod_prev: 0.0,
            r_delay1: DelayLine::new(sc(4217) + 10),
            r_damp_lpf: OnePoleLpf::new(),
            r_fixed_ap: (DelayLine::new(sc(2656) + 10), 0.50),
            r_delay2: DelayLine::new(sc(3163) + 10),

            lfo_phase: 0.0,

            bandwidth: 0.9995,
            damping: 0.0005,
            decay: 0.50,
            decay_diffusion_1: 0.70,
            decay_diffusion_2: 0.65, // decay + 0.15 clamped to 0.25-0.5 is standard, default to typical
            input_diffusion_1: 0.750,
            input_diffusion_2: 0.625,
            excursion_samples: exc,
        }
    }

    #[inline(always)]
    fn process_fixed_ap(dl: &mut DelayLine, coeff: f32, del_samples: usize, input: f32) -> f32 {
        let delayed = dl.read(del_samples);
        let fb = input + delayed * coeff;
        let out = delayed - fb * coeff;
        dl.write(fb);
        out
    }

    #[inline(always)]
    fn process_mod_ap(
        dl: &mut DelayLine,
        coeff: f32,
        fractional_delay: f32,
        prev: &mut f32,
        input: f32,
    ) -> f32 {
        let d_int = fractional_delay.floor() as usize;
        let alpha = fractional_delay - d_int as f32;

        let d0 = dl.read(d_int);
        let d1 = dl.read(d_int + 1);

        let ap_c = (1.0 - alpha) / (1.0 + alpha);
        let inter = d1 + ap_c * (d0 - *prev);
        *prev = inter;

        let fb = input + inter * coeff;
        let out = inter - fb * coeff;
        dl.write(fb);
        out
    }

    pub fn process(&mut self, input_mono: f32) -> (f32, f32) {
        let sc = |d| scale_delay(d, self.sample_rate);

        // Input bandwidth filter
        let mut sig = self.bandwidth_lpf.process(input_mono, 1.0 - self.bandwidth);

        // 4 Input diffusers
        sig = Self::process_fixed_ap(&mut self.in_ap1.0, self.input_diffusion_1, sc(142), sig);
        sig = Self::process_fixed_ap(&mut self.in_ap2.0, self.input_diffusion_1, sc(107), sig);
        sig = Self::process_fixed_ap(&mut self.in_ap3.0, self.input_diffusion_2, sc(379), sig);
        sig = Self::process_fixed_ap(&mut self.in_ap4.0, self.input_diffusion_2, sc(277), sig);

        // LFO advance
        self.lfo_phase += 2.0 * PI * 1.0 / self.sample_rate; // 1Hz base
        if self.lfo_phase > 2.0 * PI {
            self.lfo_phase -= 2.0 * PI;
        }

        let lfo_l = self.lfo_phase.sin(); // 1Hz
        let lfo_r = (self.lfo_phase * 0.707).cos(); // 0.707 Hz quadrature-ish

        // Modulated delay times
        let mod_delay_l = sc(672) as f32 + self.excursion_samples * lfo_l;
        let mod_delay_r = sc(908) as f32 + self.excursion_samples * lfo_r;

        // Peak reads from previous loop for cross-feedback
        let l_out = self.l_delay2.read(sc(3720));
        let r_out = self.r_delay2.read(sc(3163));

        // --- LEFT HALF ---
        let l_in = sig + r_out;
        let mut l_sig = Self::process_mod_ap(
            &mut self.l_mod_ap,
            -self.decay_diffusion_1,
            mod_delay_l,
            &mut self.l_mod_prev,
            l_in,
        );

        // Write/Read Delay 1
        self.l_delay1.write(l_sig);
        l_sig = self.l_delay1.read(sc(4453));

        l_sig = self.l_damp_lpf.process(l_sig, self.damping);
        l_sig *= self.decay;

        l_sig = Self::process_fixed_ap(
            &mut self.l_fixed_ap.0,
            self.decay_diffusion_2,
            sc(1800),
            l_sig,
        );

        self.l_delay2.write(l_sig);

        // --- RIGHT HALF ---
        let r_in = sig + l_out;
        let mut r_sig = Self::process_mod_ap(
            &mut self.r_mod_ap,
            -self.decay_diffusion_1,
            mod_delay_r,
            &mut self.r_mod_prev,
            r_in,
        );

        self.r_delay1.write(r_sig);
        r_sig = self.r_delay1.read(sc(4217));

        r_sig = self.r_damp_lpf.process(r_sig, self.damping);
        r_sig *= self.decay;

        r_sig = Self::process_fixed_ap(
            &mut self.r_fixed_ap.0,
            self.decay_diffusion_2,
            sc(2656),
            r_sig,
        );

        self.r_delay2.write(r_sig);

        // --- MULTI-TAP OUTPUT READS ---
        let y_l = 0.6 * self.r_delay1.read(sc(266)) + 0.6 * self.r_delay1.read(sc(2974))
            - 0.6 * self.r_fixed_ap.0.read(sc(1913))
            + 0.6 * self.r_delay2.read(sc(1996))
            - 0.6 * self.l_delay1.read(sc(1990))
            - 0.6 * self.l_fixed_ap.0.read(sc(187))
            - 0.6 * self.l_delay2.read(sc(1066));

        let y_r = 0.6 * self.l_delay1.read(sc(353)) + 0.6 * self.l_delay1.read(sc(3627))
            - 0.6 * self.l_fixed_ap.0.read(sc(1228))
            + 0.6 * self.l_delay2.read(sc(2673))
            - 0.6 * self.r_delay1.read(sc(2111))
            - 0.6 * self.r_fixed_ap.0.read(sc(335))
            - 0.6 * self.r_delay2.read(sc(121));

        (y_l, y_r)
    }
}
