//! Neural capture engine — WaveNet-style and LSTM inference for Grinder.
//!
//! Placeholder architecture supporting:
//! - Causal dilated convolution (WaveNet-style) for high-quality capture playback
//! - LSTM recurrent tier for simpler/cheaper captures
//! - Model tiering (Standard/Lite/Nano/Recurrent)
//! - Pre-allocated weight and activation buffers

use crate::primitives::flush_denormal;

/// Neural model tier.
#[derive(Clone, Copy, PartialEq)]
pub enum ModelTier {
    Standard,  // Highest quality, highest CPU
    Lite,      // Mid CPU
    Nano,      // Low CPU
    Recurrent, // LSTM-based, very low CPU
}

impl ModelTier {
    pub fn from_index(i: u32) -> Self {
        match i {
            0 => Self::Standard,
            1 => Self::Lite,
            2 => Self::Nano,
            _ => Self::Recurrent,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum EngineMode {
    Circuit,
    Capture,
    Hybrid,
}

impl EngineMode {
    pub fn from_index(i: u32) -> Self {
        match i {
            1 => Self::Capture,
            2 => Self::Hybrid,
            _ => Self::Circuit,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum CapturePlacement {
    Amp,
    Rig,
}

impl CapturePlacement {
    pub fn from_index(i: u32) -> Self {
        match i {
            1 => Self::Rig,
            _ => Self::Amp,
        }
    }
}

/// Simple 1D dilated causal convolution layer.
struct DilatedConv1D {
    weights: Vec<f32>,
    kernel_size: usize,
    dilation: usize,
    ring_buffer: Vec<f32>,
    write_pos: usize,
}

impl DilatedConv1D {
    fn new(kernel_size: usize, dilation: usize) -> Self {
        let buffer_size = kernel_size * dilation;
        Self {
            weights: vec![0.0; kernel_size],
            kernel_size,
            dilation,
            ring_buffer: vec![0.0; buffer_size],
            write_pos: 0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        self.ring_buffer[self.write_pos] = input;

        let mut output = 0.0_f32;
        for k in 0..self.kernel_size {
            let delay = k * self.dilation;
            let read_pos = if self.write_pos >= delay {
                self.write_pos - delay
            } else {
                self.ring_buffer.len() - (delay - self.write_pos)
            };
            output += self.ring_buffer[read_pos] * self.weights[k];
        }

        self.write_pos = (self.write_pos + 1) % self.ring_buffer.len();

        // Activation function (gated tanh)
        output.tanh()
    }

    fn reset(&mut self) {
        self.ring_buffer.fill(0.0);
        self.write_pos = 0;
    }
}

/// LSTM cell for recurrent tier.
struct LstmCell {
    hidden_size: usize,
    // Weights (input, forget, cell, output gates)
    w_ih: Vec<f32>,
    w_hh: Vec<f32>,
    bias: Vec<f32>,
    // State
    hidden: Vec<f32>,
    cell: Vec<f32>,
    gates: Vec<f32>,
}

impl LstmCell {
    fn new(input_size: usize, hidden_size: usize) -> Self {
        let gate_count = 4;
        Self {
            hidden_size,
            w_ih: vec![0.0; gate_count * hidden_size * input_size],
            w_hh: vec![0.0; gate_count * hidden_size * hidden_size],
            bias: vec![0.0; gate_count * hidden_size],
            hidden: vec![0.0; hidden_size],
            cell: vec![0.0; hidden_size],
            gates: vec![0.0; gate_count * hidden_size],
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        // Simplified single-input LSTM
        // In production this would be a proper matrix multiply
        let h = self.hidden_size;
        self.gates.fill(0.0);

        // Compute gate activations (simplified for single input)
        for g in 0..4 * h {
            self.gates[g] = input * self.w_ih[g] + self.hidden[g % h] * self.w_hh[g] + self.bias[g];
        }

        // Apply gate activations
        for i in 0..h {
            let i_gate = sigmoid(self.gates[i]); // input gate
            let f_gate = sigmoid(self.gates[h + i]); // forget gate
            let g_gate = self.gates[2 * h + i].tanh(); // cell gate
            let o_gate = sigmoid(self.gates[3 * h + i]); // output gate

            self.cell[i] = f_gate * self.cell[i] + i_gate * g_gate;
            self.hidden[i] = o_gate * self.cell[i].tanh();
        }

        // Output: sum of hidden state
        self.hidden.iter().sum::<f32>() / h as f32
    }

    fn reset(&mut self) {
        self.hidden.fill(0.0);
        self.cell.fill(0.0);
    }
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

fn parse_custom_conv_weight_param(name: &str) -> Option<(usize, usize)> {
    let suffix = name.strip_prefix("neuralCustomConvWeight")?;
    let (layer_index, weight_index) = suffix.split_once('_')?;
    let layer_index = layer_index.parse::<usize>().ok()?;
    let weight_index = weight_index.parse::<usize>().ok()?;
    if weight_index > 2 {
        return None;
    }
    Some((layer_index, weight_index))
}

/// Neural capture processor supporting multiple architectures.
#[allow(dead_code)]
pub struct NeuralCapture {
    // WaveNet-style layers
    conv_layers: Vec<DilatedConv1D>,
    // LSTM tier
    lstm: LstmCell,

    tier: ModelTier,
    engine_mode: EngineMode,
    placement: CapturePlacement,
    mix: f32,
    cpu_budget: u32,
    selected_model_slot: Option<usize>,
    custom_profile_active: bool,
    input_drive: f32,
    asymmetry: f32,
    output_trim: f32,
    contour_mix: f32,
    contour_state: f32,
    model_loaded: bool,
    sample_rate: f32,
    warmup_samples_total: u32,
    warmup_samples_remaining: u32,
}

impl NeuralCapture {
    pub fn new(sample_rate: f32) -> Self {
        // Default WaveNet-style architecture: 10 layers with increasing dilation
        let conv_layers: Vec<DilatedConv1D> = (0..10)
            .map(|i| {
                let dilation = 1 << (i % 5); // 1, 2, 4, 8, 16, 1, 2, 4, 8, 16
                let mut layer = DilatedConv1D::new(3, dilation);
                // Initialize with simple identity-like weights
                layer.weights[0] = 0.1;
                layer.weights[1] = 0.8;
                layer.weights[2] = 0.1;
                layer
            })
            .collect();

        Self {
            conv_layers,
            lstm: LstmCell::new(1, 16),
            tier: ModelTier::Standard,
            engine_mode: EngineMode::Circuit,
            placement: CapturePlacement::Amp,
            mix: 1.0,
            cpu_budget: 1,
            selected_model_slot: None,
            custom_profile_active: false,
            input_drive: 1.0,
            asymmetry: 0.0,
            output_trim: 1.0,
            contour_mix: 0.18,
            contour_state: 0.0,
            model_loaded: false,
            sample_rate,
            warmup_samples_total: (sample_rate * 0.040) as u32,
            warmup_samples_remaining: 0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "engineMode" => {
                self.engine_mode = EngineMode::from_index(value as u32);
                self.arm_warmup();
            }
            "neuralEnabled" => {
                self.engine_mode = if value > 0.5 {
                    EngineMode::Hybrid
                } else {
                    EngineMode::Circuit
                };
                self.arm_warmup();
            }
            "neuralPlacement" => self.placement = CapturePlacement::from_index(value as u32),
            "neuralMix" => self.mix = value.clamp(0.0, 1.0),
            "neuralTier" => self.tier = ModelTier::from_index(value as u32),
            "neuralCpuBudget" => {
                self.cpu_budget = value.round().clamp(0.0, 2.0) as u32;
                self.arm_warmup();
            }
            "neuralModelMode" => {
                if value > 0.5 {
                    self.selected_model_slot = None;
                    self.custom_profile_active = true;
                    self.reset_runtime_state();
                    self.arm_warmup();
                } else {
                    self.custom_profile_active = false;
                    self.model_loaded = self.selected_model_slot.is_some();
                    self.warmup_samples_remaining = 0;
                }
            }
            "neuralModelSlot" => self.load_builtin_model(value.round().max(0.0) as usize),
            "neuralCustomTier" => self.tier = ModelTier::from_index(value.round().max(0.0) as u32),
            "neuralCustomInputDrive" => self.input_drive = value.clamp(0.5, 2.0),
            "neuralCustomAsymmetry" => self.asymmetry = value.clamp(-0.5, 0.5),
            "neuralCustomOutputTrim" => self.output_trim = value.clamp(0.2, 1.4),
            "neuralCustomContourMix" => self.contour_mix = value.clamp(0.0, 1.0),
            "neuralCustomLstmBias" => self.lstm.bias.fill(value.clamp(-1.0, 1.0)),
            _ => {}
        }

        if let Some((layer_index, weight_index)) = parse_custom_conv_weight_param(name) {
            if let Some(layer) = self.conv_layers.get_mut(layer_index) {
                layer.weights[weight_index] = value.clamp(-1.0, 1.0);
            }
        }
    }

    pub fn process_capture(&mut self, input: f32) -> f32 {
        if self.engine_mode == EngineMode::Circuit || !self.has_active_model() || !self.model_loaded
        {
            return input;
        }

        let shaped_input = input * self.input_drive + input.abs() * input * self.asymmetry;

        let processed = match self.tier {
            // Every convolutional tier takes its depth from
            // `active_layer_count`, which folds the tier and the CPU budget
            // together. Hardcoding the Lite and Nano depths here left
            // `neuralCpuBudget` with no effect outside the Standard tier.
            ModelTier::Standard | ModelTier::Lite | ModelTier::Nano => {
                let mut signal = shaped_input;
                let active_layers = self.active_layer_count();
                for layer in self.conv_layers.iter_mut().take(active_layers) {
                    signal = layer.process(signal);
                }
                signal
            }
            ModelTier::Recurrent => {
                // LSTM tier
                self.lstm.process(shaped_input)
            }
        };

        let contour_coeff = (2.0 * std::f32::consts::PI * 1_800.0 / self.sample_rate).min(0.3);
        self.contour_state =
            flush_denormal(self.contour_state + contour_coeff * (processed - self.contour_state));
        let edge = processed - self.contour_state;
        let voiced = self.contour_state * (1.0 - self.contour_mix) + edge * self.contour_mix;
        let profiled = voiced * self.output_trim;

        let activation = self.next_warmup_mix();
        input * (1.0 - activation) + profiled * activation
    }

    pub fn reset(&mut self) {
        self.reset_runtime_state();
        self.warmup_samples_remaining = 0;
        self.model_loaded = self.has_active_model();
    }

    fn reset_runtime_state(&mut self) {
        for layer in &mut self.conv_layers {
            layer.reset();
        }
        self.lstm.reset();
        self.contour_state = 0.0;
    }

    pub fn engine_mode(&self) -> EngineMode {
        self.engine_mode
    }

    pub fn placement(&self) -> CapturePlacement {
        self.placement
    }

    pub fn mix(&self) -> f32 {
        self.mix
    }

    /// Static per-tier CPU *estimate*, not a measurement. It is a lookup on
    /// the selected tier and CPU budget, so it answers "what does this
    /// configuration nominally cost" and never observes the host's actual
    /// load. Nothing here samples a clock.
    pub fn cpu_percent(&self) -> f32 {
        let base: f32 = match self.tier {
            ModelTier::Standard => 48.0,
            ModelTier::Lite => 29.0,
            ModelTier::Nano => 16.0,
            ModelTier::Recurrent => 10.0,
        };
        let budget_trim: f32 = match self.cpu_budget {
            0 => 0.72,
            2 => 1.12,
            _ => 1.0,
        };
        (base * budget_trim).min(99.0_f32)
    }

    pub fn warmup_progress(&self) -> f32 {
        if self.engine_mode == EngineMode::Circuit {
            return 0.0;
        }
        if self.warmup_samples_total == 0 {
            return 1.0;
        }
        1.0 - self.warmup_samples_remaining as f32 / self.warmup_samples_total as f32
    }

    pub fn is_ready(&self) -> bool {
        self.engine_mode != EngineMode::Circuit
            && self.model_loaded
            && self.warmup_samples_remaining == 0
    }

    pub fn latency_samples(&self) -> u32 {
        0
    }

    fn active_layer_count(&self) -> usize {
        match (self.tier, self.cpu_budget) {
            (ModelTier::Standard, 0) => 6,
            (ModelTier::Standard, 1) => 8,
            (ModelTier::Standard, _) => 10,
            (ModelTier::Lite, 0) => 4,
            (ModelTier::Lite, _) => 6,
            (ModelTier::Nano, 2) => 4,
            (ModelTier::Nano, _) => 3,
            (ModelTier::Recurrent, _) => 0,
        }
    }

    fn arm_warmup(&mut self) {
        if self.engine_mode == EngineMode::Circuit || !self.has_active_model() {
            self.warmup_samples_remaining = 0;
            return;
        }
        self.model_loaded = true;
        self.warmup_samples_total = (self.sample_rate * 0.040).round() as u32;
        self.warmup_samples_remaining = self.warmup_samples_total;
    }

    fn next_warmup_mix(&mut self) -> f32 {
        if self.warmup_samples_remaining == 0 {
            return 1.0;
        }
        self.warmup_samples_remaining = self.warmup_samples_remaining.saturating_sub(1);
        if self.warmup_samples_remaining == 0 {
            self.model_loaded = true;
        }
        self.warmup_progress().clamp(0.0, 1.0)
    }

    fn has_active_model(&self) -> bool {
        self.selected_model_slot.is_some() || self.custom_profile_active
    }

    fn load_builtin_model(&mut self, slot: usize) {
        self.selected_model_slot = Some(slot);
        self.custom_profile_active = false;

        let (weight_triplets, input_drive, asymmetry, output_trim, contour_mix, lstm_bias) =
            match slot {
                1 => (
                    [(0.16_f32, 0.60_f32, 0.24_f32), (0.08, 0.72, 0.20)],
                    1.28,
                    -0.10,
                    0.86,
                    0.12,
                    0.14,
                ),
                2 => (
                    [(0.22_f32, 0.58_f32, 0.20_f32), (0.12, 0.66, 0.22)],
                    1.08,
                    0.08,
                    0.98,
                    0.22,
                    -0.08,
                ),
                _ => (
                    [(0.10_f32, 0.80_f32, 0.10_f32), (0.06, 0.78, 0.16)],
                    1.16,
                    0.03,
                    0.92,
                    0.18,
                    0.04,
                ),
            };

        for (index, layer) in self.conv_layers.iter_mut().enumerate() {
            let profile = weight_triplets[index % weight_triplets.len()];
            layer.weights[0] = profile.0;
            layer.weights[1] = profile.1;
            layer.weights[2] = profile.2;
            layer.reset();
        }

        self.input_drive = input_drive;
        self.asymmetry = asymmetry;
        self.output_trim = output_trim;
        self.contour_mix = contour_mix;
        self.contour_state = 0.0;
        self.lstm.bias.fill(lstm_bias);
        self.lstm.reset();
        self.arm_warmup();
    }
}

#[cfg(test)]
mod tests {
    use super::{ModelTier, NeuralCapture};

    fn average_abs_output_for_model(slot: usize) -> f32 {
        let mut neural = NeuralCapture::new(48_000.0);
        neural.set_param("engineMode", 1.0);
        neural.set_param("neuralTier", 0.0);
        neural.set_param("neuralModelSlot", slot as f32);

        let total = 6000;
        let settle_start = 2500;
        let mut sum = 0.0_f32;
        for n in 0..total {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * 440.0) / 48_000.0;
            let input = phase.sin() * 0.12;
            let output = neural.process_capture(input);
            assert!(output.is_finite(), "neural output should remain finite");
            if n >= settle_start {
                sum += output.abs();
            }
        }

        sum / (total - settle_start) as f32
    }

    /// F13-5: `process_capture` hardcoded `take(6)` / `take(3)` for the Lite
    /// and Nano tiers, so `neuralCpuBudget` did nothing outside Standard.
    ///
    /// A convolution layer that ran has advanced its ring-buffer write
    /// position; one that was skipped has not. Counting them after a single
    /// sample reads the depth the render path actually used.
    #[test]
    fn every_tier_and_budget_renders_the_layer_count_it_advertises() {
        fn layers_that_ran(tier: f32, budget: f32) -> usize {
            let mut neural = NeuralCapture::new(48_000.0);
            neural.set_param("engineMode", 1.0);
            neural.set_param("neuralModelSlot", 0.0);
            neural.set_param("neuralTier", tier);
            neural.set_param("neuralCpuBudget", budget);
            neural.process_capture(0.2);
            neural
                .conv_layers
                .iter()
                .filter(|layer| layer.write_pos != 0)
                .count()
        }

        for (tier_index, tier) in [
            (0.0_f32, ModelTier::Standard),
            (1.0, ModelTier::Lite),
            (2.0, ModelTier::Nano),
        ] {
            for budget in [0.0_f32, 1.0, 2.0] {
                let mut expected_source = NeuralCapture::new(48_000.0);
                expected_source.tier = tier;
                expected_source.cpu_budget = budget as u32;
                let expected = expected_source.active_layer_count();

                assert_eq!(
                    layers_that_ran(tier_index, budget),
                    expected,
                    "tier {tier_index} at budget {budget} must render active_layer_count layers"
                );
            }
        }
    }

    #[test]
    fn builtin_neural_models_produce_distinct_output() {
        let model_a = average_abs_output_for_model(0);
        let model_b = average_abs_output_for_model(1);
        let model_c = average_abs_output_for_model(2);

        let max_delta = (model_a - model_b)
            .abs()
            .max((model_a - model_c).abs())
            .max((model_b - model_c).abs());

        assert!(
            max_delta > 5.0e-3,
            "builtin neural models should produce distinct output (a={model_a}, b={model_b}, c={model_c}, max_delta={max_delta})"
        );
    }

    #[test]
    fn imported_custom_profiles_produce_distinct_output() {
        let mut neural = NeuralCapture::new(48_000.0);
        neural.set_param("engineMode", 1.0);
        neural.set_param("neuralModelMode", 1.0);
        neural.set_param("neuralCustomTier", 0.0);
        neural.set_param("neuralCustomInputDrive", 1.22);
        neural.set_param("neuralCustomAsymmetry", 0.08);
        neural.set_param("neuralCustomOutputTrim", 0.88);
        neural.set_param("neuralCustomContourMix", 0.24);
        neural.set_param("neuralCustomLstmBias", 0.03);
        for index in 0..10 {
            neural.set_param(
                &format!("neuralCustomConvWeight{}_0", index),
                0.08 + index as f32 * 0.002,
            );
            neural.set_param(
                &format!("neuralCustomConvWeight{}_1", index),
                0.70 - index as f32 * 0.003,
            );
            neural.set_param(
                &format!("neuralCustomConvWeight{}_2", index),
                0.18 + index as f32 * 0.001,
            );
        }

        let mut alternate = NeuralCapture::new(48_000.0);
        alternate.set_param("engineMode", 1.0);
        alternate.set_param("neuralModelMode", 1.0);
        alternate.set_param("neuralCustomTier", 3.0);
        alternate.set_param("neuralCustomInputDrive", 1.04);
        alternate.set_param("neuralCustomAsymmetry", -0.06);
        alternate.set_param("neuralCustomOutputTrim", 0.96);
        alternate.set_param("neuralCustomContourMix", 0.14);
        alternate.set_param("neuralCustomLstmBias", -0.02);
        for index in 0..10 {
            alternate.set_param(
                &format!("neuralCustomConvWeight{}_0", index),
                0.16 - index as f32 * 0.002,
            );
            alternate.set_param(
                &format!("neuralCustomConvWeight{}_1", index),
                0.58 + index as f32 * 0.004,
            );
            alternate.set_param(
                &format!("neuralCustomConvWeight{}_2", index),
                0.22 - index as f32 * 0.001,
            );
        }

        let total = 6000;
        let settle_start = 2500;
        let mut delta_sum = 0.0_f32;
        for n in 0..total {
            let phase = (n as f32 * 2.0 * std::f32::consts::PI * 440.0) / 48_000.0;
            let input = phase.sin() * 0.12;
            let a = neural.process_capture(input);
            let b = alternate.process_capture(input);
            if n >= settle_start {
                delta_sum += (a - b).abs();
            }
        }

        let average_delta = delta_sum / (total - settle_start) as f32;
        assert!(
            average_delta > 5.0e-3,
            "imported custom profiles should produce distinct output (average_delta={average_delta})"
        );
    }
}
