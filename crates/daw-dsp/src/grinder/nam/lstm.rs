//! LSTM runtime mirroring NAMCore's `NAM/lstm.cpp`: stacked cells with
//! row-major `(4h, input + h)` weight matrices, i-f-g-o gate order, initial
//! hidden/cell states carried in the weight array, and a linear head.

use serde_json::Value;

use super::activations::{sigmoid, tanh};
use super::conv::conv1x1_weight_count;
use super::NamModelError;

struct LstmLayer {
    hidden_size: usize,
    input_size: usize,
    /// Row-major `(4 * hidden_size, input_size + hidden_size)`; PyTorch's
    /// flattening order, exactly as NAMCore reads it.
    w: Vec<f32>,
    /// `(4 * hidden_size,)`, gate order input/forget/cell/output.
    b: Vec<f32>,
    /// Initial hidden/cell states from the weight array, restored on reset
    /// (NAMCore loads them at construction and prewarms from there).
    initial_hidden: Vec<f32>,
    initial_cell: Vec<f32>,
    /// Concatenated `[x, h]` state; the hidden tail is the next layer's input.
    xh: Vec<f32>,
    c: Vec<f32>,
    gates: Vec<f32>,
}

impl LstmLayer {
    fn from_weights(
        input_size: usize,
        hidden_size: usize,
        weights: &mut &[f32],
    ) -> Result<LstmLayer, NamModelError> {
        let needed = 4 * hidden_size * (input_size + hidden_size)
            + 4 * hidden_size
            + hidden_size
            + hidden_size;
        if weights.len() < needed {
            return Err(NamModelError::WeightCountMismatch {
                expected: needed,
                actual: weights.len(),
            });
        }
        let (taken, rest) = weights.split_at(needed);
        let mut cursor = 0;
        let w_len = 4 * hidden_size * (input_size + hidden_size);
        let mut w = vec![0.0; w_len];
        w.copy_from_slice(&taken[cursor..cursor + w_len]);
        cursor += w_len;
        let mut b = vec![0.0; 4 * hidden_size];
        b.copy_from_slice(&taken[cursor..cursor + 4 * hidden_size]);
        cursor += 4 * hidden_size;
        let initial_hidden = taken[cursor..cursor + hidden_size].to_vec();
        cursor += hidden_size;
        let initial_cell = taken[cursor..cursor + hidden_size].to_vec();
        *weights = rest;

        Ok(LstmLayer {
            hidden_size,
            input_size,
            w,
            b,
            initial_hidden,
            initial_cell,
            xh: vec![0.0; input_size + hidden_size],
            c: vec![0.0; hidden_size],
            gates: vec![0.0; 4 * hidden_size],
        })
    }

    fn process(&mut self, x: &[f32]) {
        let h = self.hidden_size;
        let input_span = self.input_size;
        self.xh[..input_span].copy_from_slice(x);

        for gate in 0..4 * h {
            let row = gate * (input_span + h);
            let mut sum = self.b[gate];
            for index in 0..input_span + h {
                sum += self.w[row + index] * self.xh[index];
            }
            self.gates[gate] = sum;
        }

        for index in 0..h {
            let i_gate = sigmoid(self.gates[index]);
            let f_gate = sigmoid(self.gates[h + index]);
            let g_gate = tanh(self.gates[2 * h + index]);
            let o_gate = sigmoid(self.gates[3 * h + index]);
            self.c[index] = f_gate * self.c[index] + i_gate * g_gate;
            self.xh[input_span + index] = o_gate * tanh(self.c[index]);
        }
    }

    fn restore_initial_state(&mut self) {
        self.xh.fill(0.0);
        self.xh[self.input_size..].copy_from_slice(&self.initial_hidden);
        self.c.copy_from_slice(&self.initial_cell);
    }

    fn hidden(&self) -> &[f32] {
        &self.xh[self.input_size..]
    }
}

/// The complete LSTM network.
pub struct LstmModel {
    layers: Vec<LstmLayer>,
    /// Row-major `(out_channels, hidden_size)`.
    head_w: Vec<f32>,
    head_b: Vec<f32>,
    input: Vec<f32>,
    output: Vec<f32>,
}

impl LstmModel {
    pub(super) fn from_config(
        config: &Value,
        weights: &mut &[f32],
    ) -> Result<LstmModel, NamModelError> {
        let num_layers = config
            .get("num_layers")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("LSTM config requires num_layers".into())
            })?;
        let input_size = config
            .get("input_size")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("LSTM config requires input_size".into())
            })?;
        let hidden_size = config
            .get("hidden_size")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("LSTM config requires hidden_size".into())
            })?;
        let out_channels = config
            .get("out_channels")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(1);
        if num_layers == 0 {
            return Err(NamModelError::InvalidConfig(
                "LSTM config requires at least one layer".into(),
            ));
        }
        if input_size != 1 {
            return Err(NamModelError::InvalidConfig(format!(
                "multi-input LSTM captures ({input_size} inputs) are not supported; Grinder captures are mono"
            )));
        }
        if out_channels != 1 {
            return Err(NamModelError::InvalidConfig(format!(
                "multi-channel LSTM output ({out_channels} channels) is not supported; Grinder captures are mono"
            )));
        }

        let mut layers = Vec::with_capacity(num_layers);
        for index in 0..num_layers {
            let layer_input_size = if index == 0 { input_size } else { hidden_size };
            layers.push(LstmLayer::from_weights(
                layer_input_size,
                hidden_size,
                weights,
            )?);
        }

        let head_needed = conv1x1_weight_count(hidden_size, out_channels, true);
        if weights.len() < head_needed {
            return Err(NamModelError::WeightCountMismatch {
                expected: head_needed,
                actual: weights.len(),
            });
        }
        let (taken, rest) = weights.split_at(head_needed);
        let head_w = taken[..hidden_size * out_channels].to_vec();
        let head_b = taken[hidden_size * out_channels..].to_vec();
        *weights = rest;

        if !weights.is_empty() {
            return Err(NamModelError::WeightCountMismatch {
                expected: 0,
                actual: weights.len(),
            });
        }

        Ok(LstmModel {
            layers,
            head_w,
            head_b,
            input: vec![0.0; 1],
            output: vec![0.0; 1],
        })
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        self.input[0] = input;
        // Layer 0 reads the external input; deeper layers read the previous
        // layer's hidden tail, copied out to keep the borrows disjoint.
        let mut x = [0.0_f32; 1];
        x.copy_from_slice(&self.input);
        for index in 0..self.layers.len() {
            self.layers[index].process(&x);
            if index + 1 < self.layers.len() {
                x[0] = self.layers[index].xh[self.layers[index].input_size];
            }
        }

        let last = self.layers.last().expect("checked non-empty");
        let hidden = last.hidden();
        let mut sum = self.head_b[0];
        for (weight, value) in self.head_w.iter().zip(hidden) {
            sum += weight * value;
        }
        self.output[0] = sum;
        sum
    }

    pub fn reset(&mut self) {
        for layer in &mut self.layers {
            layer.restore_initial_state();
        }
    }

    /// NAMCore's LSTM prewarm: half a second of silence at the 48 kHz
    /// reference rate the engine runs captures at.
    pub fn prewarm_samples(&self) -> usize {
        (0.5 * 48_000.0) as usize
    }
}
