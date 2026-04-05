//! GrinderEngine — top-level amp simulator orchestrator.
//!
//! Signal flow: Input → Gate → Pre-Pedals → Preamp → Tone Stack →
//! Power Amp → Transformer → Cabinet → Speaker → Output

use super::cabinet::{CabinetConvolver, SpeakerModel};
use super::input::{InputConditioner, NoiseGate};
use super::neural::{CapturePlacement, EngineMode, NeuralCapture};
use super::params::{db_to_linear, linear_to_db, SmoothedParam};
use super::pedals::{CompressorPedal, DistortionPedal, FuzzPedal, OverdrivePedal};
use super::power_amp::PowerAmp;
use super::tone_stack::ToneStack;
use super::transformer::Transformer;
use super::triode::Preamp;

#[allow(dead_code)]
pub struct GrinderEngine {
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
    // Output
    output_gain: SmoothedParam,
    output_mix: SmoothedParam,
    clean_blend: SmoothedParam,
    limiter_threshold: f32,
    limiter_enabled: bool,
    bypassed: bool,

    // Metering
    meter_decay_coeff: f32,
    input_peak: f32,
    preamp_peak: f32,
    power_amp_peak: f32,
    output_peak: f32,
}

impl GrinderEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut cab = CabinetConvolver::new(sample_rate);
        cab.load_builtin(0); // Default 4x12 cabinet

        let meter_decay_coeff = (-1.0 / (sample_rate * 0.150)).exp();

        Self {
            input_cond: InputConditioner::new(sample_rate),
            gate: NoiseGate::new(sample_rate),
            preamp: Preamp::new(sample_rate),
            tone_stack: ToneStack::new(sample_rate),
            power_amp: PowerAmp::new(sample_rate),
            transformer: Transformer::new(sample_rate),
            cabinet: cab,
            speaker: SpeakerModel::new(sample_rate),
            neural: NeuralCapture::new(sample_rate),
            pre_od: OverdrivePedal::new(sample_rate),
            pre_dist: DistortionPedal::new(sample_rate),
            pre_fuzz: FuzzPedal::new(sample_rate),
            pre_comp: CompressorPedal::new(sample_rate),
            output_gain: SmoothedParam::new(1.0, 5.0, sample_rate),
            output_mix: SmoothedParam::new(1.0, 5.0, sample_rate),
            clean_blend: SmoothedParam::new(0.0, 5.0, sample_rate),
            limiter_threshold: db_to_linear(-0.3),
            limiter_enabled: true,
            bypassed: false,
            meter_decay_coeff,
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
            "gateEnabled" | "gateThreshold" | "gateAttack" | "gateRelease" => {
                self.gate.set_param(name, value)
            }

            // Preamp
            "gain" | "channel" | "bright" | "fat" | "tubeBias" | "tubeAge"
            | "millerCapacitance" | "gridConduction" | "couplingCapCharge" | "ampModel" => {
                self.preamp.set_param(name, value)
            }

            // Tone stack
            "toneStackType" | "bass" | "mid" | "treble" | "brightCap" => {
                self.tone_stack.set_param(name, value)
            }

            // Power amp
            "master" | "powerTubeType" | "rectifierType" | "sagAmount" | "sagRecovery"
            | "negFeedback" | "powerAmpBias" => self.power_amp.set_param(name, value),

            // Presence/Resonance (power amp negative feedback EQ)
            "presence" | "resonance" => {
                // These map to power amp NFB characteristics
                self.power_amp.set_param(name, value);
            }

            // Transformer
            "transformerDrive" | "transformerHysteresis" | "transformerLfSaturation" => {
                self.transformer.set_param(name, value)
            }

            // Cabinet
            "cabEnabled" => self.cabinet.set_enabled(value > 0.5),
            "cabResonanceFreq" | "cabResonanceQ" | "cabDamping" | "cabOpenBack" | "coneBreakup"
            | "backEmf" => self.speaker.set_param(name, value),

            // Neural
            "engineMode" | "neuralEnabled" | "neuralPlacement" | "neuralMix" | "neuralTier"
            | "neuralCpuBudget" => self.neural.set_param(name, value),

            // Output
            "outputGain" => self.output_gain.set_target(db_to_linear(value)),
            "outputMix" => self.output_mix.set_target(value),
            "cleanBlend" => self.clean_blend.set_target(value),
            "limiterEnabled" => self.limiter_enabled = value > 0.5,
            "limiterThreshold" => self.limiter_threshold = db_to_linear(value),
            "bypass" => self.bypassed = value > 0.5,

            _ => {
                if let Some(pedal_param) = name.strip_prefix("preCompressor") {
                    if let Some(mapped) = map_prefixed_pedal_param(pedal_param) {
                        self.pre_comp.set_param(mapped, value);
                    }
                } else if let Some(pedal_param) = name.strip_prefix("preOverdrive") {
                    if let Some(mapped) = map_prefixed_pedal_param(pedal_param) {
                        self.pre_od.set_param(mapped, value);
                    }
                } else if let Some(pedal_param) = name.strip_prefix("preDistortion") {
                    if let Some(mapped) = map_prefixed_pedal_param(pedal_param) {
                        self.pre_dist.set_param(mapped, value);
                    }
                } else if let Some(pedal_param) = name.strip_prefix("preFuzz") {
                    if let Some(mapped) = map_prefixed_pedal_param(pedal_param) {
                        self.pre_fuzz.set_param(mapped, value);
                    }
                }
            }
        }
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            return;
        }

        let len = left.len().min(right.len());

        for i in 0..len {
            let dry = left[i];

            // Mono processing (guitar is typically mono until cab/effects)
            let mut signal = (left[i] + right[i]) * 0.5;

            // Input conditioning
            signal = self.input_cond.process_sample(signal);

            // Update input peak
            let in_peak = signal.abs();
            if in_peak > self.input_peak {
                self.input_peak = in_peak;
            } else {
                self.input_peak *= self.meter_decay_coeff;
            }

            // Noise gate
            signal = self.gate.process_sample(signal);

            // Pre-amp pedals
            signal = self.pre_comp.process_sample(signal);
            signal = self.pre_od.process_sample(signal);
            signal = self.pre_dist.process_sample(signal);
            signal = self.pre_fuzz.process_sample(signal);

            let amp_input = signal;
            let circuit_preamp = self.preamp.process_sample(amp_input);
            let circuit_amp = self.tone_stack.process_sample(circuit_preamp);
            let neural_capture = self.neural.process_capture(amp_input);
            let neural_mode = self.neural.engine_mode();
            let neural_mix = self.neural.mix();
            let neural_placement = self.neural.placement();

            let mut rig_capture_signal = None;
            signal = match (neural_mode, neural_placement) {
                (EngineMode::Circuit, _) => circuit_amp,
                (EngineMode::Capture, CapturePlacement::Amp) => neural_capture,
                (EngineMode::Capture, CapturePlacement::Rig) => {
                    rig_capture_signal = Some(neural_capture);
                    neural_capture
                }
                (EngineMode::Hybrid, CapturePlacement::Amp) => {
                    circuit_amp * (1.0 - neural_mix) + neural_capture * neural_mix
                }
                (EngineMode::Hybrid, CapturePlacement::Rig) => {
                    rig_capture_signal = Some(neural_capture);
                    circuit_amp
                }
            };

            let pre_peak = signal.abs();
            if pre_peak > self.preamp_peak {
                self.preamp_peak = pre_peak;
            } else {
                self.preamp_peak *= self.meter_decay_coeff;
            }

            let should_run_circuit_rig = !matches!(
                (neural_mode, neural_placement),
                (EngineMode::Capture, CapturePlacement::Rig)
            );
            if should_run_circuit_rig {
                let back_emf = self.speaker.back_emf();
                signal = self.power_amp.process_sample(signal + back_emf * 0.1);
                signal = self.transformer.process_sample(signal);

                let pa_peak = signal.abs();
                if pa_peak > self.power_amp_peak {
                    self.power_amp_peak = pa_peak;
                } else {
                    self.power_amp_peak *= self.meter_decay_coeff;
                }

                signal = self.cabinet.process_sample(signal);
                signal = self.speaker.process_sample(signal);
            } else {
                self.power_amp_peak *= self.meter_decay_coeff;
            }

            if neural_mode == EngineMode::Hybrid && neural_placement == CapturePlacement::Rig {
                if let Some(rig_capture) = rig_capture_signal {
                    signal = signal * (1.0 - neural_mix) + rig_capture * neural_mix;
                }
            }

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
                signal = soft_limit_sample(signal, self.limiter_threshold);
            }

            // Stereo output (cab processing creates slight stereo from mic positioning)
            left[i] = signal;
            right[i] = signal;

            // Update output peak
            let out_peak = signal.abs();
            if out_peak > self.output_peak {
                self.output_peak = out_peak;
            } else {
                self.output_peak *= self.meter_decay_coeff;
            }
        }
    }

    pub fn input_db(&self) -> f32 {
        linear_to_db(self.input_peak)
    }
    pub fn preamp_db(&self) -> f32 {
        linear_to_db(self.preamp_peak)
    }
    pub fn power_amp_db(&self) -> f32 {
        linear_to_db(self.power_amp_peak)
    }
    pub fn output_db(&self) -> f32 {
        linear_to_db(self.output_peak)
    }
    pub fn sag_voltage(&self) -> f32 {
        self.power_amp.sag_voltage()
    }
    pub fn latency_samples(&self) -> u32 {
        self.neural.latency_samples()
    }
    pub fn gate_open(&self) -> f32 {
        self.gate.gain()
    }
    pub fn gate_envelope_db(&self) -> f32 {
        self.gate.envelope_db()
    }
    pub fn neural_cpu_percent(&self) -> f32 {
        self.neural.cpu_percent()
    }
    pub fn neural_warmup_progress(&self) -> f32 {
        self.neural.warmup_progress()
    }
}

