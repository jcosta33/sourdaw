//! ConvNet runtime mirroring NAMCore's `NAM/convnet.cpp`: dilated two-tap
//! convolution blocks (bias only when batchnorm is absent), optional
//! batchnorm folded to `scale*x + loc`, per-block activation, and a linear
//! head.

use serde_json::Value;

use super::activations::Activation;
use super::conv::conv1x1_weight_count;
use super::conv::Conv1d;
use super::NamModelError;

struct ConvnetBlock {
    conv: Conv1d,
    /// Batchnorm folded to per-channel affine coefficients (empty when the
    /// block runs without batchnorm).
    bn_scale: Vec<f32>,
    bn_loc: Vec<f32>,
    activation: Activation,
    in_channels: usize,
}

impl ConvnetBlock {
    fn from_weights(
        in_channels: usize,
        out_channels: usize,
        dilation: usize,
        batchnorm: bool,
        activation: Activation,
        weights: &mut &[f32],
    ) -> Result<ConvnetBlock, NamModelError> {
        // NAMCore's ConvNet uses a fixed kernel size of 2 and enables the conv
        // bias exactly when batchnorm is absent.
        let conv =
            Conv1d::from_weights(in_channels, out_channels, 2, dilation, !batchnorm, weights)?;
        let (bn_scale, bn_loc) = if batchnorm {
            let needed = 4 * out_channels + 1;
            if weights.len() < needed {
                return Err(NamModelError::WeightCountMismatch {
                    expected: needed,
                    actual: weights.len(),
                });
            }
            let (taken, rest) = weights.split_at(needed);
            let mut cursor = 0;
            let mut running_mean = vec![0.0; out_channels];
            running_mean.copy_from_slice(&taken[cursor..cursor + out_channels]);
            cursor += out_channels;
            let mut running_var = vec![0.0; out_channels];
            running_var.copy_from_slice(&taken[cursor..cursor + out_channels]);
            cursor += out_channels;
            let mut bn_weight = vec![0.0; out_channels];
            bn_weight.copy_from_slice(&taken[cursor..cursor + out_channels]);
            cursor += out_channels;
            let mut bn_bias = vec![0.0; out_channels];
            bn_bias.copy_from_slice(&taken[cursor..cursor + out_channels]);
            cursor += out_channels;
            let eps = taken[cursor];
            *weights = rest;

            // y = (x - mean) / sqrt(var + eps) * weight + bias, folded to
            // scale * x + loc exactly as NAMCore's BatchNorm does. A negative
            // variance is a corrupt model file: NAMCore would fold NaN into
            // the network and only its ReLU's NaN-swallowing keeps it audible,
            // so reject the file instead of running a poisoned network.
            let mut bn_scale = vec![0.0; out_channels];
            let mut bn_loc = vec![0.0; out_channels];
            for index in 0..out_channels {
                let variance = eps + running_var[index];
                if !(variance > 0.0) {
                    return Err(NamModelError::InvalidConfig(
                        "batchnorm running variance must be positive".into(),
                    ));
                }
                let scale = bn_weight[index] / variance.sqrt();
                bn_scale[index] = scale;
                bn_loc[index] = bn_bias[index] - scale * running_mean[index];
            }
            (bn_scale, bn_loc)
        } else {
            (Vec::new(), Vec::new())
        };

        Ok(ConvnetBlock {
            conv,
            bn_scale,
            bn_loc,
            activation,
            in_channels,
        })
    }

    fn process(&mut self, input: &[f32], scratch: &mut Vec<f32>) {
        scratch.clear();
        scratch.resize(self.conv.output_channels(), 0.0);
        self.conv.process(input, scratch);
        for (index, value) in scratch.iter_mut().enumerate() {
            let mut value_out = *value;
            if !self.bn_scale.is_empty() {
                value_out = self.bn_scale[index] * value_out + self.bn_loc[index];
            }
            *value = self.activation.apply(value_out, index);
        }
    }

