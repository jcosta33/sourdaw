//! Drum synthesis engines.
//!
//! Each engine produces a monophonic drum sound from a trigger event.

pub mod clap;
pub mod clap_808;
pub mod clap_909;
pub mod cr78;
pub mod cymbal;
pub mod fm_perc;
pub mod hihat;
pub mod hihat_808;
pub mod hihat_909;
pub mod kick;
pub mod kick_808;
pub mod kick_909;
pub mod lfsr;
pub mod modal;
pub mod perc;
pub mod perc_808;
pub mod snare;
pub mod snare_808;
pub mod tom;
pub mod tom_808;

use clap::ClapEngine;
use clap_808::Clap808Engine;
use clap_909::Clap909Engine;
use cr78::Cr78Engine;
use cymbal::CymbalEngine;
use fm_perc::FmPercEngine;
use hihat::HiHatEngine;
use hihat_808::HiHat808Engine;
use hihat_909::{HiHat909Buffer, HiHat909Engine};
use kick::KickEngine;
use kick_808::Kick808Engine;
use kick_909::Kick909Engine;
use modal::ModalEngine;
use perc::PercEngine;
use perc_808::{Perc808Engine, Perc808Mode};
use snare::SnareEngine;
use snare_808::Snare808Engine;
use tom::TomEngine;
use tom_808::{Tom808Engine, TomVariant};

/// Which synthesis algorithm a pad uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum DrumEngineType {
    // Existing generic engines (unchanged)
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
    // New circuit-faithful engines
    Kick808,
    Kick909,
    Snare808,
    HiHat808,
    HiHat909,
    Clap808,
    Clap909,
    Tom808Low,
    Tom808Mid,
    Tom808High,
    Cowbell808,
    Clave808,
    Rimshot808,
    Maracas808,
    Cr78Drum,
    Cr78Metallic,
}

impl DrumEngineType {
    pub const COUNT: usize = 29;
    pub const ALL: [Self; Self::COUNT] = [
        Self::Kick,
        Self::Snare,
        Self::HiHat,
        Self::Clap,
        Self::Perc,
        Self::Tom,
        Self::Cymbal,
        Self::Modal,
        Self::FmPerc,
        Self::Cowbell,
        Self::Clave,
        Self::Shaker,
        Self::Rim,
        Self::Kick808,
        Self::Kick909,
        Self::Snare808,
        Self::HiHat808,
        Self::HiHat909,
        Self::Clap808,
        Self::Clap909,
        Self::Tom808Low,
        Self::Tom808Mid,
        Self::Tom808High,
        Self::Cowbell808,
        Self::Clave808,
        Self::Rimshot808,
        Self::Maracas808,
        Self::Cr78Drum,
        Self::Cr78Metallic,
    ];

    pub const fn index(self) -> usize {
        self as usize
    }
}

impl Default for DrumEngineType {
    fn default() -> Self {
        Self::Kick
    }
}

/// Polymorphic drum synth engine wrapping all engine types.
pub enum DrumSynthEngine {
    // Existing generic engines
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
    // New circuit-faithful engines
    Kick808(Kick808Engine),
    Kick909(Kick909Engine),
    Snare808(Snare808Engine),
    HiHat808(HiHat808Engine),
    HiHat909(HiHat909Engine),
    Clap808(Clap808Engine),
    Clap909(Clap909Engine),
    Tom808Low(Tom808Engine),
    Tom808Mid(Tom808Engine),
    Tom808High(Tom808Engine),
    Cowbell808(Perc808Engine),
    Clave808(Perc808Engine),
    Rimshot808(Perc808Engine),
    Maracas808(Perc808Engine),
    Cr78Drum(Cr78Engine),
    Cr78Metallic(Cr78Engine),
}

pub struct DrumEngineResources {
    hihat_909_buffer: HiHat909Buffer,
}

impl DrumEngineResources {
    pub fn new() -> Self {
        Self {
            hihat_909_buffer: HiHat909Engine::generate_buffer(),
        }
    }
}

