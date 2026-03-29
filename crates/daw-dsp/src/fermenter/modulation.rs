/// Modulation matrix — flat slot-based architecture.
/// Phase 1: hardwired routes (env→filter, LFO→pitch).
/// Future: full user-configurable mod matrix.

pub const MAX_MOD_SLOTS: usize = 32;

#[derive(Clone, Copy)]
pub struct ModSlot {
    pub source: ModSource,
    pub dest: ModDest,
    pub amount: f32,
    pub enabled: bool,
}

#[derive(Clone, Copy, PartialEq)]
pub enum ModSource {
    None,
    AmpEnv,
    FilterEnv,
    Lfo1,
    Lfo2,
    Velocity,
    Mseg,
    StepSeq,
}

#[derive(Clone, Copy, PartialEq)]
pub enum ModDest {
    None,
    FilterCutoff,
    FilterResonance,
    OscPitch,
    OscLevel,
    ReverbMix,
}

#[derive(Clone)]
pub struct ModMatrix {
    pub slots: [ModSlot; MAX_MOD_SLOTS],
    pub active_count: usize,
}

impl ModMatrix {
    pub fn new() -> Self {
        let empty = ModSlot {
            source: ModSource::None,
            dest: ModDest::None,
            amount: 0.0,
            enabled: false,
        };
        let mut matrix = Self {
            slots: [empty; MAX_MOD_SLOTS],
            active_count: 0,
        };

        // Default hardwired routes
        matrix.slots[0] = ModSlot {
            source: ModSource::FilterEnv,
            dest: ModDest::FilterCutoff,
            amount: 0.5,
            enabled: true,
        };
        matrix.slots[1] = ModSlot {
            source: ModSource::Lfo1,
            dest: ModDest::OscPitch,
            amount: 0.0, // Off by default
            enabled: true,
        };
        matrix.active_count = 2;

        matrix
    }

    /// Evaluate all active slots and accumulate contributions.
    /// Returns (filter_cutoff_mod, filter_res_mod, pitch_mod, level_mod, reverb_mod).
    pub fn evaluate(
        &self,
        amp_env: f32,
        filter_env: f32,
        lfo1: f32,
        lfo2: f32,
        velocity: f32,
        mseg: f32,
        step_seq: f32,
    ) -> ModOutput {
        let mut out = ModOutput::default();

        for i in 0..self.active_count {
            let slot = &self.slots[i];
            if !slot.enabled || slot.amount.abs() < 1e-6 { continue; }

            let source_val = match slot.source {
                ModSource::None => 0.0,
                ModSource::AmpEnv => amp_env,
                ModSource::FilterEnv => filter_env,
                ModSource::Lfo1 => lfo1,
                ModSource::Lfo2 => lfo2,
                ModSource::Velocity => velocity,
                ModSource::Mseg => mseg,
                ModSource::StepSeq => step_seq,
            };

            let contrib = source_val * slot.amount;

            match slot.dest {
                ModDest::None => {}
                ModDest::FilterCutoff => out.filter_cutoff += contrib,
                ModDest::FilterResonance => out.filter_resonance += contrib,
                ModDest::OscPitch => out.pitch += contrib,
                ModDest::OscLevel => out.level += contrib,
                ModDest::ReverbMix => out.reverb_mix += contrib,
            }
        }

        out
    }
}

#[derive(Default, Clone, Copy)]
pub struct ModOutput {
    pub filter_cutoff: f32,
    pub filter_resonance: f32,
    pub pitch: f32,
    pub level: f32,
    pub reverb_mix: f32,
}