    fn reset(&mut self) {
        self.conv.reset();
    }

    fn receptive_field(&self) -> usize {
        self.conv.receptive_field()
    }
}

/// The complete ConvNet network.
pub struct ConvnetModel {
    blocks: Vec<ConvnetBlock>,
    /// Row-major `(1, channels)` head.
    head_w: Vec<f32>,
    head_b: f32,
    /// Channel ping buffers sized to the block width.
    io: Vec<f32>,
    next: Vec<f32>,
}

impl ConvnetModel {
    pub(super) fn from_config(
        config: &Value,
        weights: &mut &[f32],
    ) -> Result<ConvnetModel, NamModelError> {
        let channels = config
            .get("channels")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("ConvNet config requires channels".into())
            })?;
        let dilations: Vec<usize> = config
            .get("dilations")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("ConvNet config requires dilations".into())
            })?
            .iter()
            .map(|value| {
                value.as_u64().map(|value| value as usize).ok_or_else(|| {
                    NamModelError::InvalidConfig(
                        "ConvNet dilations must be positive integers".into(),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if dilations.is_empty() {
            return Err(NamModelError::InvalidConfig(
                "ConvNet config requires at least one dilation".into(),
            ));
        }
        let batchnorm = config
            .get("batchnorm")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("ConvNet config requires batchnorm".into())
            })?;
        let activation = Activation::from_json(config.get("activation").ok_or_else(|| {
            NamModelError::InvalidConfig("ConvNet config requires activation".into())
        })?)?;
        let in_channels = config
            .get("in_channels")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(1);
        let out_channels = config
            .get("out_channels")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(1);
        let groups = config
            .get("groups")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(1);
        if groups != 1 {
            return Err(NamModelError::InvalidConfig(
                "grouped ConvNet convolutions are not supported".into(),
            ));
        }
        if in_channels != 1 || out_channels != 1 {
            return Err(NamModelError::InvalidConfig(format!(
                "multi-channel ConvNet ({in_channels} -> {out_channels}) is not supported; Grinder captures are mono"
            )));
        }

        let mut blocks = Vec::with_capacity(dilations.len());
        let mut block_input = 1usize;
        for dilation in dilations {
            blocks.push(ConvnetBlock::from_weights(
                block_input,
                channels,
                dilation,
                batchnorm,
                activation.clone(),
                weights,
            )?);
            block_input = channels;
        }

        let head_needed = conv1x1_weight_count(channels, 1, true);
        if weights.len() < head_needed {
            return Err(NamModelError::WeightCountMismatch {
                expected: head_needed,
                actual: weights.len(),
            });
        }
        let (taken, rest) = weights.split_at(head_needed);
        let head_w = taken[..channels].to_vec();
        let head_b = taken[channels];
        *weights = rest;

        if !weights.is_empty() {
            return Err(NamModelError::WeightCountMismatch {
                expected: 0,
                actual: weights.len(),
            });
        }

        Ok(ConvnetModel {
            blocks,
            head_w,
            head_b,
            io: vec![0.0; channels],
            next: vec![0.0; channels],
        })
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        // `io` carries the widest channel vector between blocks; block 0
        // reads just the mono input slot.
        self.io[0] = input;
        for index in 0..self.blocks.len() {
            let block = &mut self.blocks[index];
            let in_channels = block.in_channels;
            block.process(&self.io[..in_channels], &mut self.next);
            std::mem::swap(&mut self.io, &mut self.next);
        }
        let mut sum = self.head_b;
        for (weight, value) in self.head_w.iter().zip(&self.io) {
            sum += weight * value;
        }
        sum
    }

    pub fn reset(&mut self) {
        for block in &mut self.blocks {
            block.reset();
        }
    }

    pub fn prewarm_samples(&self) -> usize {
        1 + self
            .blocks
            .iter()
            .map(ConvnetBlock::receptive_field)
            .sum::<usize>()
    }
}