impl DrumSynthEngine {
    pub fn new(engine_type: DrumEngineType, sample_rate: f32) -> Self {
        match engine_type {
            // Existing generic engines
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
            // New circuit-faithful engines
            DrumEngineType::Kick808 => Self::Kick808(Kick808Engine::new(sample_rate)),
            DrumEngineType::Kick909 => Self::Kick909(Kick909Engine::new(sample_rate)),
            DrumEngineType::Snare808 => Self::Snare808(Snare808Engine::new(sample_rate)),
            DrumEngineType::HiHat808 => Self::HiHat808(HiHat808Engine::new(sample_rate)),
            DrumEngineType::HiHat909 => Self::HiHat909(HiHat909Engine::new(sample_rate)),
            DrumEngineType::Clap808 => Self::Clap808(Clap808Engine::new(sample_rate)),
            DrumEngineType::Clap909 => Self::Clap909(Clap909Engine::new(sample_rate)),
            DrumEngineType::Tom808Low => {
                Self::Tom808Low(Tom808Engine::new(sample_rate, TomVariant::Low))
            }
            DrumEngineType::Tom808Mid => {
                Self::Tom808Mid(Tom808Engine::new(sample_rate, TomVariant::Mid))
            }
            DrumEngineType::Tom808High => {
                Self::Tom808High(Tom808Engine::new(sample_rate, TomVariant::High))
            }
            DrumEngineType::Cowbell808 => {
                Self::Cowbell808(Perc808Engine::new(sample_rate, Perc808Mode::Cowbell))
            }
            DrumEngineType::Clave808 => {
                Self::Clave808(Perc808Engine::new(sample_rate, Perc808Mode::Clave))
            }
            DrumEngineType::Rimshot808 => {
                Self::Rimshot808(Perc808Engine::new(sample_rate, Perc808Mode::Rimshot))
            }
            DrumEngineType::Maracas808 => {
                Self::Maracas808(Perc808Engine::new(sample_rate, Perc808Mode::Maracas))
            }
            DrumEngineType::Cr78Drum => {
                Self::Cr78Drum(Cr78Engine::new_drum(sample_rate))
            }
            DrumEngineType::Cr78Metallic => {
                Self::Cr78Metallic(Cr78Engine::new_metallic(sample_rate))
            }
        }
    }

