//! GrinderEngine — top-level amp simulator orchestrator.
//!
//! Signal flow: Input → Gate → Pre-Pedals → Preamp → Tone Stack →
//! FX Loop → Power Amp → Transformer → Cabinet → Speaker → Post FX → Output

use super::input::{InputConditioner, NoiseGate};
use super::triode::Preamp;
use super::tone_stack::ToneStack;
use super::power_amp::PowerAmp;
use super::transformer::Transformer;
use super::cabinet::{CabinetConvolver, SpeakerModel};
use super::pedals::{OverdrivePedal, DistortionPedal, FuzzPedal, CompressorPedal, DelayPedal, ReverbPedal};
use super::neural::NeuralCapture;
use super::params::{SmoothedParam, db_to_linear, linear_to_db};

#[allow(dead_code)]
pub struct GrinderEngine {
    sample_rate: f32,

    // Signal chain
    input_cond: InputConditioner,
    gate: NoiseGate,
    preamp: Preamp,
    tone_stack: ToneStack,
    power_amp: PowerAmp,
    transformer: Transformer,
    cabinet: CabinetConvolver,
    speaker: SpeakerModel,
    neural: NeuralCapture,

    // Pedals
    pre_od: OverdrivePedal,
    pre_dist: DistortionPedal,
    pre_fuzz: FuzzPedal,
    pre_comp: CompressorPedal,
    fx_delay: DelayPedal,
    fx_reverb: ReverbPedal,

    // Output
    output_gain: SmoothedParam,
    output_mix: SmoothedParam,
    clean_blend: SmoothedParam,
    limiter_threshold: f32,
    limiter_enabled: bool,

    // FX loop
    fx_loop_enabled: bool,
    fx_loop_mix: f32,

    // Metering
    input_peak: f32,
    preamp_peak: f32,
    power_amp_peak: f32,
    output_peak: f32,
}

