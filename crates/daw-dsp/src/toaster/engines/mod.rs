//! Drum synthesis engines.
//!
//! Each engine produces a monophonic drum sound from a trigger event.

pub mod clap;
pub mod cymbal;
pub mod fm_perc;
pub mod hihat;
pub mod kick;
pub mod modal;
pub mod perc;
pub mod snare;
pub mod tom;

use clap::ClapEngine;
use cymbal::CymbalEngine;
use fm_perc::FmPercEngine;
use hihat::HiHatEngine;
use kick::KickEngine;
use modal::ModalEngine;
use perc::PercEngine;
use snare::SnareEngine;
use tom::TomEngine;

/// Which synthesis algorithm a pad uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrumEngineType {
    Kick,
    Snare,
    HiHat,
    Clap,
    Perc,
    Tom,
    Cymbal,
    Modal,
    FmPerc,
    Cowbell,
    Clave,
    Shaker,
    Rim,
}

impl Default for DrumEngineType {
    fn default() -> Self {
        Self::Kick
    }
}

/// Polymorphic drum synth engine wrapping all engine types.
pub enum DrumSynthEngine {
    Kick(KickEngine),
    Snare(SnareEngine),
    HiHat(HiHatEngine),
    Clap(ClapEngine),
    Perc(PercEngine),
    Tom(TomEngine),
    Cymbal(CymbalEngine),
    Modal(ModalEngine),
    FmPerc(FmPercEngine),
    Cowbell(PercEngine),
    Clave(PercEngine),
    Shaker(PercEngine),
    Rim(PercEngine),
}

impl DrumSynthEngine {
    pub fn new(engine_type: DrumEngineType, sample_rate: f32) -> Self {
        match engine_type {
            DrumEngineType::Kick => Self::Kick(KickEngine::new(sample_rate)),
            DrumEngineType::Snare => Self::Snare(SnareEngine::new(sample_rate)),
            DrumEngineType::HiHat => Self::HiHat(HiHatEngine::new(sample_rate)),
            DrumEngineType::Clap => Self::Clap(ClapEngine::new(sample_rate)),
            DrumEngineType::Perc => Self::Perc(PercEngine::new(sample_rate)),
            DrumEngineType::Tom => Self::Tom(TomEngine::new(sample_rate)),
            DrumEngineType::Cymbal => Self::Cymbal(CymbalEngine::new(sample_rate)),
            DrumEngineType::Modal => Self::Modal(ModalEngine::new(sample_rate)),
            DrumEngineType::FmPerc => Self::FmPerc(FmPercEngine::new(sample_rate)),
            DrumEngineType::Cowbell => {
                let mut e = PercEngine::new(sample_rate);
                e.set_param("type", 0.0);
                Self::Cowbell(e)
            }
            DrumEngineType::Clave => {
                let mut e = PercEngine::new(sample_rate);
                e.set_param("type", 1.0);
                Self::Clave(e)
            }
            DrumEngineType::Shaker => {
                let mut e = PercEngine::new(sample_rate);
                e.set_param("type", 2.0);
                Self::Shaker(e)
            }
            DrumEngineType::Rim => {
                let mut e = PercEngine::new(sample_rate);
                e.set_param("type", 3.0);
                Self::Rim(e)
            }
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        match self {
            Self::Kick(e) => e.trigger(velocity, sample_rate),
            Self::Snare(e) => e.trigger(velocity, sample_rate),
            Self::HiHat(e) => e.trigger(velocity, sample_rate),
            Self::Clap(e) => e.trigger(velocity, sample_rate),
            Self::Perc(e) => e.trigger(velocity, sample_rate),
            Self::Tom(e) => e.trigger(velocity, sample_rate),
            Self::Cymbal(e) => e.trigger(velocity, sample_rate),
            Self::Modal(e) => e.trigger(velocity, sample_rate),
            Self::FmPerc(e) => e.trigger(velocity, sample_rate),
            Self::Cowbell(e) => e.trigger(velocity, sample_rate),
            Self::Clave(e) => e.trigger(velocity, sample_rate),
            Self::Shaker(e) => e.trigger(velocity, sample_rate),
            Self::Rim(e) => e.trigger(velocity, sample_rate),
        }
    }

    pub fn release(&mut self) {
        match self {
            Self::Kick(e) => e.release(),
            Self::Snare(e) => e.release(),
            Self::HiHat(e) => e.release(),
            Self::Clap(e) => e.release(),
            Self::Perc(e) => e.release(),
            Self::Tom(e) => e.release(),
            Self::Cymbal(e) => e.release(),
            Self::Modal(e) => e.release(),
            Self::FmPerc(e) => e.release(),
            Self::Cowbell(e) => e.release(),
            Self::Clave(e) => e.release(),
            Self::Shaker(e) => e.release(),
            Self::Rim(e) => e.release(),
        }
    }

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        match self {
            Self::Kick(e) => e.tick(sample_rate),
            Self::Snare(e) => e.tick(sample_rate),
            Self::HiHat(e) => e.tick(sample_rate),
            Self::Clap(e) => e.tick(sample_rate),
            Self::Perc(e) => e.tick(sample_rate),
            Self::Tom(e) => e.tick(sample_rate),
            Self::Cymbal(e) => e.tick(sample_rate),
            Self::Modal(e) => e.tick(sample_rate),
            Self::FmPerc(e) => e.tick(sample_rate),
            Self::Cowbell(e) => e.tick(sample_rate),
            Self::Clave(e) => e.tick(sample_rate),
            Self::Shaker(e) => e.tick(sample_rate),
            Self::Rim(e) => e.tick(sample_rate),
        }
    }

