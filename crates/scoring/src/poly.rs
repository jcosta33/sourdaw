/// Polyphonic string detection — band-pass per string + mono detector per band.
///
/// Targets known string frequencies (guitar, bass, custom). Much cheaper than
/// NMF or transcription because the problem is constrained to known pitches.
use crate::preprocess::Bandpass;
use crate::yin::YinDetector;

pub const MAX_STRINGS: usize = 8;

#[derive(Clone)]
pub struct StringTarget {
    pub label: [u8; 4], // e.g., "E2\0\0"
    pub midi_note: i32,
    pub freq_hz: f32,
    pub lo_hz: f32,
    pub hi_hz: f32,
}

impl StringTarget {
    pub fn new(label: &str, midi_note: i32, freq_hz: f32) -> Self {
        let mut l = [0u8; 4];
        for (i, b) in label.bytes().take(4).enumerate() {
            l[i] = b;
        }
        // ±2 semitones bandwidth
        let lo = freq_hz * 2.0_f32.powf(-2.0 / 12.0);
        let hi = freq_hz * 2.0_f32.powf(2.0 / 12.0);
        Self {
            label: l,
            midi_note,
            freq_hz,
            lo_hz: lo,
            hi_hz: hi,
        }
    }

    pub fn label_str(&self) -> &str {
        let len = self.label.iter().position(|&b| b == 0).unwrap_or(4);
        core::str::from_utf8(&self.label[..len]).unwrap_or("?")
    }
}

pub struct StringResult {
    pub cents: f32,
    pub confidence: f32,
    pub active: bool,
    pub freq: f32,
}

pub struct PolyStringTracker {
    strings: Vec<StringTarget>,
    filters: Vec<Bandpass>,
    detectors: Vec<YinDetector>,
    sample_rate: f32,
    // Per-string analysis buffers
    buffers: Vec<Vec<f32>>,
    buf_positions: Vec<usize>,
    buf_size: usize,
    hop_counter: usize,
    hop_size: usize,

    pub results: Vec<StringResult>,
    pub enabled: bool,
}

impl PolyStringTracker {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            strings: Vec::new(),
            filters: Vec::new(),
            detectors: Vec::new(),
            sample_rate,
            buffers: Vec::new(),
            buf_positions: Vec::new(),
            buf_size: 2048,
            hop_counter: 0,
            hop_size: (sample_rate / 15.0) as usize, // 15 Hz poly analysis rate
            results: Vec::new(),
            enabled: false,
        }
    }

    /// Configure for standard guitar tuning.
    pub fn set_guitar_standard(&mut self) {
        self.set_strings(&[
            StringTarget::new("E2", 40, 82.41),
            StringTarget::new("A2", 45, 110.00),
            StringTarget::new("D3", 50, 146.83),
            StringTarget::new("G3", 55, 196.00),
            StringTarget::new("B3", 59, 246.94),
            StringTarget::new("E4", 64, 329.63),
        ]);
    }

    /// Configure for bass guitar (4-string).
    pub fn set_bass_4(&mut self) {
        self.set_strings(&[
            StringTarget::new("E1", 28, 41.20),
            StringTarget::new("A1", 33, 55.00),
            StringTarget::new("D2", 38, 73.42),
            StringTarget::new("G2", 43, 98.00),
        ]);
    }

    fn set_strings(&mut self, targets: &[StringTarget]) {
        let n = targets.len().min(MAX_STRINGS);
        self.strings = targets[..n].to_vec();
        self.filters = targets[..n]
            .iter()
            .map(|t| {
                let center = t.freq_hz;
                let q = center / (t.hi_hz - t.lo_hz);
                Bandpass::new(center, q.max(0.5), self.sample_rate)
            })
            .collect();
        self.detectors = targets[..n]
            .iter()
            .map(|t| YinDetector::new(self.sample_rate, t.lo_hz, t.hi_hz))
            .collect();
        self.buffers = (0..n).map(|_| vec![0.0; self.buf_size]).collect();
        self.buf_positions = vec![0; n];
        self.results = (0..n)
            .map(|_| StringResult {
                cents: 0.0,
                confidence: 0.0,
                active: false,
                freq: 0.0,
            })
            .collect();
    }

    /// Feed one audio sample and optionally run analysis.
    pub fn process_sample(&mut self, sample: f32) {
        if !self.enabled || self.strings.is_empty() {
            return;
        }

        // Filter into per-string bands and accumulate
        for i in 0..self.strings.len() {
            let filtered = self.filters[i].process(sample);
            let pos = self.buf_positions[i];
            self.buffers[i][pos] = filtered;
            self.buf_positions[i] = (pos + 1) % self.buf_size;
        }

        self.hop_counter += 1;
        if self.hop_counter < self.hop_size {
            return;
        }
        self.hop_counter = 0;

        // Run per-string detection
        for i in 0..self.strings.len() {
            // Extract contiguous buffer
            let mut window = vec![0.0_f32; self.buf_size];
            let pos = self.buf_positions[i];
            for j in 0..self.buf_size {
                let idx = (pos + j) % self.buf_size;
                window[j] = self.buffers[i][idx];
            }

            // Apply Hann window
            crate::preprocess::apply_hann_window(&mut window);

            let (freq, conf) = self.detectors[i].detect(&window);

            if freq > 0.0 && conf > 0.4 {
                let target = self.strings[i].freq_hz;
                let cents = 1200.0 * (freq / target).log2();
                self.results[i] = StringResult {
                    cents,
                    confidence: conf,
                    active: true,
                    freq,
                };
            } else {
                self.results[i].active = false;
                self.results[i].confidence *= 0.9;
            }
        }
    }

    pub fn string_count(&self) -> usize {
        self.strings.len()
    }

    pub fn get_string_label(&self, idx: usize) -> &str {
        if idx < self.strings.len() {
            self.strings[idx].label_str()
        } else {
            "?"
        }
    }
}