impl GrinderEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut cab = CabinetConvolver::new();
        cab.load_builtin(0); // Default 4x12 cabinet

        Self {
            sample_rate,
            input_cond: InputConditioner::new(sample_rate),
            gate: NoiseGate::new(sample_rate),
            preamp: Preamp::new(sample_rate),
            tone_stack: ToneStack::new(sample_rate),
            power_amp: PowerAmp::new(sample_rate),
            transformer: Transformer::new(sample_rate),
            cabinet: cab,
            speaker: SpeakerModel::new(sample_rate),
            neural: NeuralCapture::new(),
            pre_od: OverdrivePedal::new(sample_rate),
            pre_dist: DistortionPedal::new(sample_rate),
            pre_fuzz: FuzzPedal::new(sample_rate),
            pre_comp: CompressorPedal::new(sample_rate),
            fx_delay: DelayPedal::new(sample_rate),
            fx_reverb: ReverbPedal::new(sample_rate),
            output_gain: SmoothedParam::new(1.0, 5.0, sample_rate),
            output_mix: SmoothedParam::new(1.0, 5.0, sample_rate),
            clean_blend: SmoothedParam::new(0.0, 5.0, sample_rate),
            limiter_threshold: db_to_linear(-0.3),
            limiter_enabled: true,
            fx_loop_enabled: false,
            fx_loop_mix: 1.0,
            input_peak: 0.0,
            preamp_peak: 0.0,
            power_amp_peak: 0.0,
            output_peak: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            // Input
            "inputGain" | "inputImpedance" | "inputMode" => self.input_cond.set_param(name, value),

            // Gate
            "gateEnabled" | "gateThreshold" | "gateAttack" | "gateRelease" => self.gate.set_param(name, value),

            // Preamp
            "gain" | "channel" | "bright" | "fat" |
            "tubeBias" | "tubeAge" | "millerCapacitance" | "gridConduction" | "couplingCapCharge" |
            "ampModel" => self.preamp.set_param(name, value),

            // Tone stack
            "toneStackType" | "bass" | "mid" | "treble" | "brightCap" => self.tone_stack.set_param(name, value),

            // Power amp
            "master" | "powerTubeType" | "rectifierType" |
            "sagAmount" | "sagRecovery" | "negFeedback" | "powerAmpBias" => self.power_amp.set_param(name, value),

            // Presence/Resonance (power amp negative feedback EQ)
            "presence" | "resonance" => {
                // These map to power amp NFB characteristics
                self.power_amp.set_param(name, value);
            }

            // Transformer
            "transformerDrive" | "transformerHysteresis" | "transformerLfSaturation" => self.transformer.set_param(name, value),

            // Cabinet
            "cabEnabled" => self.cabinet.set_enabled(value > 0.5),
            "cabResonanceFreq" | "cabResonanceQ" | "cabDamping" | "cabOpenBack" |
            "coneBreakup" | "backEmf" => self.speaker.set_param(name, value),

            // FX loop
            "fxLoopEnabled" => self.fx_loop_enabled = value > 0.5,
            "fxLoopMix" => self.fx_loop_mix = value,

            // Neural
            "neuralEnabled" | "neuralMix" | "neuralTier" | "neuralCpuBudget" => self.neural.set_param(name, value),

            // Output
            "outputGain" => self.output_gain.set_target(db_to_linear(value)),
            "outputMix" => self.output_mix.set_target(value),
            "cleanBlend" => self.clean_blend.set_target(value),
            "limiterEnabled" => self.limiter_enabled = value > 0.5,
            "limiterThreshold" => self.limiter_threshold = db_to_linear(value),

            _ => {}
        }
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        let len = left.len().min(right.len());

        for i in 0..len {
            let dry = left[i];

            // Mono processing (guitar is typically mono until cab/effects)
            let mut signal = (left[i] + right[i]) * 0.5;

            // Input conditioning
            signal = self.input_cond.process_sample(signal);

            // Update input peak
            let in_peak = signal.abs();
            if in_peak > self.input_peak { self.input_peak = in_peak; } else { self.input_peak *= 0.9999; }

            // Noise gate
            signal = self.gate.process_sample(signal);

            // Pre-amp pedals
            signal = self.pre_comp.process_sample(signal);
            signal = self.pre_od.process_sample(signal);
            signal = self.pre_dist.process_sample(signal);
            signal = self.pre_fuzz.process_sample(signal);

            // Preamp
            signal = self.preamp.process_sample(signal);

            // Update preamp peak
            let pre_peak = signal.abs();
            if pre_peak > self.preamp_peak { self.preamp_peak = pre_peak; } else { self.preamp_peak *= 0.9999; }

            // Tone stack
            signal = self.tone_stack.process_sample(signal);

            // FX Loop
            if self.fx_loop_enabled {
                let fx_dry = signal;
                signal = self.fx_delay.process_sample(signal);
                signal = self.fx_reverb.process_sample(signal);
                signal = fx_dry * (1.0 - self.fx_loop_mix) + signal * self.fx_loop_mix;
            }

            // Neural capture (can replace or blend with circuit model)
            signal = self.neural.process_sample(signal);

            // Power amp (with back-EMF from speaker)
            let back_emf = self.speaker.back_emf();
            signal = self.power_amp.process_sample(signal + back_emf * 0.1);

            // Transformer
            signal = self.transformer.process_sample(signal);

            // Update power amp peak
            let pa_peak = signal.abs();
            if pa_peak > self.power_amp_peak { self.power_amp_peak = pa_peak; } else { self.power_amp_peak *= 0.9999; }

            // Cabinet (convolution)
            signal = self.cabinet.process_sample(signal);

            // Speaker model (parametric resonance + breakup)
            signal = self.speaker.process_sample(signal);

            // Output processing
            let og = self.output_gain.next();
            let mix = self.output_mix.next();
            let clean = self.clean_blend.next();

            signal *= og;

            // Clean blend (DI blending)
            signal = signal * (1.0 - clean) + dry * clean;

            // Wet/dry mix
            signal = dry * (1.0 - mix) + signal * mix;

            // Safety limiter
            if self.limiter_enabled {
                if signal.abs() > self.limiter_threshold {
                    signal = signal.signum() * self.limiter_threshold;
                }
            }

            // Stereo output (cab processing creates slight stereo from mic positioning)
            left[i] = signal;
            right[i] = signal;

            // Update output peak
            let out_peak = signal.abs();
            if out_peak > self.output_peak { self.output_peak = out_peak; } else { self.output_peak *= 0.9999; }
        }
    }

    pub fn input_db(&self) -> f32 { linear_to_db(self.input_peak) }
    pub fn preamp_db(&self) -> f32 { linear_to_db(self.preamp_peak) }
    pub fn power_amp_db(&self) -> f32 { linear_to_db(self.power_amp_peak) }
    pub fn output_db(&self) -> f32 { linear_to_db(self.output_peak) }
    pub fn sag_voltage(&self) -> f32 { self.power_amp.sag_voltage() }
    pub fn latency_samples(&self) -> u32 { 0 }
}
