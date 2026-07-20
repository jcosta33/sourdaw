/// Polyphonic string detection — band-pass per string + mono detector per band.
///
/// Targets known string frequencies (guitar, bass, custom). Much cheaper than
/// NMF or transcription because the problem is constrained to known pitches.
use crate::preprocess::Bandpass;
use crate::yin::{max_analysis_window, YinDetector};

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
    // Round-robin cursor: one string is analyzed per hop so the per-callback
    // peak cost stays inside the render quantum (15 Hz per string preserved).
    next_string: usize,
    // Reusable contiguous-window scratch for detection (no per-tick alloc)
    scratch: Vec<f32>,

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
            buf_size: 4096,
            hop_counter: 0,
            hop_size: (sample_rate / 15.0) as usize,
            next_string: 0,
            scratch: Vec::new(),
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
        // Per-string analysis buffer scaled to the sample rate so the lowest
        // string band always spans at least two full periods (the detector
        // clamps max_tau to len / 2): 4096 samples at 44.1–48 kHz, 8192 at
        // 88.2–96 kHz for bass E1. Capped at 8192 — at 192 kHz the floor is
        // 46.9 Hz, which yin::MAX_TAU imposes there regardless.
        let lowest_lo = targets[..n]
            .iter()
            .map(|t| t.lo_hz)
            .fold(f32::INFINITY, f32::min);
        self.buf_size = if lowest_lo.is_finite() {
            max_analysis_window(self.sample_rate, lowest_lo)
        } else {
            4096
        };
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
        self.scratch = vec![0.0; self.buf_size];
        // Round-robin: one string per hop, 15 Hz per string. Chunking keeps
        // the per-callback analysis peak inside the 128-frame quantum.
        self.hop_size = ((self.sample_rate / (15.0 * n.max(1) as f32)) as usize).max(1);
        self.next_string = 0;
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

        // Run detection for one string per hop (round-robin chunking).
        let i = self.next_string;
        self.next_string = (self.next_string + 1) % self.strings.len();

        // Extract contiguous buffer into reusable scratch. No Hann window:
        // the per-string YIN detector is autocorrelation-based and windowing
        // destroys its difference-function dip (see ScoringEngine::process).
        let pos = self.buf_positions[i];
        for j in 0..self.buf_size {
            let idx = (pos + j) % self.buf_size;
            self.scratch[j] = self.buffers[i][idx];
        }

        let (freq, conf) = self.detectors[i].detect(&self.scratch);

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    fn feed_sine(tracker: &mut PolyStringTracker, freq: f32, seconds: f32) {
        let sr = tracker.sample_rate;
        let total = (sr * seconds) as usize;
        for i in 0..total {
            let s = (TAU * freq * i as f32 / sr).sin() * 0.8;
            tracker.process_sample(s);
        }
    }

    /// Signal-in/signal-out: with poly mode enabled, a sustained sine on a
    /// string's fundamental must mark that string active at the played pitch.
    #[test]
    fn guitar_standard_reports_active_string() {
        let mut tracker = PolyStringTracker::new(44100.0);
        tracker.set_guitar_standard();
        tracker.enabled = true;
        feed_sine(&mut tracker, 82.41, 3.0);
        let r = &tracker.results[0];
        assert!(
            r.active,
            "E2 string never reported active (freq={:.2}, conf={:.2})",
            r.freq, r.confidence
        );
        assert!(
            r.cents.abs() < 30.0,
            "E2 string cents {:.1}, expected |cents| < 30",
            r.cents
        );
    }

    #[test]
    fn guitar_standard_tracks_high_string() {
        let mut tracker = PolyStringTracker::new(44100.0);
        tracker.set_guitar_standard();
        tracker.enabled = true;
        feed_sine(&mut tracker, 329.63, 3.0);
        let r = &tracker.results[5];
        assert!(
            r.active,
            "E4 string never reported active (freq={:.2}, conf={:.2})",
            r.freq, r.confidence
        );
        assert!(
            r.cents.abs() < 30.0,
            "E4 string cents {:.1}, expected |cents| < 30",
            r.cents
        );
    }

    #[test]
    fn bass_4_reports_active_low_e() {
        let mut tracker = PolyStringTracker::new(44100.0);
        tracker.set_bass_4();
        tracker.enabled = true;
        feed_sine(&mut tracker, 41.20, 4.0);
        let r = &tracker.results[0];
        assert!(
            r.active,
            "E1 string never reported active (freq={:.2}, conf={:.2})",
            r.freq, r.confidence
        );
        assert!(
            r.cents.abs() < 30.0,
            "E1 string cents {:.1}, expected |cents| < 30",
            r.cents
        );
    }

    /// Regression (PR #513 review): with a fixed 4096-sample buffer the
    /// detector floor at 96 kHz was 46.9 Hz, so bass E1 (41.2 Hz) could
    /// never report. The buffer now scales with sample rate and string band.
    #[test]
    fn bass_4_reports_active_low_e_at_96k() {
        let mut tracker = PolyStringTracker::new(96000.0);
        tracker.set_bass_4();
        tracker.enabled = true;
        feed_sine(&mut tracker, 41.20, 4.0);
        let r = &tracker.results[0];
        assert!(
            r.active,
            "E1 string never reported active at 96 kHz (freq={:.2}, conf={:.2})",
            r.freq, r.confidence
        );
        assert!(
            r.cents.abs() < 30.0,
            "E1 string cents at 96 kHz {:.1}, expected |cents| < 30",
            r.cents
        );
    }
}
