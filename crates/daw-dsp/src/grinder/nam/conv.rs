//! Causal convolution primitives for NAM models, matching NAMCore's
//! `Conv1D`/`Conv1x1` weight layouts tap-for-tap.

use super::NamModelError;

/// Expected weight count for a non-grouped Conv1D with the given shape.
pub(crate) fn conv1d_weight_count(
    in_channels: usize,
    out_channels: usize,
    kernel_size: usize,
    bias: bool,
) -> usize {
    let mut count = in_channels * out_channels * kernel_size;
    if bias {
        count += out_channels;
    }
    count
}

pub(crate) fn conv1x1_weight_count(in_channels: usize, out_channels: usize, bias: bool) -> usize {
    conv1d_weight_count(in_channels, out_channels, 1, bias)
}

/// Weight layout: for each output channel `o`, for each input channel `i`,
/// for each tap `k` (ascending) — then the output-channel biases. Tap `k`
/// reads the input delayed by `(kernel_size - 1 - k) * dilation` samples, so
/// tap 0 is the oldest sample.
pub(crate) struct Conv1d {
    in_channels: usize,
    out_channels: usize,
    kernel_size: usize,
    dilation: usize,
    /// `kernel_size * out_channels * in_channels`, tap-major then row-major.
    taps: Vec<f32>,
    /// Empty when the layer carries no bias.
    bias: Vec<f32>,
    /// Per-input-channel history of the last `(kernel_size - 1) * dilation + 1`
    /// samples, oldest slot first.
    history: Vec<f32>,
    history_len: usize,
    write_pos: usize,
}

impl Conv1d {
    /// Consume weights from the front of `weights` in NAMCore's order.
    pub(crate) fn from_weights(
        in_channels: usize,
        out_channels: usize,
        kernel_size: usize,
        dilation: usize,
        bias: bool,
        weights: &mut &[f32],
    ) -> Result<Conv1d, NamModelError> {
        let needed = conv1d_weight_count(in_channels, out_channels, kernel_size, bias);
        if weights.len() < needed {
            return Err(NamModelError::WeightCountMismatch {
                expected: needed,
                actual: weights.len(),
            });
        }
        let (taken, rest) = weights.split_at(needed);
        let mut taps = vec![0.0_f32; in_channels * out_channels * kernel_size];
        let mut cursor = 0;
        for o in 0..out_channels {
            for i in 0..in_channels {
                for k in 0..kernel_size {
                    taps[k * out_channels * in_channels + o * in_channels + i] = taken[cursor];
                    cursor += 1;
                }
            }
        }
        let bias_values = if bias {
            taken[cursor..].to_vec()
        } else {
            Vec::new()
        };
        *weights = rest;

        let history_len = (kernel_size - 1) * dilation + 1;
        Ok(Conv1d {
            in_channels,
            out_channels,
            kernel_size,
            dilation,
            taps,
            bias: bias_values,
            history: vec![0.0; in_channels * history_len],
            history_len,
            write_pos: 0,
        })
    }

    #[inline]
    pub(crate) fn process(&mut self, input: &[f32], output: &mut [f32]) {
        let history_len = self.history_len;
        let kernel = self.kernel_size;
        let dilation = self.dilation;
        let in_channels = self.in_channels;
        let out_channels = self.out_channels;

        for (channel, value) in input.iter().enumerate().take(in_channels) {
            self.history[channel * history_len + self.write_pos] = *value;
        }

        for o in 0..out_channels {
            let mut sum = self.bias.get(o).copied().unwrap_or(0.0);
            for k in 0..kernel {
                let delay = (kernel - 1 - k) * dilation;
                let read_pos = (self.write_pos + history_len - delay) % history_len;
                let tap_base = k * out_channels * in_channels + o * in_channels;
                for i in 0..in_channels {
                    sum += self.taps[tap_base + i] * self.history[i * history_len + read_pos];
                }
            }
            output[o] = sum;
        }

        self.write_pos += 1;
        if self.write_pos == history_len {
            self.write_pos = 0;
        }
    }

    pub(crate) fn reset(&mut self) {
        self.history.fill(0.0);
        self.write_pos = 0;
    }

    /// Samples of input history the layer looks back on.
    pub(crate) fn receptive_field(&self) -> usize {
        (self.kernel_size - 1) * self.dilation
    }

    pub(crate) fn output_channels(&self) -> usize {
        self.out_channels
    }

    pub(crate) fn input_channels(&self) -> usize {
        self.in_channels
    }
}

/// Weight layout: for each output channel `o`, for each input channel `i` —
/// then the output-channel biases. (A `Conv1x1` in NAMCore terms.)
pub(crate) struct Conv1x1 {
    in_channels: usize,
    out_channels: usize,
    /// Row-major `(out_channels, in_channels)`.
    weights: Vec<f32>,
    bias: Vec<f32>,
}

impl Conv1x1 {
    pub(crate) fn from_weights(
        in_channels: usize,
        out_channels: usize,
        bias: bool,
        weights: &mut &[f32],
    ) -> Result<Conv1x1, NamModelError> {
        let needed = conv1x1_weight_count(in_channels, out_channels, bias);
        if weights.len() < needed {
            return Err(NamModelError::WeightCountMismatch {
                expected: needed,
                actual: weights.len(),
            });
        }
        let (taken, rest) = weights.split_at(needed);
        let matrix = taken[..in_channels * out_channels].to_vec();
        let bias_values = if bias {
            taken[in_channels * out_channels..].to_vec()
        } else {
            Vec::new()
        };
        *weights = rest;
        Ok(Conv1x1 {
            in_channels,
            out_channels,
            weights: matrix,
            bias: bias_values,
        })
    }

    #[inline]
    pub(crate) fn process(&self, input: &[f32], output: &mut [f32]) {
        for o in 0..self.out_channels {
            let row = o * self.in_channels;
            let mut sum = self.bias.get(o).copied().unwrap_or(0.0);
            for i in 0..self.in_channels {
                sum += self.weights[row + i] * input[i];
            }
            output[o] = sum;
        }
    }

    pub(crate) fn out_channels(&self) -> usize {
        self.out_channels
    }
}
