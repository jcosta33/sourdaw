//! Scoring — Sourdaw's reference-grade chromatic tuner.
//!
//! Peterson-level strobe precision (±0.1 cent), polyphonic string detection,
//! multiple tuning systems. Analyzer plugin: audio passes through unchanged,
//! pitch telemetry sent to UI via shared state.

pub mod mpm;
pub mod poly;
pub mod preprocess;
pub mod scala;
pub mod tone;
pub mod tuning;
pub mod yin;

use mpm::MpmDetector;
use poly::PolyStringTracker;
use preprocess::{normalize, Bandpass, DcBlocker, RmsTracker};
use tone::ToneGenerator;
use tuning::TuningSystem;
use wasm_bindgen::prelude::*;
use yin::YinDetector;

/// Replace every non-finite sample (NaN, +Inf, -Inf) in `block` with silence,
/// returning the count scrubbed (DSP-8). The tuner passes audio through, so a
/// non-finite sample would otherwise reach the WebAudio output buffer and can
/// silence the whole downstream graph; the block is scrubbed at the boundary
/// before the pointer is returned to the AudioWorklet. RT-safe: no allocation,
/// one branch per sample.
#[inline]
fn sanitize_block(block: &mut [f32]) -> usize {
    let mut scrubbed = 0;
    for sample in block.iter_mut() {
        if !sample.is_finite() {
            *sample = 0.0;
            scrubbed += 1;
        }
    }
    scrubbed
}

/// Install `console_error_panic_hook` once at wasm module init so a Rust panic
/// surfaces a readable message on the JS console instead of an opaque
/// `unreachable` trap that silently poisons the AudioWorklet instance (WB-6).
/// Wasm-only by construction; the native build is unaffected.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen(start)]
fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

// ---------------------------------------------------------------------------
// Analysis ring buffer
// ---------------------------------------------------------------------------

const GATE_THRESHOLD: f32 = 0.005; // -46 dBFS noise gate
const ANALYSIS_FMIN: f32 = 40.0; // lowest supported fundamental

struct AnalysisBuffer {
    data: Vec<f32>,
    write_pos: usize,
    samples_since_analysis: usize,
    hop_size: usize,
}

impl AnalysisBuffer {
    fn new(hop_size: usize, capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity],
            write_pos: 0,
            samples_since_analysis: 0,
            hop_size,
        }
    }

    fn push(&mut self, sample: f32) -> bool {
        self.data[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.data.len();
        self.samples_since_analysis += 1;
        if self.samples_since_analysis >= self.hop_size {
            self.samples_since_analysis = 0;
            true // time to analyze
        } else {
            false
        }
    }

    /// Extract the last `len` samples into a contiguous buffer.
    fn extract(&self, output: &mut [f32], len: usize) {
        let capacity = self.data.len();
        let len = len.min(capacity).min(output.len());
        for i in 0..len {
            let idx = (self.write_pos + capacity - len + i) % capacity;
            output[i] = self.data[idx];
        }
    }
}

// ---------------------------------------------------------------------------
// Temporal stabilizer (weighted median of recent frames)
// ---------------------------------------------------------------------------

const HISTORY_SIZE: usize = 8;

struct TemporalStabilizer {
    freqs: [f32; HISTORY_SIZE],
    confs: [f32; HISTORY_SIZE],
    pos: usize,
    count: usize,
}

impl TemporalStabilizer {
    fn new() -> Self {
        Self {
            freqs: [0.0; HISTORY_SIZE],
            confs: [0.0; HISTORY_SIZE],
            pos: 0,
            count: 0,
        }
    }

    fn push(&mut self, freq: f32, confidence: f32) {
        self.freqs[self.pos] = freq;
        self.confs[self.pos] = confidence;
        self.pos = (self.pos + 1) % HISTORY_SIZE;
        if self.count < HISTORY_SIZE {
            self.count += 1;
        }
    }

    /// Forget every retained frame. RT-safe: two counter writes, no allocation.
    fn reset(&mut self) {
        self.pos = 0;
        self.count = 0;
    }

    /// Weighted median of recent frequencies.
    fn stable_freq(&self) -> f32 {
        if self.count == 0 {
            return 0.0;
        }

        // Sort by frequency, weighted by confidence
        let mut pairs: [(f32, f32); HISTORY_SIZE] = [(0.0, 0.0); HISTORY_SIZE];
        for i in 0..self.count {
            pairs[i] = (self.freqs[i], self.confs[i]);
        }
        // Simple insertion sort (N=8, negligible cost)
        for i in 1..self.count {
            let key = pairs[i];
            let mut j = i;
            while j > 0 && pairs[j - 1].0 > key.0 {
                pairs[j] = pairs[j - 1];
                j -= 1;
            }
            pairs[j] = key;
        }

        // Weighted median: find the frequency where cumulative weight crosses 50%
        let total_weight: f32 = pairs[..self.count].iter().map(|p| p.1).sum();
        if total_weight < 0.01 {
            return 0.0;
        }

        let mut cumulative = 0.0;
        for i in 0..self.count {
            cumulative += pairs[i].1;
            if cumulative >= total_weight * 0.5 {
                return pairs[i].0;
            }
        }
        pairs[self.count / 2].0
    }
}

// ---------------------------------------------------------------------------
// Vibrato detector
// ---------------------------------------------------------------------------

