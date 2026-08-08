//! Pad configuration for a single drum pad in the Toaster drum machine.

use super::engines::DrumEngineType;
use crate::primitives::{normalized_cutoff_from_hz, normalized_resonance_from_q};

/// One drum pad's configuration. Does not contain DSP state —
/// that lives in the voice. This is purely parameter storage.
pub struct Pad {
    pub engine_type: DrumEngineType,
    pub choke_group: u8, // 0 = none, 1-16 = group
    pub volume: f32,
    pub pan: f32, // -1 (left) to +1 (right)
    pub muted: bool,
    pub tune: f32,              // semitones
    pub decay: f32,             // 0-1 normalized
    pub tone: f32,              // 0-1 normalized
    pub drive: f32,             // 0-10
    pub filter_cutoff: f32,     // 0-1 normalized
    pub filter_resonance: f32,  // 0-1 normalized
    pub send_reverb: f32,       // 0-1
    pub send_delay: f32,        // 0-1
    pub transient_attack: f32,  // 0-2, 1 = unity
    pub transient_sustain: f32, // 0-2, 1 = unity
    pub bus_route: u8,          // 0 = master direct, 1-4 = bus 1-4

    // Engine-specific parameters that must survive voice recycling
    pub snappy: f32,
    pub noise_color: f32,
    pub base_freq: f32,
    pub pitch_amount: f32,
    pub pitch_decay: f32,
    pub noise_level: f32,
    pub mod_ratio: Option<f32>,
    pub mod_amount: Option<f32>,
    pub feedback: Option<f32>,
    pub is_open: bool,
}

impl Pad {
    pub fn new(engine_type: DrumEngineType) -> Self {
        Self {
            engine_type,
            choke_group: 0,
            volume: 0.8,
            pan: 0.0,
            muted: false,
            tune: 0.0,
            decay: 0.5,
            tone: 0.5,
            drive: 0.0,
            filter_cutoff: 1.0,
            filter_resonance: 0.0,
            send_reverb: 0.0,
            send_delay: 0.0,
            transient_attack: 1.0,
            transient_sustain: 1.0,
            bus_route: 0,
            snappy: 0.5,
            noise_color: 0.5,
            base_freq: 0.0, // 0 means default
            pitch_amount: 0.5,
            pitch_decay: 0.05,
            noise_level: 0.2,
            mod_ratio: None,
            mod_amount: None,
            feedback: None,
            is_open: false,
        }
    }

    fn reset_engine_params(&mut self) {
        self.snappy = 0.5;
        self.noise_color = 0.5;
        self.base_freq = 0.0;
        self.pitch_amount = 0.5;
        self.pitch_decay = 0.05;
        self.noise_level = 0.2;
        self.mod_ratio = None;
        self.mod_amount = None;
        self.feedback = None;
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "volume" => self.volume = value.clamp(0.0, 1.0),
            "pan" => self.pan = value.clamp(-1.0, 1.0),
            "muted" => self.muted = value > 0.5,
            "tune" => self.tune = value.clamp(-24.0, 24.0),
            "decay" => self.decay = value.clamp(0.0, 1.0),
            "tone" => self.tone = value.clamp(0.0, 1.0),
            "drive" => self.drive = value.clamp(0.0, 10.0),
            "filter_cutoff" => {
                // Accept the 20-20000 Hz range `ToasterKit.filterCutoff` carries,
                // normalize to 0-1. `SvfFilter::tick` re-expands with the exact
                // inverse; both directions live in `primitives::cutoff`.
                self.filter_cutoff = normalized_cutoff_from_hz(value);
            }
            "filter_resonance" => {
                // Accept the 0.5-20 Q range `ToasterKit.filterResonance` carries,
                // normalize to 0-1. `SvfFilter::tick` re-expands with the exact
                // inverse; both directions live in `primitives::resonance`.
                self.filter_resonance = normalized_resonance_from_q(value);
            }
            "send_reverb" => self.send_reverb = value.clamp(0.0, 1.0),
            "send_delay" => self.send_delay = value.clamp(0.0, 1.0),
            "choke_group" => self.choke_group = (value as u8).min(16),
            "transient_attack" => self.transient_attack = value.clamp(0.0, 2.0),
            "transient_sustain" => self.transient_sustain = value.clamp(0.0, 2.0),
            "bus_route" => self.bus_route = (value as u8).min(4),
            "engine_type" => {
                self.engine_type = match value as u32 {
                    // Generic engines (legacy / non-808 voices)
                    0 => DrumEngineType::Kick,
                    1 => DrumEngineType::Snare,
                    2 => DrumEngineType::HiHat,
                    3 => DrumEngineType::Clap,
                    4 => DrumEngineType::Perc,
                    5 => DrumEngineType::Tom,
                    6 => DrumEngineType::Cymbal,
                    7 => DrumEngineType::Modal,
                    8 => DrumEngineType::FmPerc,
                    9 => DrumEngineType::Cowbell,
                    10 => DrumEngineType::Clave,
                    11 => DrumEngineType::Shaker,
                    12 => DrumEngineType::Rim,
                    // Circuit-faithful engines
                    13 => DrumEngineType::Kick808,
                    14 => DrumEngineType::Kick909,
                    15 => DrumEngineType::Snare808,
                    16 => DrumEngineType::HiHat808,
                    17 => DrumEngineType::HiHat909,
                    18 => DrumEngineType::Clap808,
                    19 => DrumEngineType::Clap909,
                    20 => DrumEngineType::Tom808Low,
                    21 => DrumEngineType::Tom808Mid,
                    22 => DrumEngineType::Tom808High,
                    23 => DrumEngineType::Cowbell808,
                    24 => DrumEngineType::Clave808,
                    25 => DrumEngineType::Rimshot808,
                    26 => DrumEngineType::Maracas808,
                    27 => DrumEngineType::Cr78Drum,
                    28 => DrumEngineType::Cr78Metallic,
                    _ => DrumEngineType::Kick,
                };
                self.reset_engine_params();
            }
            "snappy" => self.snappy = value.clamp(0.0, 1.0),
            "noise_color" => self.noise_color = value.clamp(0.0, 1.0),
            "base_freq" => {
                self.base_freq = if value > 1.0 {
                    value.clamp(20.0, 8000.0)
                } else {
                    0.0
                };
            }
            "pitch_amount" => self.pitch_amount = value.clamp(0.0, 2.0),
            "pitch_decay" => self.pitch_decay = value.clamp(0.0, 1.0),
            "noise_level" => self.noise_level = value.clamp(0.0, 2.0),
            "mod_ratio" => self.mod_ratio = Some(value.clamp(0.5, 16.0)),
            "mod_amount" => self.mod_amount = Some(value.clamp(0.0, 8.0)),
            "feedback" => self.feedback = Some(value.clamp(0.0, 1.0)),
            "open" => self.is_open = value > 0.5,
            _ => {}
        }
    }
}
