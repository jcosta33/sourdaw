//! WaveNet runtime mirroring NAMCore's `NAM/wavenet`: stacked layer arrays of
//! dilated convolutions with input mixins, optional gating, optional per-layer
//! and per-array 1x1s, head rechannel, optional post-stack head, and the
//! trailing head scale.
//!
//! Weight consumption order — layer arrays first (per array: rechannel, then
//! per layer: conv, input mixin, layer1x1, head1x1), then the post-stack head
//! convolutions, then the single head-scale weight — matches
//! `WaveNet::set_weights_` exactly.

use serde_json::Value;

use super::activations::Activation;
use super::conv::Conv1d;
use super::conv::Conv1x1;
use super::NamModelError;

/// Config keys that would activate FiLM modulation. NAMCore treats a present,
/// non-false key as active by default, so presence with any non-false value is
/// rejected rather than approximated.
const FILM_KEYS: [&str; 8] = [
    "conv_pre_film",
    "conv_post_film",
    "input_mixin_pre_film",
    "input_mixin_post_film",
    "activation_pre_film",
    "activation_post_film",
    "layer1x1_post_film",
    "head1x1_post_film",
];

#[derive(Clone, Copy, PartialEq)]
enum GatingMode {
    None,
    Gated,
    Blended,
}

fn read_usize(config: &Value, key: &str) -> Result<usize, NamModelError> {
    config
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .ok_or_else(|| NamModelError::InvalidConfig(format!("WaveNet layer array requires {key}")))
}

fn read_bool(config: &Value, key: &str) -> Result<bool, NamModelError> {
    config
        .get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| NamModelError::InvalidConfig(format!("WaveNet layer array requires {key}")))
}

/// Reject unsupported config features explicitly: grouped convolutions and
/// FiLM modulation are real .nam features this runtime does not implement, so
/// naming them beats silently dropping them.
fn reject_unsupported_features(array_config: &Value) -> Result<(), NamModelError> {
    for key in ["groups_input", "groups_input_mixin"] {
        if let Some(groups) = array_config.get(key) {
            let groups = groups.as_u64().unwrap_or(1);
            if groups != 1 {
                return Err(NamModelError::InvalidConfig(format!(
                    "grouped WaveNet convolutions ({key} = {groups}) are not supported"
                )));
            }
        }
    }
    if let Some(layer1x1) = array_config.get("layer1x1") {
        let groups = layer1x1.get("groups").and_then(Value::as_u64).unwrap_or(1);
        if groups != 1 {
            return Err(NamModelError::InvalidConfig(
                "grouped layer1x1 convolutions are not supported".into(),
            ));
        }
    }
    if let Some(head1x1) = array_config.get("head1x1") {
        let active = head1x1
            .get("active")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let groups = head1x1.get("groups").and_then(Value::as_u64).unwrap_or(1);
        if active && groups != 1 {
            return Err(NamModelError::InvalidConfig(
                "grouped head1x1 convolutions are not supported".into(),
            ));
        }
    }
    for key in FILM_KEYS {
        if let Some(film) = array_config.get(key) {
            if !film.is_boolean() && film.get("active").and_then(Value::as_bool).unwrap_or(true) {
                return Err(NamModelError::InvalidConfig(format!(
                    "FiLM modulation (\"{key}\") is not supported"
                )));
            }
        }
    }
    Ok(())
}

struct WavenetLayer {
    conv: Conv1d,
    /// Condition (input) mixin — always bias-free in NAMCore.
    input_mixin: Conv1x1,
    layer1x1: Option<Conv1x1>,
    head1x1: Option<Conv1x1>,
    activation: Activation,
    /// Secondary activation for gated/blended layers.
    secondary: Option<Activation>,
    gating: GatingMode,
    bottleneck: usize,
    /// Scratch: conv output + mixin sum (2*bottleneck when gated).
    z: Vec<f32>,
    /// Scratch: residual branch output (input + layer1x1); the next layer's input.
    residual: Vec<f32>,
    /// Scratch: this layer's contribution to the array head.
    head_out: Vec<f32>,
    /// Scratch for the mixin output.
    mixin: Vec<f32>,
}