struct VibratoDetector {
    freq_history: [f32; 32],
    pos: usize,
    count: usize,
    pub detected: bool,
    pub alpha: f32, // adaptive smoothing coefficient
}

impl VibratoDetector {
    fn new() -> Self {
        Self {
            freq_history: [0.0; 32],
            pos: 0,
            count: 0,
            detected: false,
            alpha: 0.2,
        }
    }

    /// Forget every retained frame, including the vibrato verdict and the
    /// smoothing coefficient it derived. RT-safe: field writes only.
    fn reset(&mut self) {
        self.pos = 0;
        self.count = 0;
        self.detected = false;
        self.alpha = 0.2;
    }

    fn update(&mut self, freq: f32, confidence: f32) {
        self.freq_history[self.pos] = freq;
        self.pos = (self.pos + 1) % 32;
        if self.count < 32 {
            self.count += 1;
        }

        // Compute variance of recent frequencies
        if self.count > 4 {
            let mean: f32 = self.freq_history[..self.count].iter().sum::<f32>() / self.count as f32;
            let variance: f32 = self.freq_history[..self.count]
                .iter()
                .map(|f| (f - mean) * (f - mean))
                .sum::<f32>()
                / self.count as f32;

            // Vibrato threshold: variance > 2 Hz² suggests vibrato
            self.detected = variance > 2.0;
        }

        // Adaptive alpha based on confidence
        self.alpha = 0.05 + confidence * 0.25; // 0.05 (low conf) to 0.30 (high conf)
        if self.detected {
            self.alpha *= 0.7; // reduce alpha during vibrato for stability
        }
    }
}

// ---------------------------------------------------------------------------
// Scoring tuner engine
// ---------------------------------------------------------------------------

pub struct ScoringEngine {
    sample_rate: f32,

    // Preprocessing
    dc_blocker: DcBlocker,
    bandpass: Bandpass,
    rms: RmsTracker,

    // Analysis
    analysis_buf: AnalysisBuffer,
    analysis_window: Vec<f32>,
    yin: YinDetector,
    mpm: MpmDetector,
    poly: PolyStringTracker,

    // Stabilization
    stabilizer: TemporalStabilizer,
    vibrato: VibratoDetector,

    // Smoothed output (needle path)
    smoothed_freq: f32,

    // Tuning
    pub tuning: TuningSystem,

    // Tone generator
    pub tone: ToneGenerator,

    // Current state (read by WASM accessor)
    pub frequency: f32,
    pub cents: f32,
    pub confidence: f32,
    pub note_index: usize,
    pub octave: i32,
    pub midi_note: i32,
    pub active: bool,
    pub mute_output: bool,
}

impl ScoringEngine {
    pub fn new(sample_rate: f32) -> Self {
        let hop = (sample_rate / 30.0) as usize; // ~30 Hz analysis rate
        let window = yin::max_analysis_window(sample_rate, ANALYSIS_FMIN);

        Self {
            sample_rate,
            dc_blocker: DcBlocker::new(sample_rate),
            bandpass: Bandpass::new(500.0, 0.5, sample_rate), // wide bandpass
            rms: RmsTracker::new(sample_rate, 0.03),
            analysis_buf: AnalysisBuffer::new(hop, window),
            analysis_window: vec![0.0; window],
            yin: YinDetector::new(sample_rate, 40.0, 5000.0),
            mpm: MpmDetector::new(sample_rate, 40.0, 5000.0),
            poly: PolyStringTracker::new(sample_rate),
            stabilizer: TemporalStabilizer::new(),
            vibrato: VibratoDetector::new(),
            smoothed_freq: 0.0,
            tuning: TuningSystem::new(),
            tone: ToneGenerator::new(sample_rate),
            frequency: 0.0,
            cents: 0.0,
            confidence: 0.0,
            note_index: 0,
            octave: 4,
            midi_note: 69,
            active: false,
            mute_output: false,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "a4_hz" | "reference" => self.tuning.set_param("a4_hz", value),
            "transpose" => self.tuning.set_param("transpose", value),
            "capo" => self.tuning.set_param("capo", value),
            "tone" => self.tone.set_enabled(value > 0.5),
            "mute" => self.mute_output = value > 0.5,
            "poly" => self.poly.enabled = value > 0.5,
            "instrument" => match value as u8 {
                0 => self.poly.set_guitar_standard(),
                1 => self.poly.set_bass_4(),
                _ => {}
            },
            _ => {}
        }
    }

    /// One analysis tick that produced no usable detection. Confidence decays,
    /// and once it runs out the note is over.
    ///
    /// Every retained frame describes the note that just ended, so carrying
    /// them forward lets the previous pitch win the weighted median at the
    /// *next* onset (and makes the jump between the two register as vibrato).
    /// Start the next note from nothing. RT-safe: field writes and a counter
    /// reset, no allocation.
    #[inline]
    fn release(&mut self) {
        self.confidence *= 0.9;
        if self.confidence < 0.05 {
            if self.active {
                self.stabilizer.reset();
                self.vibrato.reset();
                self.smoothed_freq = 0.0;
            }
            self.active = false;
        }
    }

