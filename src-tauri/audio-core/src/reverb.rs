/// Algorithmic reverb using a Dattorro-style plate topology.
/// 8 parallel comb filters → 4 series allpass → mix.



struct CombFilter {
    buffer: Vec<f32>,
    pos: usize,
    feedback: f32,
    damp: f32,
    damp_state: f32,
}

impl CombFilter {
    fn new(delay_samples: usize, feedback: f32, damp: f32) -> Self {
        Self {
            buffer: vec![0.0; delay_samples],
            pos: 0,
            feedback,
            damp,
            damp_state: 0.0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let delayed = self.buffer[self.pos];
        // One-pole lowpass damping
        self.damp_state = delayed * (1.0 - self.damp) + self.damp_state * self.damp;
        self.buffer[self.pos] = input + self.damp_state * self.feedback;
        self.pos = (self.pos + 1) % self.buffer.len();
        delayed
    }
}

struct AllpassFilter {
    buffer: Vec<f32>,
    pos: usize,
    feedback: f32,
}

impl AllpassFilter {
    fn new(delay_samples: usize, feedback: f32) -> Self {
        Self {
            buffer: vec![0.0; delay_samples],
            pos: 0,
            feedback,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let delayed = self.buffer[self.pos];
        let output = delayed - input;
        self.buffer[self.pos] = input + delayed * self.feedback;
        self.pos = (self.pos + 1) % self.buffer.len();
        output
    }
}

pub struct AlgorithmicReverb {
    sample_rate: f32,
    mix: f32,
    size: f32,
    decay: f32,
    damping: f32,
    predelay_ms: f32,

    // Freeverb topology: 8 combs (4L + 4R), 4 allpasses (2L + 2R)
    combs_l: Vec<CombFilter>,
    combs_r: Vec<CombFilter>,
    allpasses_l: Vec<AllpassFilter>,
    allpasses_r: Vec<AllpassFilter>,

    // Pre-delay
    predelay_buf: Vec<f32>,
    predelay_pos: usize,
    predelay_len: usize,
}

// Freeverb comb delays (at 44100 Hz, scaled for other rates)
const COMB_DELAYS: [usize; 4] = [1116, 1188, 1277, 1356];
const ALLPASS_DELAYS: [usize; 2] = [556, 441];
const STEREO_SPREAD: usize = 23;

impl AlgorithmicReverb {
    pub fn new(sample_rate: f32) -> Self {
        let scale = sample_rate / 44100.0;
        let decay = 0.7;
        let damp = 0.5;

        let combs_l: Vec<CombFilter> = COMB_DELAYS.iter()
            .map(|&d| CombFilter::new((d as f32 * scale) as usize, decay, damp))
            .collect();
        let combs_r: Vec<CombFilter> = COMB_DELAYS.iter()
            .map(|&d| CombFilter::new(((d + STEREO_SPREAD) as f32 * scale) as usize, decay, damp))
            .collect();
        let allpasses_l: Vec<AllpassFilter> = ALLPASS_DELAYS.iter()
            .map(|&d| AllpassFilter::new((d as f32 * scale) as usize, 0.5))
            .collect();
        let allpasses_r: Vec<AllpassFilter> = ALLPASS_DELAYS.iter()
            .map(|&d| AllpassFilter::new(((d + STEREO_SPREAD) as f32 * scale) as usize, 0.5))
            .collect();

        let predelay_len = (0.02 * sample_rate) as usize; // 20ms default
        Self {
            sample_rate,
            mix: 0.3,
            size: 0.7,
            decay,
            damping: damp,
            predelay_ms: 20.0,
            combs_l, combs_r,
            allpasses_l, allpasses_r,
            predelay_buf: vec![0.0; (sample_rate * 0.5) as usize], // max 500ms
            predelay_pos: 0,
            predelay_len,
        }
    }

    fn update_reverb_params(&mut self) {
        let feedback = self.decay.clamp(0.0, 0.99);
        let damp = self.damping.clamp(0.0, 0.99);
        for c in self.combs_l.iter_mut().chain(self.combs_r.iter_mut()) {
            c.feedback = feedback;
            c.damp = damp;
        }
        self.predelay_len = ((self.predelay_ms / 1000.0) * self.sample_rate) as usize;
        self.predelay_len = self.predelay_len.min(self.predelay_buf.len() - 1);
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "mix" => { self.mix = value.clamp(0.0, 1.0); }
            "size" => { self.size = value.clamp(0.0, 1.0); self.decay = value * 0.95; self.update_reverb_params(); }
            "decay" => { self.decay = value.clamp(0.05, 0.99); self.update_reverb_params(); }
            "damping" => { self.damping = value.clamp(0.0, 0.99); self.update_reverb_params(); }
            "predelay" => { self.predelay_ms = value.clamp(0.0, 200.0); self.update_reverb_params(); }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        let buf_len = self.predelay_buf.len();

        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];
            let mono_in = (dry_l + dry_r) * 0.5;

            // Pre-delay
            self.predelay_buf[self.predelay_pos % buf_len] = mono_in;
            let read_pos = (self.predelay_pos + buf_len - self.predelay_len) % buf_len;
            let predelayed = self.predelay_buf[read_pos];
            self.predelay_pos = (self.predelay_pos + 1) % buf_len;

            // Parallel combs
            let mut wet_l = 0.0_f32;
            let mut wet_r = 0.0_f32;
            for c in self.combs_l.iter_mut() {
                wet_l += c.process(predelayed);
            }
            for c in self.combs_r.iter_mut() {
                wet_r += c.process(predelayed);
            }

            // Series allpasses
            for a in self.allpasses_l.iter_mut() {
                wet_l = a.process(wet_l);
            }
            for a in self.allpasses_r.iter_mut() {
                wet_r = a.process(wet_r);
            }

            // Mix
            left[i] = dry_l * (1.0 - self.mix) + wet_l * self.mix;
            right[i] = dry_r * (1.0 - self.mix) + wet_r * self.mix;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        vec!["mix", "size", "decay", "damping", "predelay"]
    }
}