    pub fn new_with_resources(
        engine_type: DrumEngineType,
        sample_rate: f32,
        resources: &DrumEngineResources,
    ) -> Self {
        if engine_type == DrumEngineType::HiHat909 {
            return Self::HiHat909(HiHat909Engine::with_buffer(
                sample_rate,
                resources.hihat_909_buffer.clone(),
            ));
        }

        Self::new(engine_type, sample_rate)
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
            Self::Kick808(e) => e.trigger(velocity, sample_rate),
            Self::Kick909(e) => e.trigger(velocity, sample_rate),
            Self::Snare808(e) => e.trigger(velocity, sample_rate),
            Self::HiHat808(e) => e.trigger(velocity, sample_rate),
            Self::HiHat909(e) => e.trigger(velocity, sample_rate),
            Self::Clap808(e) => e.trigger(velocity, sample_rate),
            Self::Clap909(e) => e.trigger(velocity, sample_rate),
            Self::Tom808Low(e) => e.trigger(velocity, sample_rate),
            Self::Tom808Mid(e) => e.trigger(velocity, sample_rate),
            Self::Tom808High(e) => e.trigger(velocity, sample_rate),
            Self::Cowbell808(e) => e.trigger(velocity, sample_rate),
            Self::Clave808(e) => e.trigger(velocity, sample_rate),
            Self::Rimshot808(e) => e.trigger(velocity, sample_rate),
            Self::Maracas808(e) => e.trigger(velocity, sample_rate),
            Self::Cr78Drum(e) => e.trigger(velocity, sample_rate),
            Self::Cr78Metallic(e) => e.trigger(velocity, sample_rate),
        }
    }

    pub fn reset_base_freq(&mut self) {
        match self {
            Self::Kick(engine) => engine.reset_base_freq(),
            Self::Tom(engine) => engine.reset_base_freq(),
            Self::FmPerc(engine) => engine.reset_base_freq(),
            Self::Perc(engine)
            | Self::Cowbell(engine)
            | Self::Clave(engine)
            | Self::Shaker(engine)
            | Self::Rim(engine) => engine.reset_base_freq(),
            _ => {}
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
            Self::Kick808(e) => e.release(),
            Self::Kick909(e) => e.release(),
            Self::Snare808(e) => e.release(),
            Self::HiHat808(e) => e.release(),
            Self::HiHat909(e) => e.release(),
            Self::Clap808(e) => e.release(),
            Self::Clap909(e) => e.release(),
            Self::Tom808Low(e) => e.release(),
            Self::Tom808Mid(e) => e.release(),
            Self::Tom808High(e) => e.release(),
            Self::Cowbell808(e) => e.release(),
            Self::Clave808(e) => e.release(),
            Self::Rimshot808(e) => e.release(),
            Self::Maracas808(e) => e.release(),
            Self::Cr78Drum(e) => e.release(),
            Self::Cr78Metallic(e) => e.release(),
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
            Self::Kick808(e) => e.tick(sample_rate),
            Self::Kick909(e) => e.tick(sample_rate),
            Self::Snare808(e) => e.tick(sample_rate),
            Self::HiHat808(e) => e.tick(sample_rate),
            Self::HiHat909(e) => e.tick(sample_rate),
            Self::Clap808(e) => e.tick(sample_rate),
            Self::Clap909(e) => e.tick(sample_rate),
            Self::Tom808Low(e) => e.tick(sample_rate),
            Self::Tom808Mid(e) => e.tick(sample_rate),
            Self::Tom808High(e) => e.tick(sample_rate),
            Self::Cowbell808(e) => e.tick(sample_rate),
            Self::Clave808(e) => e.tick(sample_rate),
            Self::Rimshot808(e) => e.tick(sample_rate),
            Self::Maracas808(e) => e.tick(sample_rate),
            Self::Cr78Drum(e) => e.tick(sample_rate),
            Self::Cr78Metallic(e) => e.tick(sample_rate),
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
            Self::Kick808(e) => e.is_active(),
            Self::Kick909(e) => e.is_active(),
            Self::Snare808(e) => e.is_active(),
            Self::HiHat808(e) => e.is_active(),
            Self::HiHat909(e) => e.is_active(),
            Self::Clap808(e) => e.is_active(),
            Self::Clap909(e) => e.is_active(),
            Self::Tom808Low(e) => e.is_active(),
            Self::Tom808Mid(e) => e.is_active(),
            Self::Tom808High(e) => e.is_active(),
            Self::Cowbell808(e) => e.is_active(),
            Self::Clave808(e) => e.is_active(),
            Self::Rimshot808(e) => e.is_active(),
            Self::Maracas808(e) => e.is_active(),
            Self::Cr78Drum(e) => e.is_active(),
            Self::Cr78Metallic(e) => e.is_active(),
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
            Self::Kick808(e) => e.set_param(name, value),
            Self::Kick909(e) => e.set_param(name, value),
            Self::Snare808(e) => e.set_param(name, value),
            Self::HiHat808(e) => e.set_param(name, value),
            Self::HiHat909(e) => e.set_param(name, value),
            Self::Clap808(e) => e.set_param(name, value),
            Self::Clap909(e) => e.set_param(name, value),
            Self::Tom808Low(e) => e.set_param(name, value),
            Self::Tom808Mid(e) => e.set_param(name, value),
            Self::Tom808High(e) => e.set_param(name, value),
            Self::Cowbell808(e) => e.set_param(name, value),
            Self::Clave808(e) => e.set_param(name, value),
            Self::Rimshot808(e) => e.set_param(name, value),
            Self::Maracas808(e) => e.set_param(name, value),
            Self::Cr78Drum(e) => e.set_param(name, value),
            Self::Cr78Metallic(e) => e.set_param(name, value),
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
            Self::Kick808(_) => DrumEngineType::Kick808,
            Self::Kick909(_) => DrumEngineType::Kick909,
            Self::Snare808(_) => DrumEngineType::Snare808,
            Self::HiHat808(_) => DrumEngineType::HiHat808,
            Self::HiHat909(_) => DrumEngineType::HiHat909,
            Self::Clap808(_) => DrumEngineType::Clap808,
            Self::Clap909(_) => DrumEngineType::Clap909,
            Self::Tom808Low(_) => DrumEngineType::Tom808Low,
            Self::Tom808Mid(_) => DrumEngineType::Tom808Mid,
            Self::Tom808High(_) => DrumEngineType::Tom808High,
            Self::Cowbell808(_) => DrumEngineType::Cowbell808,
            Self::Clave808(_) => DrumEngineType::Clave808,
            Self::Rimshot808(_) => DrumEngineType::Rimshot808,
            Self::Maracas808(_) => DrumEngineType::Maracas808,
            Self::Cr78Drum(_) => DrumEngineType::Cr78Drum,
            Self::Cr78Metallic(_) => DrumEngineType::Cr78Metallic,
        }
    }
}