    /// Process a block of audio. Passes through (or mutes) the audio while analyzing pitch.
    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for i in 0..left.len() {
            let input = (left[i] + right[i]) * 0.5;

            // Preprocess
            let dc_removed = self.dc_blocker.process(input);
            let filtered = self.bandpass.process(dc_removed);
            let rms = self.rms.update(filtered);

            // Feed poly tracker (runs at its own rate internally)
            self.poly.process_sample(filtered);

            // Feed analysis buffer
            let should_analyze = self.analysis_buf.push(filtered);

            if should_analyze && rms > GATE_THRESHOLD {
                // Extract window. No Hann window: YIN/MPM are
                // autocorrelation-based and a window makes r(τ) decay with
                // the window autocorrelation, destroying the period dip/peak
                // for any fundamental beyond a few hundred Hz.
                let window_len = self.analysis_window.len();
                self.analysis_buf
                    .extract(&mut self.analysis_window, window_len);
                normalize(&mut self.analysis_window);

                // Run YIN (primary)
                let (yin_freq, yin_conf) = self.yin.detect(&self.analysis_window);

                // Run MPM (cross-check) on YIN's autocorrelation — one FFT
                // pair per analysis tick instead of two.
                let (mpm_freq, mpm_clarity) = self
                    .mpm
                    .detect_from_autocorr(&self.analysis_window, &self.yin.autocorr);

                // Use YIN as primary; use MPM as fallback if YIN confidence is low
                let (freq, conf) = if yin_conf > 0.5 {
                    (yin_freq, yin_conf)
                } else if mpm_clarity > 0.6 {
                    (mpm_freq, mpm_clarity)
                } else {
                    (yin_freq, yin_conf) // YIN even at low confidence
                };

                if freq > 0.0 && conf > 0.3 {
                    self.stabilizer.push(freq, conf);
                    self.vibrato.update(freq, conf);

                    // Smoothed frequency (adaptive alpha)
                    let alpha = self.vibrato.alpha;
                    self.smoothed_freq += alpha * (freq - self.smoothed_freq);

                    // Map to note
                    let stable = self.stabilizer.stable_freq();
                    let use_freq = if stable > 0.0 {
                        stable
                    } else {
                        self.smoothed_freq
                    };
                    let (midi, note_idx, oct, cts) = self.tuning.map_frequency(use_freq);

                    self.frequency = use_freq;
                    self.cents = cts;
                    self.confidence = conf;
                    self.note_index = note_idx;
                    self.octave = oct;
                    self.midi_note = midi;
                    self.active = true;

                    // Update tone generator to target note frequency
                    let target_freq = self.tuning.midi_to_freq(midi);
                    self.tone.set_freq(target_freq);
                } else {
                    // Loud but unpitched: a damped string, a pick scrape, or
                    // the previous string still ringing while the player moves
                    // to the next one. Without this the release only ever runs
                    // below the gate, so the tuner holds the dead note's
                    // history through the whole string-to-string move.
                    self.release();
                }
            } else if should_analyze && rms <= GATE_THRESHOLD {
                // Below noise gate — fade out
                self.release();
            }

            // Add tone generator output
            let tone_out = self.tone.tick();

            // Pass through or mute
            if self.mute_output {
                left[i] = tone_out;
                right[i] = tone_out;
            } else {
                left[i] += tone_out;
                right[i] += tone_out;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// WASM export
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct ScoringInstance {
    engine: ScoringEngine,
    out_left: Vec<f32>,
    out_right: Vec<f32>,
    nan_flush_count: u64,
}

#[wasm_bindgen]
impl ScoringInstance {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32) -> Self {
        Self {
            engine: ScoringEngine::new(sample_rate),
            out_left: vec![0.0; 1024],
            out_right: vec![0.0; 1024],
            nan_flush_count: 0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    pub fn process(&mut self, left_in: &[f32], right_in: &[f32], frames: u32) -> *const f32 {
        let size = (frames as usize).min(1024);
        self.out_left[..size].copy_from_slice(&left_in[..size]);
        self.out_right[..size].copy_from_slice(&right_in[..size]);
        self.engine
            .process(&mut self.out_left[..size], &mut self.out_right[..size]);
        self.nan_flush_count += sanitize_block(&mut self.out_left[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.out_right[..size]) as u64;
        self.out_left.as_ptr()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    pub fn get_right_ptr(&self) -> *const f32 {
        self.out_right.as_ptr()
    }

    // Telemetry accessors (called from JS to read current state)
    pub fn get_frequency(&self) -> f32 {
        self.engine.frequency
    }
    pub fn get_cents(&self) -> f32 {
        self.engine.cents
    }
    pub fn get_confidence(&self) -> f32 {
        self.engine.confidence
    }
    pub fn get_note_index(&self) -> u32 {
        self.engine.note_index as u32
    }
    pub fn get_octave(&self) -> i32 {
        self.engine.octave
    }
    pub fn get_midi_note(&self) -> i32 {
        self.engine.midi_note
    }
    pub fn is_active(&self) -> bool {
        self.engine.active
    }

    // Poly telemetry
    pub fn get_poly_string_count(&self) -> u32 {
        self.engine.poly.string_count() as u32
    }
    pub fn get_poly_string_cents(&self, idx: u32) -> f32 {
        self.engine
            .poly
            .results
            .get(idx as usize)
            .map(|r| r.cents)
            .unwrap_or(0.0)
    }
    pub fn get_poly_string_confidence(&self, idx: u32) -> f32 {
        self.engine
            .poly
            .results
            .get(idx as usize)
            .map(|r| r.confidence)
            .unwrap_or(0.0)
    }
    pub fn is_poly_string_active(&self, idx: u32) -> bool {
        self.engine
            .poly
            .results
            .get(idx as usize)
            .map(|r| r.active)
            .unwrap_or(false)
    }

    /// Import a Scala .scl file and apply it as tuning offsets. Returns whether
    /// the file was applied: a malformed scale, or one that is not 12 degrees,
    /// changes nothing. The offsets table is one entry per 12-TET pitch class,
    /// so a scale of any other size cannot be represented and is refused rather
    /// than truncated into a different tuning.
    pub fn import_scala(&mut self, scl_text: &str) -> bool {
        let Some(scale) = scala::ScalaScale::parse_scl(scl_text) else {
            return false;
        };
        if scale.note_count != 12 {
            return false;
        }
        self.engine.tuning.offsets = scale.to_12tet_offsets();
        true
    }

    /// Import an AnaMark .tun file and apply it as tuning offsets. Returns
    /// whether the file was applied. A file that declares no `BaseFreq` leaves
    /// the current concert-A reference alone — silence about the reference is
    /// not a request to reset it to 440.
    ///
    /// `BaseFreq` is the frequency of MIDI note 0, not concert A: the default
    /// is 8.1757989156 Hz, which is A440. It is converted, not clamped. Running
    /// it through `set_param` would fold every out-of-range value into
    /// 400..=490 and silently retune a 415 or 432 session while reporting
    /// success, so a converted reference outside that range fails the whole
    /// import and nothing is applied — a declared-but-unusable reference is
    /// corruption, not absence.
    pub fn import_tun(&mut self, tun_text: &str) -> bool {
        let Some(tuning) = scala::AnaMarkTuning::parse_tun(tun_text) else {
            return false;
        };

        // Validate before applying anything: a rejected file must leave the
        // offsets table exactly as it was.
        let a4_hz = match tuning.base_freq {
            Some(base_freq) => {
                let a4 = base_freq * (2.0_f32).powf(69.0 / 12.0);
                if !(400.0..=490.0).contains(&a4) {
                    return false;
                }
                Some(a4)
            }
            None => None,
        };

        self.engine.tuning.offsets = tuning.to_12tet_offsets();
        if let Some(a4) = a4_hz {
            self.engine.tuning.a4_hz = a4;
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::TAU;

    /// Feed `seconds` of a stereo sine through the engine in 128-frame blocks,
    /// the same entry path the AudioWorklet uses.
    fn run_engine(engine: &mut ScoringEngine, freq: f32, sample_rate: f32, seconds: f32) {
        let blocks = (sample_rate * seconds) as usize / 128;
        let mut n = 0usize;
        for _ in 0..blocks {
            let mut left = [0.0_f32; 128];
            let mut right = [0.0_f32; 128];
            for i in 0..128 {
                let s = (TAU * freq * n as f32 / sample_rate).sin() * 0.8;
                left[i] = s;
                right[i] = s;
                n += 1;
            }
            engine.process(&mut left, &mut right);
        }
    }

    /// Signal-in/signal-out: the tuner must report the played note across the
    /// guitar/bass range — not a fixed ~5.6 kHz (MIDI 113) at full confidence.
    fn assert_tunes(freq: f32, sample_rate: f32, expected_midi: i32) {
        let mut engine = ScoringEngine::new(sample_rate);
        run_engine(&mut engine, freq, sample_rate, 2.0);
        assert!(
            engine.active,
            "engine inactive for {freq} Hz input (freq={:.2}, conf={:.2})",
            engine.frequency, engine.confidence
        );
        let err_cents = 1200.0 * (engine.frequency / freq).log2().abs();
        assert!(
            err_cents < 30.0,
            "engine {freq} Hz -> {:.2} Hz ({:.1} cents off, midi {})",
            engine.frequency,
            err_cents,
            engine.midi_note
        );
        assert_eq!(
            engine.midi_note, expected_midi,
            "engine {freq} Hz mapped to wrong note"
        );
    }

    #[test]
    fn tunes_guitar_and_bass_range() {
        assert_tunes(82.41, 44100.0, 40); // E2
        assert_tunes(110.0, 44100.0, 45); // A2
        assert_tunes(220.0, 44100.0, 57); // A3
        assert_tunes(440.0, 44100.0, 69); // A4
        assert_tunes(82.41, 48000.0, 40); // E2 at 48 kHz
    }

    #[test]
    fn engine_poly_mode_marks_string_active() {
        let mut engine = ScoringEngine::new(44100.0);
        engine.set_param("instrument", 0.0); // guitar standard
        engine.set_param("poly", 1.0);
        run_engine(&mut engine, 82.41, 44100.0, 3.0);
        assert!(
            engine.poly.results[0].active,
            "poly E2 string never reported active (freq={:.2}, conf={:.2})",
            engine.poly.results[0].freq, engine.poly.results[0].confidence
        );
    }

    /// Regression (PR #513 review): with a fixed 4096-sample window the
    /// detector floor at 96 kHz was 46.9 Hz, so bass E1 (41.2 Hz) was
    /// undetectable. The window now scales with sample rate.
    #[test]
    fn tunes_bass_e1_at_96k() {
        assert_tunes(41.20, 96000.0, 28); // E1
    }

    /// Regression (PR #513 review): noisy low input must not fall back to a
    /// ~5 kHz MPM min_tau lock.
    #[test]
    fn tunes_low_e_under_noise() {
        let sr = 44100.0_f32;
        let freq = 82.41_f32;
        let mut engine = ScoringEngine::new(sr);
        let mut rng = 0x9E37_79B9_u32;
        let mut noise = move || {
            rng ^= rng << 13;
            rng ^= rng >> 17;
            rng ^= rng << 5;
            (rng as f32 / u32::MAX as f32) * 2.0 - 1.0
        };
        let blocks = (sr * 2.0) as usize / 128;
        let mut n = 0usize;
        for _ in 0..blocks {
            let mut left = [0.0_f32; 128];
            let mut right = [0.0_f32; 128];
            for i in 0..128 {
                let s = (TAU * freq * n as f32 / sr).sin() * 0.8 + noise() * 0.24;
                left[i] = s;
                right[i] = s;
                n += 1;
            }
            engine.process(&mut left, &mut right);
        }
        assert!(
            engine.active,
            "engine inactive for noisy {freq} Hz input (freq={:.2}, conf={:.2})",
            engine.frequency, engine.confidence
        );
        assert!(
            engine.frequency < 1000.0,
            "engine locked to ~5 kHz under noise: {:.2} Hz",
            engine.frequency
        );
        let err_cents = 1200.0 * (engine.frequency / freq).log2().abs();
        assert!(
            err_cents < 30.0,
            "engine noisy {freq} Hz -> {:.2} Hz ({:.1} cents off)",
            engine.frequency,
            err_cents
        );
    }

    /// Feed `seconds` of a stereo sine through `ScoringInstance` — the object
    /// the AudioWorklet actually holds — in 128-frame blocks.
    fn run_instance(instance: &mut ScoringInstance, freq: f32, sample_rate: f32, seconds: f32) {
        let blocks = (sample_rate * seconds) as usize / 128;
        let mut n = 0usize;
        for _ in 0..blocks {
            let mut left = [0.0_f32; 128];
            let mut right = [0.0_f32; 128];
            for i in 0..128 {
                let s = (TAU * freq * n as f32 / sample_rate).sin() * 0.8;
                left[i] = s;
                right[i] = s;
                n += 1;
            }
            let _ = instance.process(&left, &right, 128);
        }
    }

    /// The concert-A reference has to move the readout, not just a number in a
    /// panel. One fixed 446 Hz tone, three references — the input never
    /// changes, so every difference below is `a4_hz` doing its job:
    ///
    /// | reference | note | cents        |
    /// | --------- | ---- | ------------ |
    /// | 440 (default) | A4  | +23.5 (sharp of A440) |
    /// | 446           | A4  | 0 (in tune)           |
    /// | 415 (Baroque) | A#4 | +24.7                 |
    ///
    /// 440 is deliberately not the only row. It is the one reference at which a
    /// tuner that ignores the parameter entirely still reports the right
    /// answer, so a guard that only ran there would pass on a dead knob.
    ///
    /// Driven through `ScoringInstance::set_param`, the string dispatch the
    /// worklet's `{ type: 'param' }` message lands on, rather than by assigning
    /// `TuningSystem::a4_hz`: both `set_param` hops end in a `_ => {}` arm, so a
    /// drifted id is swallowed without a trace and only the string path can see
    /// it.
    ///
    /// Mutation that reds this (ADR 0015): drop the `"a4_hz" | "reference"` arm
    /// from `ScoringEngine::set_param` so the write falls through to `_ => {}` —
    /// all three rows then report the 440 reading and the second and third fail.
    #[test]
    fn cent_readout_is_measured_against_the_a4_reference() {
        const TONE_HZ: f32 = 446.0;
        const SAMPLE_RATE: f32 = 44100.0;

        // (reference, expected midi note, expected note index)
        let cases: [(Option<f32>, i32, usize); 3] =
            [(None, 69, 9), (Some(446.0), 69, 9), (Some(415.0), 70, 10)];

        let mut readings: Vec<f32> = Vec::new();

        for (reference, expected_midi, expected_note_index) in cases {
            let mut instance = ScoringInstance::new(SAMPLE_RATE);
            if let Some(hz) = reference {
                instance.set_param("a4_hz", hz);
            }
            run_instance(&mut instance, TONE_HZ, SAMPLE_RATE, 2.0);

            assert!(
                instance.is_active(),
                "inactive at reference {reference:?} (freq={:.2}, conf={:.2})",
                instance.get_frequency(),
                instance.get_confidence()
            );

            // The reference renames the note as well as moving the deviation:
            // 446 Hz is an A against a 440 or 446 reference and an A# against a
            // 415 one.
            assert_eq!(
                instance.get_midi_note(),
                expected_midi,
                "wrong note at reference {reference:?}"
            );
            assert_eq!(
                instance.get_note_index() as usize,
                expected_note_index,
                "wrong note name at reference {reference:?}"
            );

            // Predicted from the reference alone: cents from the nearest note of
            // a 12-TET grid anchored at `a4_hz`.
            let anchor = reference.unwrap_or(440.0);
            let semitones_from_a4 = 12.0 * (TONE_HZ / anchor).log2();
            let expected_cents = semitones_from_a4 * 100.0 - (expected_midi - 69) as f32 * 100.0;
            assert!(
                (instance.get_cents() - expected_cents).abs() < 4.0,
                "reference {reference:?}: expected ~{expected_cents:.1} cents, read {:.1} \
                 (detected {:.2} Hz)",
                instance.get_cents(),
                instance.get_frequency()
            );

            readings.push(instance.get_cents());
        }

        // The gap between the 440 row and the 446 row is the feature itself, and
        // it is the one number detector error cannot explain away: the tone is
        // identical, so whatever the analyser estimated cancels out of the
        // difference and only the reference is left.
        let default_reading = readings[0];
        let matched_reading = readings[1];
        let expected_gap = 1200.0 * (TONE_HZ / 440.0_f32).log2();
        assert!(
            (default_reading - matched_reading - expected_gap).abs() < 0.5,
            "moving the reference from 440 to {TONE_HZ} Hz shifted the readout by \
             {:.2} cents, expected {expected_gap:.2} \
             (440 -> {default_reading:.2}, {TONE_HZ} -> {matched_reading:.2})",
            default_reading - matched_reading
        );
    }

    /// Feeds the engine one 128-frame block at a time with a continuous phase,
    /// so a test can watch the readout across an onset instead of only after
    /// it, and so switching tone or dropping to silence introduces no click.
    struct BlockFeeder {
        phase: f32,
        sample_rate: f32,
    }

    impl BlockFeeder {
        fn new(sample_rate: f32) -> Self {
            Self {
                phase: 0.0,
                sample_rate,
            }
        }

        fn feed(&mut self, engine: &mut ScoringEngine, freq: f32, amplitude: f32) {
            let mut left = [0.0_f32; 128];
            let mut right = [0.0_f32; 128];
            let step = TAU * freq / self.sample_rate;
            for i in 0..128 {
                let s = self.phase.sin() * amplitude;
                self.phase += step;
                if self.phase >= TAU {
                    self.phase -= TAU;
                }
                left[i] = s;
                right[i] = s;
            }
            engine.process(&mut left, &mut right);
        }
    }

    /// A note ends and another begins. The stabilizer keeps eight frames and
    /// the vibrato detector thirty-two, so history carried across the gate
    /// makes the *old* pitch win the weighted median at the new onset: play
    /// A3, stop, play A4, and the first thing the tuner says is still A3.
    ///
    /// Asserted on the first active report after the second onset, which is
    /// exactly the reading a player looks at — a guard that waited for the
    /// history to refill would pass on the broken engine.
    ///
    /// Mutation that reds this: drop the `stabilizer.reset()` call from the
    /// gate branch in `ScoringEngine::process` — the first report comes back as
    /// MIDI 57 (220 Hz), the note that already ended.
    #[test]
    fn a_new_note_after_silence_is_not_blended_with_the_previous_one() {
        const SAMPLE_RATE: f32 = 44100.0;
        let blocks_per_second = (SAMPLE_RATE / 128.0) as usize;

        let mut engine = ScoringEngine::new(SAMPLE_RATE);
        let mut feeder = BlockFeeder::new(SAMPLE_RATE);

        // First note: A3.
        for _ in 0..blocks_per_second * 2 {
            feeder.feed(&mut engine, 220.0, 0.8);
        }
        assert!(engine.active, "engine never locked onto the first note");
        assert_eq!(engine.midi_note, 57, "first note misread");

        // Silence, long enough for the gate to release the tuner.
        let mut released = false;
        for _ in 0..blocks_per_second * 3 {
            feeder.feed(&mut engine, 220.0, 0.0);
            if !engine.active {
                released = true;
                break;
            }
        }
        assert!(
            released,
            "gate never released after three seconds of silence"
        );

        // Second note: A4, an octave up. The first active report has to be the
        // note being played now.
        let mut first_report: Option<(i32, f32)> = None;
        for _ in 0..blocks_per_second * 2 {
            feeder.feed(&mut engine, 440.0, 0.8);
            if engine.active {
                first_report = Some((engine.midi_note, engine.frequency));
                break;
            }
        }
        let (midi_note, frequency) =
            first_report.expect("engine never locked onto the second note");
        assert_eq!(
            midi_note, 69,
            "first report after re-onset was MIDI {midi_note} ({frequency:.1} Hz); \
             the tuner is still showing the note that ended"
        );

        // The octave jump between the two notes is not vibrato. Retained
        // vibrato history turns it into one, which narrows the smoothing
        // coefficient at exactly the moment the tuner should be settling.
        //
        // Mutation that reds this: drop `vibrato.reset()` from the gate branch.
        assert!(
            !engine.vibrato.detected,
            "steady 440 Hz re-onset reported as vibrato — the jump from the \
             previous note is still in the history"
        );
    }

    /// The gate is not the only way a note ends. Tuning string to string, the
    /// player damps one string and moves to the next: the signal stays loud —
    /// well above the gate — while the pitch detector has nothing usable to
    /// report. Decaying confidence only below the gate means the release never
    /// runs here, `active` never falls, and the dead string's frames keep
    /// winning the weighted median at the next onset.
    ///
    /// Mutation that reds this: delete the `else { self.release(); }` arm from
    /// the `freq > 0.0 && conf > 0.3` test in `ScoringEngine::process` — the
    /// engine stays active with A3's history intact for as long as the loud
    /// unpitched signal lasts.
    #[test]
    fn a_loud_unpitched_signal_still_releases_the_tuner() {
        const SAMPLE_RATE: f32 = 44100.0;
        let blocks_per_second = (SAMPLE_RATE / 128.0) as usize;

        let mut engine = ScoringEngine::new(SAMPLE_RATE);
        let mut feeder = BlockFeeder::new(SAMPLE_RATE);

        for _ in 0..blocks_per_second * 2 {
            feeder.feed(&mut engine, 220.0, 0.8);
        }
        assert!(engine.active, "engine never locked onto the note");
        assert_eq!(engine.midi_note, 57, "note misread");

        // Deterministic broadband noise at half scale: loud, and nothing a
        // pitch detector can lock onto.
        let mut rng = 0x2545_f491_4f6c_dd1d_u64;
        let mut released = false;
        let mut lowest_rms = f32::INFINITY;
        for _ in 0..blocks_per_second * 3 {
            let mut left = [0.0_f32; 128];
            let mut right = [0.0_f32; 128];
            for i in 0..128 {
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                let s = ((rng >> 40) as f32 / 8_388_608.0 - 1.0) * 0.5;
                left[i] = s;
                right[i] = s;
            }
            engine.process(&mut left, &mut right);
            lowest_rms = lowest_rms.min(engine.rms.level());
            if !engine.active {
                released = true;
                break;
            }
        }

        assert!(
            lowest_rms > GATE_THRESHOLD,
            "the signal dipped to RMS {lowest_rms} — this has to exercise the \
             above-gate path, not the silence path"
        );
        assert!(
            released,
            "three seconds of loud unpitched signal never released the tuner"
        );
        assert_eq!(
            engine.stabilizer.count, 0,
            "the ended note's frames are still in the stabilizer"
        );
        assert_eq!(
            engine.smoothed_freq, 0.0,
            "the smoothed needle was retained"
        );
    }

    /// A 12-degree scale in equal temperament: valid, and its offsets are all
    /// zero, so applying it is observable only through the return value.
    const TWELVE_TET_SCL: &str = "\
12-tone equal temperament
 12
 100.0
 200.0
 300.0
 400.0
 500.0
 600.0
 700.0
 800.0
 900.0
 1000.0
 1100.0
 1200.0
";

    /// A quarter-comma-ish scale: C is 20 cents flat, the rest 12-TET.
    const FLATTENED_C_SCL: &str = "\
C twenty cents flat
 12
 100.0
 200.0
 300.0
 400.0
 500.0
 600.0
 700.0
 800.0
 900.0
 1000.0
 1100.0
 1180.0
";

    #[test]
    fn import_scala_applies_a_twelve_degree_scale() {
        let mut instance = ScoringInstance::new(44100.0);
        assert!(instance.import_scala(TWELVE_TET_SCL), "12-TET .scl refused");
        assert!(instance.import_scala(FLATTENED_C_SCL), "valid .scl refused");
        assert!(
            (instance.engine.tuning.offsets[0] + 20.0).abs() < 0.01,
            "C offset was {}",
            instance.engine.tuning.offsets[0]
        );
    }

    /// Import has to be able to fail, and failure has to leave the instrument
    /// as it was. Before this returned a bool the caller had no way to tell a
    /// rejected file from an applied one.
    #[test]
    fn import_scala_reports_failure_and_changes_nothing() {
        let mut instance = ScoringInstance::new(44100.0);
        assert!(instance.import_scala(FLATTENED_C_SCL));
        let applied = instance.engine.tuning.offsets;

        // Thirteen degrees: the offsets table has room for twelve pitch
        // classes, so this must be refused rather than truncated.
        let thirteen = "\
13 of them
 13
 92.0
 185.0
 277.0
 369.0
 462.0
 554.0
 646.0
 738.0
 831.0
 923.0
 1015.0
 1108.0
 1200.0
";
        assert!(!instance.import_scala(thirteen), "13-degree scale accepted");
        assert!(
            !instance.import_scala("this is a text file, not a scale"),
            "garbage accepted"
        );
        assert_eq!(
            instance.engine.tuning.offsets, applied,
            "a refused import still moved the tuning"
        );
    }

    /// The reference is the player's, not the file's. A .tun that says nothing
    /// about `BaseFreq` must leave a Baroque 415 or a 432 session exactly where
    /// the player put it; resetting it to 440 retunes the whole instrument
    /// behind their back.
    ///
    /// Mutation that reds this: assign `a4_hz` unconditionally on import — the
    /// 415 and 432 rows come back reading 440.
    /// AnaMark `BaseFreq` is the frequency of MIDI note 0. The concert A it
    /// implies is `basefreq * 2^(69/12)`.
    fn base_freq_for(a4: f32) -> f32 {
        a4 / (2.0_f32).powf(69.0 / 12.0)
    }

    #[test]
    fn import_tun_without_a_base_frequency_keeps_the_current_reference() {
        // C4 ten cents flat, everything else at 12-TET.
        let tun = "; ten cents flat\n[Tuning]\nnote 60 = 5990.0\n";
        for reference in [415.0_f32, 432.0, 440.0] {
            let mut instance = ScoringInstance::new(44100.0);
            instance.set_param("a4_hz", reference);
            assert!(instance.import_tun(tun), "valid .tun refused");
            assert_eq!(
                instance.engine.tuning.a4_hz, reference,
                "import moved the reference away from {reference}"
            );
            assert!(
                (instance.engine.tuning.offsets[0] + 10.0).abs() < 0.01,
                "C offset was {}",
                instance.engine.tuning.offsets[0]
            );
        }
    }

    /// The default `BaseFreq` the format prints for a 440 Hz session is
    /// 8.1757989156, and it has to arrive as 440 — not as a clamped 400.
    #[test]
    fn import_tun_converts_the_default_base_frequency_to_concert_a() {
        let tun = "[Scale Begin]\n[Exact Tuning]\nBaseFreq = 8.1757989156\nnote 69 = 6900.0\n[Scale End]\n";
        let mut instance = ScoringInstance::new(44100.0);
        instance.set_param("a4_hz", 415.0);
        assert!(instance.import_tun(tun), "valid .tun refused");
        assert!(
            (instance.engine.tuning.a4_hz - 440.0).abs() < 0.01,
            "default BaseFreq gave a4 {}",
            instance.engine.tuning.a4_hz
        );
    }

    #[test]
    fn import_tun_applies_a_declared_base_frequency() {
        let tun = format!(
            "[Tuning]\nBaseFreq = {}\nnote 69 = 6900.0\n",
            base_freq_for(432.0)
        );
        let mut instance = ScoringInstance::new(44100.0);
        instance.set_param("a4_hz", 415.0);
        assert!(instance.import_tun(&tun), "valid .tun refused");
        assert!(
            (instance.engine.tuning.a4_hz - 432.0).abs() < 0.01,
            "read {}",
            instance.engine.tuning.a4_hz
        );
    }

    /// A `BaseFreq` whose concert A lands outside the reference range the tuner
    /// supports is not a request to move the reference to the nearest legal
    /// value — clamping it retunes a 415 or 432 session behind the player's
    /// back while reporting success. The whole import fails and nothing moves.
    ///
    /// `BaseFreq=440.0` is the decisive row: read as concert A it looks
    /// perfectly ordinary, and read correctly it is a 23.7 kHz reference.
    ///
    /// Mutation that reds this: route the reference through
    /// `set_param("a4_hz", ...)` — the import reports success and the session
    /// comes back at 490.
    #[test]
    fn import_tun_rejects_a_reference_outside_the_supported_range() {
        for base_freq in ["440.0", "0.5", "8000.0"] {
            let tun = format!("[Tuning]\nBaseFreq = {base_freq}\nnote 60 = 5990.0\n");
            let mut instance = ScoringInstance::new(44100.0);
            instance.set_param("a4_hz", 432.0);
            let untouched = instance.engine.tuning.offsets;
            assert!(
                !instance.import_tun(&tun),
                "BaseFreq={base_freq} accepted as a reference"
            );
            assert_eq!(
                instance.engine.tuning.a4_hz, 432.0,
                "BaseFreq={base_freq} moved the reference"
            );
            assert_eq!(
                instance.engine.tuning.offsets, untouched,
                "BaseFreq={base_freq} applied the offsets of a refused file"
            );
        }
    }

    #[test]
    fn import_tun_reports_failure_and_changes_nothing() {
        let mut instance = ScoringInstance::new(44100.0);
        instance.set_param("a4_hz", 432.0);
        let untouched = instance.engine.tuning.offsets;
        assert!(
            !instance.import_tun("Dear diary, today I did not tune anything."),
            "garbage accepted as a .tun"
        );
        assert_eq!(instance.engine.tuning.a4_hz, 432.0);
        assert_eq!(instance.engine.tuning.offsets, untouched);
    }
}

/// RT-safety guard: steady-state `ScoringEngine::process` (mono + poly) must
/// not allocate on the audio thread. Mirrors the daw-dsp assert_no_alloc
/// pattern.
#[cfg(all(test, debug_assertions))]
mod no_alloc_tests {
    use super::*;
    use assert_no_alloc::assert_no_alloc;
    use assert_no_alloc::AllocDisabler;
    use std::f32::consts::TAU;

    #[global_allocator]
    static ALLOCATOR: AllocDisabler = AllocDisabler;

    #[test]
    fn process_does_not_allocate_in_steady_state() {
        // Worst case: largest windows (8192) at 96 kHz, poly enabled.
        let mut engine = ScoringEngine::new(96000.0);
        engine.set_param("instrument", 0.0); // guitar standard
        engine.set_param("poly", 1.0);

        // Warm up past the first analysis/poly ticks so any lazy one-time
        // setup happens outside the guarded region.
        let mut left = [0.0_f32; 128];
        let mut right = [0.0_f32; 128];
        let mut n = 0usize;
        for _ in 0..1500 {
            for i in 0..128 {
                let s = (TAU * 82.41 * n as f32 / 96000.0).sin() * 0.8;
                left[i] = s;
                right[i] = s;
                n += 1;
            }
            engine.process(&mut left, &mut right);
        }

        // 64 callbacks cover several engine analysis ticks (hop = 3200
        // samples) and at least one poly tick (hop = 6400 samples).
        assert_no_alloc(|| {
            for _ in 0..64 {
                for i in 0..128 {
                    let s = (TAU * 82.41 * n as f32 / 96000.0).sin() * 0.8;
                    left[i] = s;
                    right[i] = s;
                    n += 1;
                }
                engine.process(&mut left, &mut right);
            }
        });
    }
}
