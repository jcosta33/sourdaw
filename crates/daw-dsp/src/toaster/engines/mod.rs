//! Drum synthesis engines.
//!
//! Each engine produces a monophonic drum sound from a trigger event.

pub mod kick;
pub mod snare;
pub mod hihat;
pub mod clap;
pub mod perc;
pub mod tom;
pub mod cymbal;
pub mod modal;
pub mod fm_perc;

use kick::KickEngine;
use snare::SnareEngine;
use hihat::HiHatEngine;
use clap::ClapEngine;
use perc::PercEngine;
use tom::TomEngine;
use cymbal::CymbalEngine;
use modal::ModalEngine;
use fm_perc::FmPercEngine;

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
        }
    }
}
