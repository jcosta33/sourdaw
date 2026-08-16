//! GrinderEngine — top-level amp simulator orchestrator.
//!
//! Signal flow: Input → Gate → Pre-Pedals → Preamp → Tone Stack →
//! Power Amp → Transformer → Cabinet → Speaker → Output

use super::cabinet::{CabinetConvolver, SpeakerModel};
use super::input::{InputConditioner, NoiseGate};
use super::neural::{CapturePlacement, EngineMode, NeuralCapture};
use super::params::{
    db_to_linear, get_automatable_param_index, linear_to_db, SmoothedParam,
    GRINDER_AUTOMATABLE_PARAM_CONTRACT, GRINDER_AUTOMATABLE_PARAM_COUNT,
};
use super::pedals::{CompressorPedal, DistortionPedal, FuzzPedal, OverdrivePedal};
use super::power_amp::PowerAmp;
use super::tone_stack::ToneStack;
use super::transformer::Transformer;
use super::triode::Preamp;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SupportedPedalSlot {
    Compressor,
    Overdrive,
    Distortion,
    Fuzz,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CabinetMode {
    Ir,
    Parametric,
    Both,
}

impl CabinetMode {
    fn from_index(index: u32) -> Self {
        match index {
            0 => Self::Ir,
            1 => Self::Parametric,
            _ => Self::Both,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RoutingMode {
    Serial,
    Parallel,
    WetDryWet,
    DualAmp,
}

impl RoutingMode {
    fn from_index(index: u32) -> Self {
        match index {
            1 => Self::Parallel,
            2 => Self::WetDryWet,
            3 => Self::DualAmp,
            _ => Self::Serial,
        }
    }
}

impl SupportedPedalSlot {
    fn index(self) -> usize {
        match self {
            Self::Compressor => 0,
            Self::Overdrive => 1,
            Self::Distortion => 2,
            Self::Fuzz => 3,
        }
    }
}

const DEFAULT_SUPPORTED_PEDAL_ORDER: [SupportedPedalSlot; 4] = [
    SupportedPedalSlot::Compressor,
    SupportedPedalSlot::Overdrive,
    SupportedPedalSlot::Distortion,
    SupportedPedalSlot::Fuzz,
];

#[allow(dead_code)]
pub struct GrinderEngine {
    // Signal chain
    input_cond: InputConditioner,
    gate: NoiseGate,
    preamp: Preamp,
    tone_stack: ToneStack,
    power_amp: PowerAmp,
    dual_power_amp: PowerAmp,
    transformer: Transformer,
    dual_transformer: Transformer,
    cabinet: CabinetConvolver,
    dual_cabinet: CabinetConvolver,
    speaker: SpeakerModel,
    dual_speaker: SpeakerModel,
    neural: NeuralCapture,

    // Pedals
    pre_od: OverdrivePedal,
    pre_dist: DistortionPedal,
    pre_fuzz: FuzzPedal,
    pre_comp: CompressorPedal,

    post_od: OverdrivePedal,
    post_dist: DistortionPedal,
    post_fuzz: FuzzPedal,
    post_comp: CompressorPedal,
    pre_pedal_order: [SupportedPedalSlot; 4],
    pre_pedal_order_values: [f32; 4],
    post_pedal_order: [SupportedPedalSlot; 4],
    post_pedal_order_values: [f32; 4],

    // Output
    output_gain: SmoothedParam,
    output_mix: SmoothedParam,
    clean_blend: SmoothedParam,
    fat_enabled: bool,
    fat_low_state: f32,
    fat_low_coeff: f32,
    limiter_threshold: f32,
    limiter_enabled: bool,
    bypassed: bool,
    cabinet_mode: CabinetMode,
    routing_mode: RoutingMode,
    cab_ir_slot: u32,

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
        let mut dual_cab = CabinetConvolver::new(sample_rate);
        dual_cab.load_builtin(1);

        let meter_decay_coeff = (-1.0 / (sample_rate * 0.150)).exp();

        let mut engine = Self {
            input_cond: InputConditioner::new(sample_rate),
            gate: NoiseGate::new(sample_rate),
            preamp: Preamp::new(sample_rate),
            tone_stack: ToneStack::new(sample_rate),
            power_amp: PowerAmp::new(sample_rate),
            dual_power_amp: PowerAmp::new(sample_rate),
            transformer: Transformer::new(sample_rate),
            dual_transformer: Transformer::new(sample_rate),
            cabinet: cab,
            dual_cabinet: dual_cab,
            speaker: SpeakerModel::new(sample_rate),
            dual_speaker: SpeakerModel::new(sample_rate),
            neural: NeuralCapture::new(sample_rate),
            pre_od: OverdrivePedal::new(sample_rate),
            pre_dist: DistortionPedal::new(sample_rate),
            pre_fuzz: FuzzPedal::new(sample_rate),
            pre_comp: CompressorPedal::new(sample_rate),
            post_od: OverdrivePedal::new(sample_rate),
            post_dist: DistortionPedal::new(sample_rate),
            post_fuzz: FuzzPedal::new(sample_rate),
            post_comp: CompressorPedal::new(sample_rate),
            pre_pedal_order: DEFAULT_SUPPORTED_PEDAL_ORDER,
            pre_pedal_order_values: [0.0, 1.0, 2.0, 3.0],
            post_pedal_order: DEFAULT_SUPPORTED_PEDAL_ORDER,
            post_pedal_order_values: [0.0, 1.0, 2.0, 3.0],
            output_gain: SmoothedParam::new(1.0, 5.0, sample_rate),
            output_mix: SmoothedParam::new(1.0, 5.0, sample_rate),
            clean_blend: SmoothedParam::new(0.0, 5.0, sample_rate),
            fat_enabled: false,
            fat_low_state: 0.0,
            fat_low_coeff: (2.0 * std::f32::consts::PI * 180.0 / sample_rate).min(0.35),
            limiter_threshold: db_to_linear(-0.3),
            limiter_enabled: true,
            bypassed: false,
            cabinet_mode: CabinetMode::Both,
            routing_mode: RoutingMode::Serial,
            cab_ir_slot: 0,
            meter_decay_coeff,
            input_peak: 0.0,
            preamp_peak: 0.0,
            power_amp_peak: 0.0,
            output_peak: 0.0,
        };
        engine.refresh_dual_branch_variation();
        engine
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        if let Some(index) = get_automatable_param_index(name) {
            self.set_automatable_param(index, value);
            return;
        }

        match name {
            // Input
            "inputImpedance" | "inputMode" => self.input_cond.set_param(name, value),

            // Gate
            "gateEnabled" | "gateThreshold" | "gateAttack" | "gateRelease" => {
                self.gate.set_param(name, value)
            }

            // Preamp
            "channel" | "bright" | "tubeBias" | "tubeAge" | "millerCapacitance"
            | "gridConduction" | "couplingCapCharge" | "ampModel" => {
                self.preamp.set_param(name, value)
            }
            "fat" => self.fat_enabled = value > 0.5,

            // Tone stack
            "toneStackType" | "brightCap" => self.tone_stack.set_param(name, value),

            // Power amp
            "powerTubeType" | "rectifierType" | "sagAmount" | "sagRecovery" | "powerAmpBias" => {
                self.power_amp.set_param(name, value);
                self.dual_power_amp.set_param(name, value);
                self.refresh_dual_branch_variation();
            }

            // Transformer
            "transformerHysteresis" | "transformerLfSaturation" => {
                self.transformer.set_param(name, value);
                self.dual_transformer.set_param(name, value);
            }

            // Cabinet
            "cabType" => self.cabinet_mode = CabinetMode::from_index(value.round().max(0.0) as u32),
            "routingMode" => {
                let next = RoutingMode::from_index(value.round().max(0.0) as u32);
                // The dual chain only runs under DualAmp, so its state froze
                // at whatever the last DualAmp sample left behind. Clear it on
                // entry or that stale energy replays as a pop.
                if next == RoutingMode::DualAmp && self.routing_mode != RoutingMode::DualAmp {
                    self.dual_power_amp.reset();
                    self.dual_transformer.reset();
                    self.dual_speaker.reset();
                    self.dual_cabinet.reset();
                }
                self.routing_mode = next;
            }
            "cabIrSlot" => {
                self.cab_ir_slot = value.round().max(0.0) as u32;
                self.cabinet.load_builtin(self.cab_ir_slot);
                self.refresh_dual_branch_variation();
            }
            "cabEnabled" => {
                let enabled = value > 0.5;
                self.cabinet.set_enabled(enabled);
                self.dual_cabinet.set_enabled(enabled);
                // The parametric speaker is a cabinet stage too: without this
                // the toggle is inaudible in Parametric and Both cab modes.
                self.speaker.set_enabled(enabled);
                self.dual_speaker.set_enabled(enabled);
            }
            "mic1Enabled" | "mic1Gain" | "mic1PositionX" | "mic1PositionY" | "mic1Distance"
            | "mic2Enabled" | "mic2Gain" | "mic2PositionX" | "mic2PositionY" | "mic2Distance"
            | "micBlend" | "roomAmount" => {
                self.cabinet.set_param(name, value);
                self.dual_cabinet.set_param(name, value);
            }
            "cabResonanceFreq" | "cabResonanceQ" | "cabDamping" | "cabOpenBack" | "coneBreakup"
            | "backEmf" => {
                self.speaker.set_param(name, value);
                self.dual_speaker.set_param(name, value);
            }

            // Neural
            "engineMode" => {
                let was_capture = self.neural.engine_mode() == EngineMode::Capture;
                self.neural.set_param(name, value);
                // Capture mode skips the circuit preamp and tone stack, so
                // their filter state froze on entry. Clear it when the circuit
                // path comes back or the stale memory replays as a pop.
                if was_capture && self.neural.engine_mode() != EngineMode::Capture {
                    self.preamp.reset();
                    self.tone_stack.reset();
                }
            }
            "neuralEnabled" | "neuralPlacement" | "neuralMix" | "neuralTier"
            | "neuralCpuBudget" | "neuralModelSlot" | "neuralModelMode" => {
                self.neural.set_param(name, value);
            }

            // Imported/custom neural-capture profile, including the indexed
            // neuralCustomConvWeight{layer}_{idx} family parsed inside
            // NeuralCapture. These used to fall into the pedal-prefix `_` arm
            // and were silently discarded, killing the whole custom-profile
            // (capture import) feature end-to-end.
            name if name.starts_with("neuralCustom") => self.neural.set_param(name, value),

            // Supported pedal ordering
            "preCompressorOrder"
            | "preOverdriveOrder"
            | "preDistortionOrder"
            | "preFuzzOrder"
            | "postCompressorOrder"
            | "postOverdriveOrder"
            | "postDistortionOrder"
            | "postFuzzOrder" => self.set_supported_pedal_order(name, value),

            // Output
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
                } else if let Some(pedal_param) = name.strip_prefix("postCompressor") {
                    if let Some(mapped) = map_prefixed_pedal_param(pedal_param) {
                        self.post_comp.set_param(mapped, value);
                    }
                } else if let Some(pedal_param) = name.strip_prefix("postOverdrive") {
                    if let Some(mapped) = map_prefixed_pedal_param(pedal_param) {
                        self.post_od.set_param(mapped, value);
                    }
                } else if let Some(pedal_param) = name.strip_prefix("postDistortion") {
                    if let Some(mapped) = map_prefixed_pedal_param(pedal_param) {
                        self.post_dist.set_param(mapped, value);
                    }
                } else if let Some(pedal_param) = name.strip_prefix("postFuzz") {
                    if let Some(mapped) = map_prefixed_pedal_param(pedal_param) {
                        self.post_fuzz.set_param(mapped, value);
                    }
                }
            }
        }
    }

    fn set_automatable_param(&mut self, index: usize, value: f32) {
        let Some(value) = GRINDER_AUTOMATABLE_PARAM_CONTRACT
            .get(index)
            .and_then(|param| param.clamp(value))
        else {
            return;
        };

        match index {
            0 => self.preamp.set_param("gain", value),
            1 => self.tone_stack.set_param("bass", value),
            2 => self.tone_stack.set_param("mid", value),
            3 => self.tone_stack.set_param("treble", value),
            4 => {
                self.power_amp.set_param("presence", value);
                self.dual_power_amp.set_param("presence", value);
            }
            5 => {
                self.power_amp.set_param("resonance", value);
                self.dual_power_amp.set_param("resonance", value);
            }
            6 => {
                self.power_amp.set_param("master", value);
                self.dual_power_amp.set_param("master", value);
            }
            7 => self.input_cond.set_param("inputGain", value),
            8 => self.output_gain.set_target(db_to_linear(value)),
            9 => {
                self.transformer.set_param("transformerDrive", value);
                self.dual_transformer.set_param("transformerDrive", value);
            }
            10 => {
                self.power_amp.set_param("negFeedback", value);
                self.dual_power_amp.set_param("negFeedback", value);
            }
            _ => {}
        }
    }

    fn apply_automatable_constants(&mut self, automation: &[f32], stride: usize) {
        for index in 0..GRINDER_AUTOMATABLE_PARAM_COUNT {
            if automation.get(index).copied().unwrap_or_default() != 1.0 {
                continue;
            }
            let value_index = GRINDER_AUTOMATABLE_PARAM_COUNT + index * stride;
            if let Some(value) = automation.get(value_index).copied() {
                self.set_automatable_param(index, value);
            }
        }
    }

    fn apply_automatable_frame(&mut self, automation: &[f32], stride: usize, frame: usize) {
        for index in 0..GRINDER_AUTOMATABLE_PARAM_COUNT {
            let value_count = automation.get(index).copied().unwrap_or_default() as usize;
            if value_count <= 1 || frame >= value_count {
                continue;
            }
            let value_index = GRINDER_AUTOMATABLE_PARAM_COUNT + index * stride + frame;
            if let Some(value) = automation.get(value_index).copied() {
                self.set_automatable_param(index, value);
            }
        }
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.process_block_inner(left, right, &[], 0);
    }

    pub fn process_block_automated(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        automation: &[f32],
        stride: usize,
    ) {
        self.process_block_inner(left, right, automation, stride);
    }

    fn process_block_inner(
        &mut self,
        left: &mut [f32],
        right: &mut [f32],
        automation: &[f32],
        stride: usize,
    ) {
        let has_automation = !automation.is_empty() && stride > 0;
        if has_automation {
            self.apply_automatable_constants(automation, stride);
        }

        if self.bypassed {
            if has_automation {
                let last_frame = left.len().min(right.len()).saturating_sub(1);
                self.apply_automatable_frame(automation, stride, last_frame);
            }
            return;
        }

        let len = left.len().min(right.len());

        for i in 0..len {
            if has_automation {
                self.apply_automatable_frame(automation, stride, i);
            }
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
            signal = self.process_supported_pedal_chain(signal, false);

            let amp_input = signal;
            let neural_mode = self.neural.engine_mode();
            let neural_mix = self.neural.mix();
            let neural_placement = self.neural.placement();

            // The circuit preamp and tone stack only reach the output in
            // Circuit and Hybrid modes. Capture mode replaces them outright,
            // so running them there is pure audio-thread cost for a value the
            // selector below discards.
            let circuit_amp = if neural_mode == EngineMode::Capture {
                0.0
            } else {
                let circuit_preamp = self.preamp.process_sample(amp_input);
                self.tone_stack.process_sample(circuit_preamp)
            };
            let neural_capture = self.neural.process_capture(amp_input);

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
                let primary_back_emf = self.speaker.back_emf();
                let primary_power = self
                    .power_amp
                    .process_sample(signal + primary_back_emf * 0.1);
                let primary_transformer = self.transformer.process_sample(primary_power);

                // Only DualAmp routing reads the second amp chain. Every other
                // routing mode used to run a whole extra power amp and output
                // transformer per sample and throw the result away.
                let dual_transformer = if self.routing_mode == RoutingMode::DualAmp {
                    let dual_back_emf = self.dual_speaker.back_emf();
                    let dual_power = self
                        .dual_power_amp
                        .process_sample(signal * 0.94 + dual_back_emf * 0.08);
                    self.dual_transformer.process_sample(dual_power)
                } else {
                    0.0
                };

                let pa_peak = primary_transformer.abs().max(dual_transformer.abs());
                if pa_peak > self.power_amp_peak {
                    self.power_amp_peak = pa_peak;
                } else {
                    self.power_amp_peak *= self.meter_decay_coeff;
                }

                signal = self.process_routed_cab_path(primary_transformer, dual_transformer);

                // Post-amp pedals
                signal = self.process_supported_pedal_chain(signal, true);
            } else {
                self.power_amp_peak *= self.meter_decay_coeff;
            }

            if neural_mode == EngineMode::Hybrid && neural_placement == CapturePlacement::Rig {
                if let Some(rig_capture) = rig_capture_signal {
                    signal = signal * (1.0 - neural_mix) + rig_capture * neural_mix;
                }
            }

            // Fat is final output voicing, not extra drive into one engine
            // branch. Apply it after circuit/capture selection and blending so
            // the same reachable control works in Circuit, Capture, and Hybrid.
            self.fat_low_state += self.fat_low_coeff * (signal - self.fat_low_state);
            if self.fat_enabled {
                signal += self.fat_low_state * 0.22;
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

    /// Clear every stage's runtime state. Parameters and routing survive;
    /// filter memories, envelopes, ring buffers and meters do not — so a
    /// relocated playhead does not inherit the tail of the previous position.
    pub fn reset(&mut self) {
        self.input_cond.reset();
        self.gate.reset();
        self.preamp.reset();
        self.tone_stack.reset();
        self.power_amp.reset();
        self.dual_power_amp.reset();
        self.transformer.reset();
        self.dual_transformer.reset();
        self.cabinet.reset();
        self.dual_cabinet.reset();
        self.speaker.reset();
        self.dual_speaker.reset();
        self.neural.reset();

        self.pre_od.reset();
        self.pre_dist.reset();
        self.pre_fuzz.reset();
        self.pre_comp.reset();
        self.post_od.reset();
        self.post_dist.reset();
        self.post_fuzz.reset();
        self.post_comp.reset();

        self.fat_low_state = 0.0;
        self.input_peak = 0.0;
        self.preamp_peak = 0.0;
        self.power_amp_peak = 0.0;
        self.output_peak = 0.0;
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

    fn set_supported_pedal_order(&mut self, name: &str, value: f32) {
        let Some((is_post, pedal_slot)) = map_supported_pedal_order_param(name) else {
            return;
        };

        let order_values = if is_post {
            &mut self.post_pedal_order_values
        } else {
            &mut self.pre_pedal_order_values
        };
        order_values[pedal_slot.index()] = value.clamp(0.0, 3.0);

        let rebuilt_order = rebuild_supported_pedal_order(*order_values);
        if is_post {
            self.post_pedal_order = rebuilt_order;
        } else {
            self.pre_pedal_order = rebuilt_order;
        }
    }

    fn process_supported_pedal_chain(&mut self, mut signal: f32, is_post: bool) -> f32 {
        let pedal_order = if is_post {
            self.post_pedal_order
        } else {
            self.pre_pedal_order
        };

        for pedal_slot in pedal_order {
            signal = match (is_post, pedal_slot) {
                (false, SupportedPedalSlot::Compressor) => self.pre_comp.process_sample(signal),
                (false, SupportedPedalSlot::Overdrive) => self.pre_od.process_sample(signal),
                (false, SupportedPedalSlot::Distortion) => self.pre_dist.process_sample(signal),
                (false, SupportedPedalSlot::Fuzz) => self.pre_fuzz.process_sample(signal),
                (true, SupportedPedalSlot::Compressor) => self.post_comp.process_sample(signal),
                (true, SupportedPedalSlot::Overdrive) => self.post_od.process_sample(signal),
                (true, SupportedPedalSlot::Distortion) => self.post_dist.process_sample(signal),
                (true, SupportedPedalSlot::Fuzz) => self.post_fuzz.process_sample(signal),
            };
        }

        signal
    }

    fn refresh_dual_branch_variation(&mut self) {
        let alternate_power_tube = match self.cab_ir_slot % 3 {
            0 => 1.0,
            1 => 2.0,
            _ => 0.0,
        };
        self.dual_power_amp
            .set_param("powerTubeType", alternate_power_tube);
        self.dual_cabinet.load_builtin((self.cab_ir_slot + 1) % 3);
    }

    fn process_routed_cab_path(&mut self, primary_transformer: f32, dual_transformer: f32) -> f32 {
        match self.routing_mode {
            RoutingMode::Serial => self.process_selected_cab_path(primary_transformer, false),
            RoutingMode::Parallel => match self.cabinet_mode {
                CabinetMode::Ir => {
                    let ir = self.process_ir_branch(primary_transformer, false);
                    ir * 0.72 + primary_transformer * 0.28
                }
                CabinetMode::Parametric => {
                    let parametric = self.process_parametric_branch(primary_transformer, false);
                    parametric * 0.72 + primary_transformer * 0.28
                }
                CabinetMode::Both => {
                    let ir = self.process_ir_branch(primary_transformer, false);
                    let parametric = self.process_parametric_branch(primary_transformer, false);
                    ir * 0.52 + parametric * 0.48
                }
            },
            RoutingMode::WetDryWet => match self.cabinet_mode {
                CabinetMode::Ir => {
                    let ir = self.process_ir_branch(primary_transformer, false);
                    primary_transformer * 0.22 + ir * 0.78
                }
                CabinetMode::Parametric => {
                    let parametric = self.process_parametric_branch(primary_transformer, false);
                    primary_transformer * 0.22 + parametric * 0.78
                }
                CabinetMode::Both => {
                    let ir = self.process_ir_branch(primary_transformer, false);
                    let parametric = self.process_parametric_branch(primary_transformer, false);
                    primary_transformer * 0.18 + ir * 0.41 + parametric * 0.41
                }
            },
            RoutingMode::DualAmp => {
                let primary = self.process_selected_cab_path(primary_transformer, false);
                let secondary = self.process_selected_cab_path(dual_transformer, true);
                primary * 0.58 + secondary * 0.42
            }
        }
    }

    fn process_selected_cab_path(&mut self, input: f32, use_dual: bool) -> f32 {
        match self.cabinet_mode {
            CabinetMode::Ir => self.process_ir_branch(input, use_dual),
            CabinetMode::Parametric => self.process_parametric_branch(input, use_dual),
            CabinetMode::Both => {
                let ir = self.process_ir_branch(input, use_dual);
                self.process_parametric_branch(ir, use_dual)
            }
        }
    }

    fn process_ir_branch(&mut self, input: f32, use_dual: bool) -> f32 {
        if use_dual {
            self.dual_cabinet.process_sample(input)
        } else {
            self.cabinet.process_sample(input)
        }
    }

    fn process_parametric_branch(&mut self, input: f32, use_dual: bool) -> f32 {
        if use_dual {
            self.dual_speaker.process_sample(input)
        } else {
            self.speaker.process_sample(input)
        }
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

fn map_supported_pedal_order_param(name: &str) -> Option<(bool, SupportedPedalSlot)> {
    match name {
        "preCompressorOrder" => Some((false, SupportedPedalSlot::Compressor)),
        "preOverdriveOrder" => Some((false, SupportedPedalSlot::Overdrive)),
        "preDistortionOrder" => Some((false, SupportedPedalSlot::Distortion)),
        "preFuzzOrder" => Some((false, SupportedPedalSlot::Fuzz)),
        "postCompressorOrder" => Some((true, SupportedPedalSlot::Compressor)),
        "postOverdriveOrder" => Some((true, SupportedPedalSlot::Overdrive)),
        "postDistortionOrder" => Some((true, SupportedPedalSlot::Distortion)),
        "postFuzzOrder" => Some((true, SupportedPedalSlot::Fuzz)),
        _ => None,
    }
}

fn rebuild_supported_pedal_order(order_values: [f32; 4]) -> [SupportedPedalSlot; 4] {
    let mut ordered = [
        (
            SupportedPedalSlot::Compressor,
            order_values[SupportedPedalSlot::Compressor.index()],
            0_usize,
        ),
        (
            SupportedPedalSlot::Overdrive,
            order_values[SupportedPedalSlot::Overdrive.index()],
            1_usize,
        ),
        (
            SupportedPedalSlot::Distortion,
            order_values[SupportedPedalSlot::Distortion.index()],
            2_usize,
        ),
        (
            SupportedPedalSlot::Fuzz,
            order_values[SupportedPedalSlot::Fuzz.index()],
            3_usize,
        ),
    ];
    ordered.sort_by(|left, right| left.1.total_cmp(&right.1).then(left.2.cmp(&right.2)));
    ordered.map(|(slot, _, _)| slot)
}

#[cfg(test)]
mod tests {
    use super::{linear_to_db, rebuild_supported_pedal_order, GrinderEngine, SupportedPedalSlot};

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

    #[test]
    fn supported_pre_pedal_order_changes_the_live_signal_path() {
        let mut default_order_engine = GrinderEngine::new(48_000.0);
        default_order_engine.set_param("channel", 1.0);
        default_order_engine.set_param("gain", 6.0);
        default_order_engine.set_param("master", 5.0);
        default_order_engine.set_param("preCompressorEnabled", 1.0);
        default_order_engine.set_param("preCompressorThreshold", -24.0);
        default_order_engine.set_param("preCompressorRatio", 4.0);
        default_order_engine.set_param("preCompressorAttack", 10.0);
        default_order_engine.set_param("preCompressorRelease", 180.0);
        default_order_engine.set_param("preOverdriveEnabled", 1.0);
        default_order_engine.set_param("preOverdriveDrive", 3.0);
        default_order_engine.set_param("preOverdriveTone", 5.0);
        default_order_engine.set_param("preOverdriveLevel", 5.5);

        let mut swapped_order_engine = GrinderEngine::new(48_000.0);
        swapped_order_engine.set_param("channel", 1.0);
        swapped_order_engine.set_param("gain", 6.0);
        swapped_order_engine.set_param("master", 5.0);
        swapped_order_engine.set_param("preCompressorEnabled", 1.0);
        swapped_order_engine.set_param("preCompressorThreshold", -24.0);
        swapped_order_engine.set_param("preCompressorRatio", 4.0);
        swapped_order_engine.set_param("preCompressorAttack", 10.0);
        swapped_order_engine.set_param("preCompressorRelease", 180.0);
        swapped_order_engine.set_param("preOverdriveEnabled", 1.0);
        swapped_order_engine.set_param("preOverdriveDrive", 3.0);
        swapped_order_engine.set_param("preOverdriveTone", 5.0);
        swapped_order_engine.set_param("preOverdriveLevel", 5.5);
        swapped_order_engine.set_param("preCompressorOrder", 1.0);
        swapped_order_engine.set_param("preOverdriveOrder", 0.0);

        let total = 4096;
        let mut default_left = vec![0.0_f32; total];
        let mut default_right = vec![0.0_f32; total];
        let mut swapped_left = vec![0.0_f32; total];
        let mut swapped_right = vec![0.0_f32; total];

        for n in 0..total {
            let low = ((n as f32 * 2.0 * std::f32::consts::PI * 110.0) / 48_000.0).sin() * 0.08;
            let high = ((n as f32 * 2.0 * std::f32::consts::PI * 1760.0) / 48_000.0).sin() * 0.03;
            let sample = low + high;
            default_left[n] = sample;
            default_right[n] = sample;
            swapped_left[n] = sample;
            swapped_right[n] = sample;
        }

        default_order_engine.process_block(&mut default_left, &mut default_right);
        swapped_order_engine.process_block(&mut swapped_left, &mut swapped_right);

        let diff = default_left
            .iter()
            .zip(swapped_left.iter())
            .map(|(a, b)| (a - b).abs())
            .sum::<f32>()
            / total as f32;

        assert!(
            diff > 1.0e-3,
            "changing supported pre pedal order should change the live path, got diff {diff}"
        );
    }

    #[test]
    fn supported_pedal_order_rebuild_is_stable_for_equal_values() {
        let order = rebuild_supported_pedal_order([0.0, 0.0, 2.0, 3.0]);

        assert_eq!(
            order,
            [
                SupportedPedalSlot::Compressor,
                SupportedPedalSlot::Overdrive,
                SupportedPedalSlot::Distortion,
                SupportedPedalSlot::Fuzz,
            ]
        );
    }

    fn average_abs_output_for_cab_config(configure: impl FnOnce(&mut GrinderEngine)) -> f32 {
        let mut engine = GrinderEngine::new(48_000.0);
        engine.set_param("channel", 1.0);
        engine.set_param("gain", 6.0);
        engine.set_param("master", 5.0);
        configure(&mut engine);

        let total = 4096;
        let mut left = vec![0.0_f32; total];
        let mut right = vec![0.0_f32; total];

        for n in 0..total {
            let low = ((n as f32 * 2.0 * std::f32::consts::PI * 140.0) / 48_000.0).sin() * 0.09;
            let high = ((n as f32 * 2.0 * std::f32::consts::PI * 2600.0) / 48_000.0).sin() * 0.04;
            let sample = low + high;
            left[n] = sample;
            right[n] = sample;
        }

        engine.process_block(&mut left, &mut right);

        left.iter().map(|sample| sample.abs()).sum::<f32>() / total as f32
    }

    #[test]
    fn cab_ir_slot_changes_the_live_signal_path() {
        let four_by_twelve = average_abs_output_for_cab_config(|engine| {
            engine.set_param("cabType", 2.0);
            engine.set_param("cabIrSlot", 0.0);
        });
        let two_by_twelve = average_abs_output_for_cab_config(|engine| {
            engine.set_param("cabType", 2.0);
            engine.set_param("cabIrSlot", 1.0);
        });

        assert!(
            (four_by_twelve - two_by_twelve).abs() > 1.0e-3,
            "cab IR slot should audibly change output (4x12={four_by_twelve}, 2x12={two_by_twelve})"
        );
    }

    /// F4: the `cabEnabled` handler has to reach `SpeakerModel`, or the
    /// toggle does nothing in Parametric and Both cabinet modes.
    #[test]
    fn cab_enabled_is_audible_in_parametric_and_both_cab_modes() {
        for cab_type in [1.0_f32, 2.0] {
            let engaged = average_abs_output_for_cab_config(|engine| {
                engine.set_param("cabType", cab_type);
                engine.set_param("cabEnabled", 1.0);
            });
            let bypassed = average_abs_output_for_cab_config(|engine| {
                engine.set_param("cabType", cab_type);
                engine.set_param("cabEnabled", 0.0);
            });

            assert!(
                (engaged - bypassed).abs() > 1.0e-3,
                "cabEnabled must change the output in cab mode {cab_type} (engaged={engaged}, bypassed={bypassed})"
            );
        }
    }

    /// F13-4: every Grinder stage has a `reset`, and until now nothing called
    /// them. A reset must drop the ringing tail the previous position left in
    /// the filters and cabinet buffers.
    #[test]
    fn engine_reset_clears_the_ringing_tail_and_the_meters() {
        fn tail_after(reset_between: bool) -> f32 {
            let mut engine = GrinderEngine::new(48_000.0);
            engine.set_param("channel", 2.0);
            engine.set_param("gain", 8.0);
            engine.set_param("master", 6.0);

            let total = 2048;
            let mut left = vec![0.0_f32; total];
            let mut right = vec![0.0_f32; total];
            for n in 0..total {
                let phase = (n as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0;
                left[n] = phase.sin() * 0.3;
                right[n] = left[n];
            }
            engine.process_block(&mut left, &mut right);

            if reset_between {
                engine.reset();
                assert_eq!(
                    engine.output_db(),
                    linear_to_db(0.0),
                    "reset must clear the output meter"
                );
            }

            let mut silence_left = vec![0.0_f32; 256];
            let mut silence_right = vec![0.0_f32; 256];
            engine.process_block(&mut silence_left, &mut silence_right);
            silence_left.iter().map(|sample| sample.abs()).sum::<f32>()
        }

        let ringing = tail_after(false);
        let cleared = tail_after(true);

        assert!(ringing > 0.0, "the amp should ring on into the next block");
        assert!(
            cleared < ringing * 0.01,
            "reset must drop the tail (ringing={ringing}, cleared={cleared})"
        );
    }

    #[test]
    fn cab_type_changes_the_live_signal_path() {
        let ir_only = average_abs_output_for_cab_config(|engine| {
            engine.set_param("cabType", 0.0);
        });
        let parametric_only = average_abs_output_for_cab_config(|engine| {
            engine.set_param("cabType", 1.0);
        });
        let both = average_abs_output_for_cab_config(|engine| {
            engine.set_param("cabType", 2.0);
        });

        assert!(
            (ir_only - parametric_only).abs() > 1.0e-3,
            "IR-only and parametric-only cab modes should differ (ir={ir_only}, parametric={parametric_only})"
        );
        assert!(
            (both - parametric_only).abs() > 1.0e-3,
            "combined cab mode should differ from parametric-only (both={both}, parametric={parametric_only})"
        );
    }

    #[test]
    fn routing_mode_changes_the_live_signal_path() {
        let serial = average_abs_output_for_cab_config(|engine| {
            engine.set_param("routingMode", 0.0);
            engine.set_param("cabType", 2.0);
        });
        let parallel = average_abs_output_for_cab_config(|engine| {
            engine.set_param("routingMode", 1.0);
            engine.set_param("cabType", 2.0);
        });
        let wet_dry_wet = average_abs_output_for_cab_config(|engine| {
            engine.set_param("routingMode", 2.0);
            engine.set_param("cabType", 2.0);
        });

        assert!(
            (serial - parallel).abs() > 1.0e-3,
            "parallel routing should audibly differ from serial (serial={serial}, parallel={parallel})"
        );
        assert!(
            (serial - wet_dry_wet).abs() > 1.0e-3,
            "wet-dry-wet routing should audibly differ from serial (serial={serial}, wet_dry_wet={wet_dry_wet})"
        );
    }

    #[test]
    fn neural_model_mode_param_activates_the_custom_profile() {
        let mut engine = GrinderEngine::new(48_000.0);
        engine.set_param("engineMode", 2.0); // Hybrid: non-circuit, so warmup is observable
        assert_eq!(
            engine.neural_warmup_progress(),
            1.0,
            "nothing is armed yet: the warmup ramp reads complete"
        );

        engine.set_param("neuralModelMode", 1.0);

        // Activating the custom profile rearms the warmup ramp from zero. If
        // the engine dropped the param, progress stays pinned at 1.0.
        assert!(
            engine.neural_warmup_progress() < 1.0,
            "neuralModelMode must reach NeuralCapture (custom profile arms warmup), got {}",
            engine.neural_warmup_progress()
        );
    }

    #[test]
    fn neural_custom_tier_param_reaches_the_capture() {
        let mut engine = GrinderEngine::new(48_000.0);
        // Default tier is Standard: 48% CPU estimate.
        assert_eq!(engine.neural_cpu_percent(), 48.0);

        engine.set_param("neuralCustomTier", 3.0); // Recurrent

        assert_eq!(
            engine.neural_cpu_percent(),
            10.0,
            "neuralCustomTier must reach NeuralCapture (tier drives the CPU estimate)"
        );
    }

    #[test]
    fn neural_custom_conv_weight_params_change_the_processed_signal() {
        fn render(conv_weight: Option<f32>) -> Vec<f32> {
            let mut engine = GrinderEngine::new(48_000.0);
            engine.set_param("engineMode", 1.0); // Capture: the capture replaces the amp path
            engine.set_param("neuralModelMode", 1.0);
            if let Some(weight) = conv_weight {
                engine.set_param("neuralCustomConvWeight0_1", weight);
            }

            let total = 4096;
            let mut left = vec![0.0_f32; total];
            let mut right = vec![0.0_f32; total];
            for n in 0..total {
                let phase = (n as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0;
                left[n] = phase.sin() * 0.1;
                right[n] = left[n];
            }
            engine.process_block(&mut left, &mut right);
            left
        }

        let baseline = render(None);
        let inverted = render(Some(-1.0));

        let max_delta = baseline
            .iter()
            .zip(inverted.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0_f32, f32::max);
        assert!(
            max_delta > 1.0e-3,
            "neuralCustomConvWeight0_1 must alter the capture output (max delta {max_delta})"
        );
    }

    fn drive_sine_blocks(engine: &mut GrinderEngine, blocks: usize) {
        let total = 512;
        let mut left = vec![0.0_f32; total];
        let mut right = vec![0.0_f32; total];
        for block in 0..blocks {
            for n in 0..total {
                let index = block * total + n;
                let phase = (index as f32 * 2.0 * std::f32::consts::PI * 220.0) / 48_000.0;
                left[n] = phase.sin() * 0.3;
                right[n] = left[n];
            }
            engine.process_block(&mut left, &mut right);
        }
    }

    /// The dual chain only runs under DualAmp routing, so its state freezes at
    /// whatever the last DualAmp sample left behind. Re-entering the mode must
    /// start from cleared state, not replay that stale energy as a pop.
    #[test]
    fn re_entering_dual_amp_routing_clears_the_frozen_dual_chain_state() {
        let mut engine = GrinderEngine::new(48_000.0);
        engine.set_param("cabType", 1.0); // Parametric, so the dual speaker runs
        engine.set_param("routingMode", 3.0); // DualAmp
        drive_sine_blocks(&mut engine, 8);
        assert!(
            engine.dual_speaker.back_emf().abs() > 0.0,
            "the DualAmp run must leave real dual-chain state behind for the re-entry to clear"
        );

        engine.set_param("routingMode", 0.0); // Serial: the dual chain freezes
        engine.set_param("routingMode", 3.0); // back to DualAmp

        assert_eq!(
            engine.dual_speaker.back_emf(),
            0.0,
            "entering DualAmp must clear the dual chain's frozen state"
        );
    }

    /// Capture mode skips the circuit preamp and tone stack, freezing their
    /// filter state on entry. Leaving Capture must clear it: a probe through
    /// the returned stages has to match a never-charged engine exactly.
    #[test]
    fn leaving_capture_mode_clears_the_frozen_circuit_stage_state() {
        let mut engine = GrinderEngine::new(48_000.0);
        engine.set_param("gain", 8.0);
        drive_sine_blocks(&mut engine, 8); // charge the circuit path in Circuit mode

        engine.set_param("engineMode", 1.0); // Capture: circuit stages freeze
        engine.set_param("engineMode", 0.0); // back to Circuit

        let mut fresh = GrinderEngine::new(48_000.0);
        fresh.set_param("gain", 8.0);
        let probe = 0.25_f32;
        assert_eq!(
            engine.preamp.process_sample(probe),
            fresh.preamp.process_sample(probe),
            "the preamp must return from Capture with cleared filter state"
        );
        assert_eq!(
            engine.tone_stack.process_sample(probe),
            fresh.tone_stack.process_sample(probe),
            "the tone stack must return from Capture with cleared filter state"
        );
    }
}