    pub fn is_active(&self) -> bool {
        match self {
            Self::Kick(e) => e.is_active(),
            Self::Snare(e) => e.is_active(),
            Self::HiHat(e) => e.is_active(),
            Self::Clap(e) => e.is_active(),
            Self::Perc(e) => e.is_active(),
            Self::Tom(e) => e.is_active(),
            Self::Cymbal(e) => e.is_active(),
            Self::Modal(e) => e.is_active(),
            Self::FmPerc(e) => e.is_active(),
            Self::Cowbell(e) => e.is_active(),
            Self::Clave(e) => e.is_active(),
            Self::Shaker(e) => e.is_active(),
            Self::Rim(e) => e.is_active(),
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match self {
            Self::Kick(e) => e.set_param(name, value),
            Self::Snare(e) => e.set_param(name, value),
            Self::HiHat(e) => e.set_param(name, value),
            Self::Clap(e) => e.set_param(name, value),
            Self::Perc(e) => e.set_param(name, value),
            Self::Tom(e) => e.set_param(name, value),
            Self::Cymbal(e) => e.set_param(name, value),
            Self::Modal(e) => e.set_param(name, value),
            Self::FmPerc(e) => e.set_param(name, value),
            Self::Cowbell(e) => e.set_param(name, value),
            Self::Clave(e) => e.set_param(name, value),
            Self::Shaker(e) => e.set_param(name, value),
            Self::Rim(e) => e.set_param(name, value),
        }
    }

    pub fn engine_type(&self) -> DrumEngineType {
        match self {
            Self::Kick(_) => DrumEngineType::Kick,
            Self::Snare(_) => DrumEngineType::Snare,
            Self::HiHat(_) => DrumEngineType::HiHat,
            Self::Clap(_) => DrumEngineType::Clap,
            Self::Perc(_) => DrumEngineType::Perc,
            Self::Tom(_) => DrumEngineType::Tom,
            Self::Cymbal(_) => DrumEngineType::Cymbal,
            Self::Modal(_) => DrumEngineType::Modal,
            Self::FmPerc(_) => DrumEngineType::FmPerc,
            Self::Cowbell(_) => DrumEngineType::Cowbell,
            Self::Clave(_) => DrumEngineType::Clave,
            Self::Shaker(_) => DrumEngineType::Shaker,
            Self::Rim(_) => DrumEngineType::Rim,
        }
    }
}