fn soft_limit_sample(input: f32, threshold: f32) -> f32 {
    let threshold = threshold.clamp(1.0e-4, 0.999);
    let abs_input = input.abs();
    if abs_input <= threshold {
        return input;
    }

    let sign = input.signum();
    let excess = (abs_input - threshold) / (1.0 - threshold).max(1.0e-4);
    let compressed = threshold + (1.0 - (-2.5 * excess).exp()) * (1.0 - threshold);
    sign * compressed.min(1.0)
}

fn map_prefixed_pedal_param(name: &str) -> Option<&'static str> {
    match name {
        "Enabled" => Some("enabled"),
        "Drive" => Some("drive"),
        "Tone" => Some("tone"),
        "Level" => Some("level"),
        "Threshold" => Some("threshold"),
        "Ratio" => Some("ratio"),
        "Attack" => Some("attack"),
        "Release" => Some("release"),
        "Fuzz" => Some("fuzz"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::GrinderEngine;

    fn average_abs_output_for_channel(channel: u32, gain: f32) -> f32 {
        let mut engine = GrinderEngine::new(48_000.0);
        engine.set_param("channel", channel as f32);
        engine.set_param("gain", gain);
        engine.set_param("master", 6.0);

        let total = 4096;
        let mut left = vec![0.0_f32; total];
        let mut right = vec![0.0_f32; total];

        for n in 0..total {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0;
            let sample = phase.sin() * 0.15;
            left[n] = sample;
            right[n] = sample;
        }

        engine.process_block(&mut left, &mut right);

        left.iter().map(|sample| sample.abs()).sum::<f32>() / total as f32
    }

    fn average_abs_output_for_silence(power_tube_type: f32) -> f32 {
        let mut engine = GrinderEngine::new(48_000.0);
        engine.set_param("powerTubeType", power_tube_type);
        engine.set_param("channel", 2.0);
        engine.set_param("gain", 8.0);
        engine.set_param("master", 6.0);

        let total = 4096;
        let mut left = vec![0.0_f32; total];
        let mut right = vec![0.0_f32; total];

        engine.process_block(&mut left, &mut right);

        left.iter().map(|sample| sample.abs()).sum::<f32>() / total as f32
    }

    #[test]
    fn crunch_channel_is_not_effectively_muted() {
        let clean = average_abs_output_for_channel(0, 4.0);
        let crunch = average_abs_output_for_channel(1, 6.0);

        assert!(clean > 1.0e-3, "clean channel should produce output");
        assert!(
            crunch > clean * 0.25,
            "crunch channel should remain in a usable loudness range (clean={clean}, crunch={crunch})"
        );
    }

    #[test]
    fn lead_channel_is_not_effectively_muted() {
        let clean = average_abs_output_for_channel(0, 4.0);
        let lead = average_abs_output_for_channel(2, 8.0);

        assert!(clean > 1.0e-3, "clean channel should produce output");
        assert!(
            lead > clean * 0.25,
            "lead channel should remain in a usable loudness range (clean={clean}, lead={lead})"
        );
    }

    #[test]
    fn silence_does_not_self_oscillate_across_power_tube_types() {
        let six_l6 = average_abs_output_for_silence(0.0);
        let el34 = average_abs_output_for_silence(1.0);
        let el84 = average_abs_output_for_silence(2.0);

        assert!(
            six_l6 < 1.0e-4,
            "6L6 should stay near silence, got {six_l6}"
        );
        assert!(el34 < 1.0e-4, "EL34 should stay near silence, got {el34}");
        assert!(el84 < 1.0e-4, "EL84 should stay near silence, got {el84}");
    }

    #[test]
    fn prefixed_pedal_params_affect_the_live_signal_path() {
        let mut dry_engine = GrinderEngine::new(48_000.0);
        dry_engine.set_param("channel", 1.0);
        dry_engine.set_param("gain", 6.0);
        dry_engine.set_param("master", 5.0);

        let mut driven_engine = GrinderEngine::new(48_000.0);
        driven_engine.set_param("channel", 1.0);
        driven_engine.set_param("gain", 6.0);
        driven_engine.set_param("master", 5.0);
        driven_engine.set_param("preOverdriveEnabled", 1.0);
        driven_engine.set_param("preOverdriveDrive", 4.0);
        driven_engine.set_param("preOverdriveTone", 6.0);
        driven_engine.set_param("preOverdriveLevel", 7.0);
        driven_engine.set_param("preCompressorEnabled", 1.0);
        driven_engine.set_param("preCompressorThreshold", -26.0);
        driven_engine.set_param("preCompressorRatio", 3.0);
        driven_engine.set_param("preCompressorAttack", 18.0);
        driven_engine.set_param("preCompressorRelease", 180.0);

        let total = 4096;
        let mut dry_left = vec![0.0_f32; total];
        let mut dry_right = vec![0.0_f32; total];
        let mut driven_left = vec![0.0_f32; total];
        let mut driven_right = vec![0.0_f32; total];

        for n in 0..total {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0;
            let sample = phase.sin() * 0.1;
            dry_left[n] = sample;
            dry_right[n] = sample;
            driven_left[n] = sample;
            driven_right[n] = sample;
        }

        dry_engine.process_block(&mut dry_left, &mut dry_right);
        driven_engine.process_block(&mut driven_left, &mut driven_right);

        let dry_avg = dry_left.iter().map(|sample| sample.abs()).sum::<f32>() / total as f32;
        let driven_avg = driven_left.iter().map(|sample| sample.abs()).sum::<f32>() / total as f32;

        assert!(
            (driven_avg - dry_avg).abs() > 1.0e-3,
            "prefixed pedal params should audibly change output (dry={dry_avg}, driven={driven_avg})"
        );
    }
}