impl WavenetLayer {
    /// `array_config` carries the layer-count fields (activation, gating,
    /// kernel sizes); `dilation` is this layer's own entry from the array's
    /// dilation list, mirroring how NAMCore expands `LayerArrayParams`.
    fn from_array_config(
        array_config: &Value,
        kernel_size: usize,
        dilation: usize,
        channels: usize,
        condition_size: usize,
        weights: &mut &[f32],
    ) -> Result<WavenetLayer, NamModelError> {
        let bottleneck = array_config
            .get("bottleneck")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(channels);
        let gated = array_config
            .get("gated")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let gating = match array_config.get("gating_mode").and_then(Value::as_str) {
            Some("gated") => GatingMode::Gated,
            Some("blended") => GatingMode::Blended,
            Some("none") => GatingMode::None,
            Some(other) => {
                return Err(NamModelError::InvalidConfig(format!(
                    "unknown gating_mode \"{other}\""
                )));
            }
            None if gated => GatingMode::Gated,
            None => GatingMode::None,
        };
        let out2 = if gating == GatingMode::None {
            bottleneck
        } else {
            2 * bottleneck
        };

        let layer1x1_active = array_config
            .get("layer1x1")
            .and_then(|value| value.get("active"))
            .and_then(Value::as_bool)
            // NAMCore defaults layer1x1 to active.
            .unwrap_or(true);
        if !layer1x1_active && bottleneck != channels {
            return Err(NamModelError::InvalidConfig(
                "layer1x1 inactive requires bottleneck == channels".into(),
            ));
        }
        let head1x1_out = array_config
            .get("head1x1")
            .filter(|value| {
                value
                    .get("active")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .and_then(|value| value.get("out_channels"))
            .and_then(Value::as_u64)
            .map(|value| value as usize);

        let activation =
            Activation::from_json(array_config.get("activation").ok_or_else(|| {
                NamModelError::InvalidConfig("WaveNet layer array requires activation".into())
            })?)?;
        let secondary = if gating == GatingMode::None {
            None
        } else {
            Some(match array_config.get("secondary_activation") {
                Some(value) => Activation::from_json(value)?,
                // NAMCore's backward-compatible default for gated layers.
                None => Activation::Sigmoid,
            })
        };

        let conv = Conv1d::from_weights(channels, out2, kernel_size, dilation, true, weights)?;
        let input_mixin = Conv1x1::from_weights(condition_size, out2, false, weights)?;
        let layer1x1 = if layer1x1_active {
            Some(Conv1x1::from_weights(bottleneck, channels, true, weights)?)
        } else {
            None
        };
        let head1x1 = match head1x1_out {
            Some(out_channels) => Some(Conv1x1::from_weights(
                bottleneck,
                out_channels,
                true,
                weights,
            )?),
            None => None,
        };

        let head_out_size = head1x1.as_ref().map_or(bottleneck, Conv1x1::out_channels);
        Ok(WavenetLayer {
            conv,
            input_mixin,
            layer1x1,
            head1x1,
            activation,
            secondary,
            gating,
            bottleneck,
            z: vec![0.0; out2],
            residual: vec![0.0; channels],
            head_out: vec![0.0; head_out_size],
            mixin: vec![0.0; out2],
        })
    }

    /// Runs the layer for one sample. `input` is the previous layer's residual
    /// output; `condition` is the raw input. The head contribution accumulates
    /// into `head_input` (NAMCore's skip connection), and the residual branch
    /// lands in `self.residual`.
    fn process(&mut self, input: &[f32], condition: &[f32], head_input: &mut [f32]) {
        let bottleneck = self.bottleneck;
        let z_len = self.z.len();

        self.conv.process(input, &mut self.z);
        self.input_mixin.process(condition, &mut self.mixin);
        for index in 0..z_len {
            self.z[index] += self.mixin[index];
        }

        match self.gating {
            GatingMode::None => {
                for index in 0..bottleneck {
                    self.z[index] = self.activation.apply(self.z[index], index);
                }
            }
            GatingMode::Gated | GatingMode::Blended => {
                let secondary = self
                    .secondary
                    .as_ref()
                    .expect("gated layer carries a secondary activation");
                // NAMCore's gating/blending both multiply the primary act on
                // the top half by the secondary act on the bottom half.
                for index in 0..bottleneck {
                    let primary = self.activation.apply(self.z[index], index);
                    let gate = secondary.apply(self.z[bottleneck + index], index);
                    self.z[index] = primary * gate;
                }
            }
        }

        match &self.layer1x1 {
            Some(layer1x1) => {
                layer1x1.process(&self.z[..bottleneck], &mut self.residual);
                for (residual, input) in self.residual.iter_mut().zip(input) {
                    *residual += *input;
                }
            }
            None => {
                self.residual.copy_from_slice(input);
            }
        }

        match &self.head1x1 {
            Some(head1x1) => {
                head1x1.process(&self.z[..bottleneck], &mut self.head_out);
            }
            None => {
                self.head_out.copy_from_slice(&self.z[..bottleneck]);
            }
        }
        for (accumulated, head) in head_input.iter_mut().zip(&self.head_out) {
            *accumulated += *head;
        }
    }

    fn reset(&mut self) {
        self.conv.reset();
    }

    fn receptive_field(&self) -> usize {
        self.conv.receptive_field()
    }
}

struct WavenetLayerArray {
    rechannel: Conv1x1,
    layers: Vec<WavenetLayer>,
    head_rechannel: Conv1d,
    /// Channel count this array's head contributions accumulate into
    /// (head1x1 out channels, or the bottleneck).
    head_input_size: usize,
    /// Accumulated per-layer head contributions for the current sample.
    head_inputs: Vec<f32>,
    /// Last layer's residual output; the next array's input.
    layer_output: Vec<f32>,
    /// Scratch: rechannel output (first layer's input).
    rechannel_out: Vec<f32>,
    /// This array's head output (post head rechannel).
    head_output: Vec<f32>,
}

impl WavenetLayerArray {
    fn from_config(
        array_config: &Value,
        weights: &mut &[f32],
    ) -> Result<WavenetLayerArray, NamModelError> {
        reject_unsupported_features(array_config)?;
        let input_size = read_usize(array_config, "input_size")?;
        let condition_size = read_usize(array_config, "condition_size")?;
        let channels = read_usize(array_config, "channels")?;
        let head_bias = read_bool(array_config, "head_bias")?;
        let dilations: Vec<usize> = array_config
            .get("dilations")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("WaveNet layer array requires dilations".into())
            })?
            .iter()
            .map(|value| {
                value.as_u64().map(|value| value as usize).ok_or_else(|| {
                    NamModelError::InvalidConfig(
                        "WaveNet dilations must be positive integers".into(),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if dilations.is_empty() {
            return Err(NamModelError::InvalidConfig(
                "WaveNet layer array requires at least one dilation".into(),
            ));
        }

        // Kernel sizes: either one `kernel_size` for every layer, or a
        // per-layer `kernel_sizes` array (NAMCore supports both).
        let kernel_sizes: Vec<usize> = match array_config.get("kernel_sizes") {
            Some(values) => {
                let values = values.as_array().ok_or_else(|| {
                    NamModelError::InvalidConfig("WaveNet kernel_sizes must be an array".into())
                })?;
                if values.len() != dilations.len() {
                    return Err(NamModelError::InvalidConfig(
                        "WaveNet kernel_sizes length must match dilations length".into(),
                    ));
                }
                values
                    .iter()
                    .map(|value| {
                        value.as_u64().map(|value| value as usize).ok_or_else(|| {
                            NamModelError::InvalidConfig(
                                "WaveNet kernel_sizes must be integers".into(),
                            )
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?
            }
            None => {
                let kernel_size = read_usize(array_config, "kernel_size")?;
                vec![kernel_size; dilations.len()]
            }
        };

        // Array head: either the nested `head` object (out_channels,
        // kernel_size, bias, optional head_dilation) or the legacy
        // `head_size` + `head_bias` pair (implicit kernel size 1).
        let (head_size, head_kernel_size, head_dilation, head_bias) = match array_config.get("head")
        {
            Some(head_config) if !head_config.is_null() => {
                let head_size = head_config
                    .get("out_channels")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize)
                    .ok_or_else(|| {
                        NamModelError::InvalidConfig("WaveNet head requires out_channels".into())
                    })?;
                let kernel_size = head_config
                    .get("kernel_size")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize)
                    .ok_or_else(|| {
                        NamModelError::InvalidConfig("WaveNet head requires kernel_size".into())
                    })?;
                if kernel_size < 1 {
                    return Err(NamModelError::InvalidConfig(
                        "WaveNet head kernel_size must be >= 1".into(),
                    ));
                }
                let dilation = head_config
                    .get("head_dilation")
                    .and_then(Value::as_u64)
                    .map(|value| value as usize)
                    .unwrap_or(1);
                let bias = head_config
                    .get("bias")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| {
                        NamModelError::InvalidConfig("WaveNet head requires bias".into())
                    })?;
                (head_size, kernel_size, dilation, bias)
            }
            _ => (read_usize(array_config, "head_size")?, 1, 1, head_bias),
        };

        let rechannel = Conv1x1::from_weights(input_size, channels, false, weights)?;
        let mut layers = Vec::with_capacity(dilations.len());
        for (dilation, kernel_size) in dilations.into_iter().zip(kernel_sizes) {
            layers.push(WavenetLayer::from_array_config(
                array_config,
                kernel_size,
                dilation,
                channels,
                condition_size,
                weights,
            )?);
        }
        let head_input_size = layers
            .first()
            .and_then(|layer| layer.head1x1.as_ref().map(Conv1x1::out_channels))
            .unwrap_or_else(|| layers.first().map_or(channels, |layer| layer.bottleneck));
        let head_rechannel = Conv1d::from_weights(
            head_input_size,
            head_size,
            head_kernel_size,
            head_dilation,
            head_bias,
            weights,
        )?;

        Ok(WavenetLayerArray {
            head_output: vec![0.0; head_size],
            rechannel,
            layers,
            head_input_size,
            head_rechannel,
            head_inputs: vec![0.0; head_input_size],
            layer_output: vec![0.0; channels],
            rechannel_out: vec![0.0; channels],
        })
    }

    /// `head_inputs_seed` is `None` for the first array (zero-accumulate) and
    /// `Some(previous array head output)` otherwise. Returns this array's head
    /// output.
    fn process(
        &mut self,
        input: &[f32],
        condition: &[f32],
        head_inputs_seed: Option<&[f32]>,
    ) -> &[f32] {
        match head_inputs_seed {
            Some(seed) => self.head_inputs.copy_from_slice(seed),
            None => self.head_inputs.fill(0.0),
        }

        self.rechannel.process(input, &mut self.rechannel_out);
        let mut first_layer = true;
        for index in 0..self.layers.len() {
            let (left, right) = self.layers.split_at_mut(index);
            let input: &[f32] = if first_layer {
                &self.rechannel_out
            } else {
                &left[index - 1].residual
            };
            right[0].process(input, condition, &mut self.head_inputs);
            first_layer = false;
        }
        let last = self.layers.len() - 1;
        self.layer_output
            .copy_from_slice(&self.layers[last].residual);

        self.head_rechannel
            .process(&self.head_inputs, &mut self.head_output);
        &self.head_output
    }

    fn reset(&mut self) {
        for layer in &mut self.layers {
            layer.reset();
        }
        self.head_rechannel.reset();
    }

    fn receptive_field(&self) -> usize {
        self.layers
            .iter()
            .map(WavenetLayer::receptive_field)
            .sum::<usize>()
            + self.head_rechannel.receptive_field()
    }
}

/// Post-stack head: repeated (activation -> Conv1D) with dilation 1.
struct PostStackHead {
    convs: Vec<Conv1d>,
    activations: Vec<Activation>,
    /// Ping buffers sized to the widest conv.
    scratch_a: Vec<f32>,
    scratch_b: Vec<f32>,
}

impl PostStackHead {
    fn from_config(
        head_config: &Value,
        in_channels: usize,
        weights: &mut &[f32],
    ) -> Result<PostStackHead, NamModelError> {
        let channels = head_config
            .get("channels")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .ok_or_else(|| NamModelError::InvalidConfig("WaveNet head requires channels".into()))?;
        let out_channels = head_config
            .get("out_channels")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("WaveNet head requires out_channels".into())
            })?;
        let kernel_sizes: Vec<usize> = head_config
            .get("kernel_sizes")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("WaveNet head requires kernel_sizes".into())
            })?
            .iter()
            .map(|value| {
                value.as_u64().map(|value| value as usize).ok_or_else(|| {
                    NamModelError::InvalidConfig(
                        "WaveNet head kernel_sizes must be integers".into(),
                    )
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if kernel_sizes.is_empty() {
            return Err(NamModelError::InvalidConfig(
                "WaveNet head kernel_sizes must be non-empty".into(),
            ));
        }
        let activation =
            Activation::from_json(head_config.get("activation").ok_or_else(|| {
                NamModelError::InvalidConfig("WaveNet head requires activation".into())
            })?)?;

        let mut convs = Vec::with_capacity(kernel_sizes.len());
        let mut cin = in_channels;
        let last = kernel_sizes.len() - 1;
        for (index, kernel_size) in kernel_sizes.into_iter().enumerate() {
            let cout = if index == last {
                out_channels
            } else {
                channels
            };
            convs.push(Conv1d::from_weights(
                cin,
                cout,
                kernel_size,
                1,
                true,
                weights,
            )?);
            cin = cout;
        }
        let widest = convs
            .iter()
            .map(|conv| conv.output_channels())
            .max()
            .unwrap_or(1)
            .max(in_channels);
        Ok(PostStackHead {
            activations: vec![activation; convs.len()],
            convs,
            scratch_a: vec![0.0; widest],
            scratch_b: vec![0.0; widest],
        })
    }

    fn process(&mut self, input: &[f32]) -> &[f32] {
        let last = self.convs.len() - 1;
        self.scratch_a[..input.len()].copy_from_slice(input);
        for index in 0..self.convs.len() {
            // Borrow the activation in place: this loop runs per conv per
            // sample on the audio thread, and cloning a `Prelu(Vec<f32>)`
            // activation would allocate there. The field borrows stay
            // disjoint — `activations` immutably, `convs` and the scratch
            // buffers mutably.
            let activation = &self.activations[index];
            let in_len = self.convs[index].input_channels();
            // NAMCore applies each conv's activation to the conv input in
            // place, then runs the conv.
            for (channel, value) in self.scratch_a[..in_len].iter_mut().enumerate() {
                *value = activation.apply(*value, channel);
            }
            self.convs[index].process(&self.scratch_a[..in_len], &mut self.scratch_b);
            if index != last {
                let out_len = self.convs[index].output_channels();
                self.scratch_a[..out_len].copy_from_slice(&self.scratch_b[..out_len]);
            }
        }
        &self.scratch_b
    }

    fn reset(&mut self) {
        for conv in &mut self.convs {
            conv.reset();
        }
    }

    fn receptive_field(&self) -> usize {
        self.convs.iter().map(Conv1d::receptive_field).sum()
    }
}

/// The complete WaveNet network.
pub struct WavenetModel {
    layer_arrays: Vec<WavenetLayerArray>,
    head_scale: f32,
    post_head: Option<PostStackHead>,
    condition: Vec<f32>,
    /// Input carried between layer arrays.
    layer_io: Vec<f32>,
    /// Head output carried between layer arrays.
    head_io: Vec<f32>,
    /// Post-stack head input (scaled final head outputs).
    scaled: Vec<f32>,
}

impl WavenetModel {
    pub(super) fn from_config(
        config: &Value,
        weights: &mut &[f32],
        sample_rate: Option<f64>,
    ) -> Result<WavenetModel, NamModelError> {
        // The DSP math is rate-agnostic; NAMCore uses the rate only for
        // warnings and resampling metadata.
        let _ = sample_rate;
        let layers = config
            .get("layers")
            .and_then(Value::as_array)
            .ok_or_else(|| NamModelError::InvalidConfig("WaveNet config requires layers".into()))?;
        if layers.is_empty() {
            return Err(NamModelError::InvalidConfig(
                "WaveNet config requires at least one layer array".into(),
            ));
        }
        let in_channels = config
            .get("in_channels")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(1);
        if in_channels != 1 {
            return Err(NamModelError::InvalidConfig(format!(
                "multi-channel WaveNet input ({in_channels} channels) is not supported; Grinder captures are mono"
            )));
        }

        // NAMCore validates channels[i] == head_size[i-1] in the constructor
        // and asserts input_size[i] == channels[i-1] at prewarm time; both
        // chains are structural, so reject violations explicitly at parse.
        for index in 1..layers.len() {
            let previous_channels = layers[index - 1].get("channels").and_then(Value::as_u64);
            let previous_head = layers[index - 1].get("head_size").and_then(Value::as_u64);
            let input_size = layers[index].get("input_size").and_then(Value::as_u64);
            let channels = layers[index].get("channels").and_then(Value::as_u64);
            if input_size != previous_channels {
                return Err(NamModelError::InvalidConfig(format!(
                    "layer array {index}: input_size must equal the preceding array's channels"
                )));
            }
            if channels != previous_head {
                return Err(NamModelError::InvalidConfig(format!(
                    "layer array {index}: channels must equal the preceding array's head_size"
                )));
            }
        }

        let mut layer_arrays = Vec::with_capacity(layers.len());
        for array_config in layers {
            layer_arrays.push(WavenetLayerArray::from_config(array_config, weights)?);
        }

        // The config block's head_scale is superseded by the trailing weight
        // (see below); it is not read.
        let _head_scale_config = config.get("head_scale").and_then(Value::as_f64);

        let with_head = config.get("head").is_some_and(|value| !value.is_null());
        let post_head = if with_head {
            let head_config = config.get("head").expect("checked above");
            let head_size = layer_arrays
                .last()
                .map(|array| array.head_rechannel.output_channels())
                .unwrap_or(1);
            Some(PostStackHead::from_config(head_config, head_size, weights)?)
        } else {
            None
        };

        // The chain feeding each array's head accumulation is structural:
        // array i's head inputs carry the previous array's head output.
        for index in 1..layer_arrays.len() {
            let previous_head_size = layer_arrays[index - 1].head_output.len();
            let head_input_size = layer_arrays[index].head_input_size;
            if head_input_size != previous_head_size {
                return Err(NamModelError::InvalidConfig(format!(
                    "layer array {index}: head input size ({head_input_size}) must equal the preceding array's head_size ({previous_head_size})"
                )));
            }
        }

        // NAMCore reads the head scale from the single trailing weight
        // (`_head_scale = *(it++)` in `set_weights_`), replacing whatever the
        // config block declared — the weight wins.
        let trailing_head_scale = if weights.len() == 1 {
            weights[0]
        } else {
            return Err(NamModelError::WeightCountMismatch {
                expected: 1,
                actual: weights.len(),
            });
        };
        *weights = &[];

        // Every array reads the raw input as its condition (no condition DSP
        // is supported, so the conditioning dimension is the input itself).
        for (index, array_config) in layers.iter().enumerate() {
            let condition_size = array_config
                .get("condition_size")
                .and_then(Value::as_u64)
                .map(|value| value as usize);
            if condition_size != Some(1) {
                return Err(NamModelError::InvalidConfig(format!(
                    "layer array {index}: condition_size must be 1 for non-parametric captures"
                )));
            }
        }

        let head_size = layer_arrays
            .iter()
            .map(|array| array.head_output.len())
            .max()
            .unwrap_or(1);
        let last_head_size = layer_arrays
            .last()
            .map(|array| array.head_output.len())
            .unwrap_or(1);
        let first_channels = layer_arrays
            .first()
            .map(|array| array.layer_output.len())
            .unwrap_or(1);
        Ok(WavenetModel {
            layer_arrays,
            head_scale: trailing_head_scale,
            post_head,
            condition: vec![0.0; 1],
            layer_io: vec![0.0; first_channels],
            head_io: vec![0.0; head_size],
            scaled: vec![0.0; last_head_size],
        })
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        self.condition[0] = input;
        let array_count = self.layer_arrays.len();
        for index in 0..array_count {
            let (array_input, seed): (&[f32], Option<&[f32]>) = if index == 0 {
                (&self.condition, None)
            } else {
                (&self.layer_io, Some(&self.head_io))
            };
            let feeds_next = index + 1 < array_count;
            let array = &mut self.layer_arrays[index];
            let head_output = array.process(array_input, &self.condition, seed);
            self.head_io[..head_output.len()].copy_from_slice(head_output);
            if feeds_next {
                self.layer_io.copy_from_slice(&array.layer_output);
            }
        }
        // Zero the tail the last (shorter) head output did not cover, so the
        // next sample's seed can never read a stale value.
        for value in self.head_io[self.layer_arrays[self.layer_arrays.len() - 1]
            .head_output
            .len()..]
            .iter_mut()
        {
            *value = 0.0;
        }

        if let Some(head) = &mut self.post_head {
            for (scaled, value) in self.scaled.iter_mut().zip(&self.head_io) {
                *scaled = self.head_scale * *value;
            }
            head.process(&self.scaled)[0]
        } else {
            self.head_scale * self.head_io[0]
        }
    }

    pub fn reset(&mut self) {
        for array in &mut self.layer_arrays {
            array.reset();
        }
        if let Some(head) = &mut self.post_head {
            head.reset();
        }
    }

    pub fn prewarm_samples(&self) -> usize {
        let head = self
            .post_head
            .as_ref()
            .map_or(0, PostStackHead::receptive_field);
        1 + self
            .layer_arrays
            .iter()
            .map(WavenetLayerArray::receptive_field)
            .sum::<usize>()
            + head
    }
}
