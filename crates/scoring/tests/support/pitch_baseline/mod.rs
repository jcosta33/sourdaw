// Frozen test-only source oracle from cdf56ae23082998f2f3be0264309ca2c6025dee2.
// Captured before the shared-pitch extraction; never used by production.
#![allow(dead_code)]

//! Scoring — Sourdaw's reference-grade chromatic tuner.
//!
//! Peterson-level strobe precision (±0.1 cent), polyphonic string detection,
//! multiple tuning systems. Analyzer plugin: audio passes through unchanged,
//! pitch telemetry sent to UI via shared state.

pub mod mpm;
pub mod poly;
pub use scoring::preprocess;
pub use scoring::scala;
pub use scoring::tone;
pub use scoring::tuning;
pub mod yin;

use mpm::MpmDetector;
use poly::PolyStringTracker;
use preprocess::{normalize, Bandpass, DcBlocker, RmsTracker};
use tone::ToneGenerator;
use tuning::TuningSystem;
use tuning::{A4_MIDI_NOTE, SEMITONES_PER_OCTAVE};
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
    scale_name: String,
}

impl ScoringInstance {
    pub fn process(&mut self, left_in: &[f32], right_in: &[f32], frames: u32) -> *const f32 {
        let size = (frames as usize).min(1024);
        self.out_left[..size].copy_from_slice(&left_in[..size]);
        self.out_right[..size].copy_from_slice(&right_in[..size]);
        self.process_outputs(size)
    }

    fn process_outputs(&mut self, size: usize) -> *const f32 {
        self.engine
            .process(&mut self.out_left[..size], &mut self.out_right[..size]);
        self.nan_flush_count += sanitize_block(&mut self.out_left[..size]) as u64;
        self.nan_flush_count += sanitize_block(&mut self.out_right[..size]) as u64;
        self.out_left.as_ptr()
    }
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
            scale_name: String::new(),
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        self.engine.set_param(name, value);
    }

    #[wasm_bindgen(js_name = process)]
    pub fn process_in_place(&mut self, frames: u32) -> *const f32 {
        let size = (frames as usize).min(1024);
        self.process_outputs(size)
    }

    pub fn get_left_ptr(&mut self) -> *mut f32 {
        self.out_left.as_mut_ptr()
    }

    /// Number of non-finite output samples scrubbed to silence since
    /// construction (DSP-8). Non-zero means a poisoned block was caught at the
    /// wasm output boundary and surfaced for health telemetry.
    pub fn get_nan_flush_count(&self) -> f64 {
        self.nan_flush_count as f64
    }

    pub fn get_right_ptr(&mut self) -> *mut f32 {
        self.out_right.as_mut_ptr()
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
        let desc = scale.description();
        self.scale_name = if desc.is_empty() {
            "Scala scale".to_string()
        } else {
            desc.to_string()
        };
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
                let a4 = base_freq * (2.0_f32).powf(A4_MIDI_NOTE / SEMITONES_PER_OCTAVE);
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
        self.scale_name = "AnaMark tuning".to_string();
        true
    }

    #[wasm_bindgen]
    pub fn scale_description(&self) -> String {
        self.scale_name.clone()
    }
}
