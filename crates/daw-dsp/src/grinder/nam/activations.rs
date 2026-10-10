//! Activation functions for NAM models, mirroring NeuralAmpModelerCore's
//! `NAM/activations` formulas exactly (the precise `f32` variants — NAMCore
//! swaps in fast approximations only behind an opt-in flag that is off by
//! default).

use super::NamModelError;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub enum Activation {
    Tanh,
    Hardtanh,
    Fasttanh,
    Relu,
    LeakyRelu(f32),
    /// Per-channel learned slopes (channel index resolved at apply time).
    Prelu(Vec<f32>),
    Sigmoid,
    Silu,
    Hardswish,
    LeakyHardtanh {
        min_val: f32,
        max_val: f32,
        min_slope: f32,
        max_slope: f32,
    },
    Softsign,
}

impl Activation {
    /// Parse an `ActivationConfig` — a bare string (`"Tanh"`) or an object
    /// with a `type` key plus per-type optional parameters.
    pub fn from_json(value: &Value) -> Result<Activation, NamModelError> {
        let (name, value) = if let Some(name) = value.as_str() {
            (name.to_string(), None)
        } else {
            let name = value.get("type").and_then(Value::as_str).ok_or_else(|| {
                NamModelError::InvalidConfig("activation requires a name or a type object".into())
            })?;
            (name.to_string(), Some(value))
        };

        let activation = match name.as_str() {
            "Tanh" => Activation::Tanh,
            "Hardtanh" => Activation::Hardtanh,
            "Fasttanh" => Activation::Fasttanh,
            "ReLU" => Activation::Relu,
            "LeakyReLU" => {
                let slope = value
                    .and_then(|object| object.get("negative_slope"))
                    .and_then(Value::as_f64)
                    .map(|slope| slope as f32)
                    .unwrap_or(0.01);
                Activation::LeakyRelu(slope)
            }
            "PReLU" => {
                let slopes = match value.map(|object| object.get("negative_slope")) {
                    Some(Some(slope)) => vec![slope.as_f64().ok_or_else(|| {
                        NamModelError::InvalidConfig("PReLU negative_slope must be a number".into())
                    })? as f32],
                    _ => {
                        let slopes = value
                            .map(|object| object.get("negative_slopes"))
                            .and_then(|slopes| slopes)
                            .and_then(Value::as_array)
                            .ok_or_else(|| {
                                NamModelError::InvalidConfig(
                                    "PReLU requires negative_slope or negative_slopes".into(),
                                )
                            })?;
                        slopes
                            .iter()
                            .map(|slope| {
                                slope.as_f64().map(|slope| slope as f32).ok_or_else(|| {
                                    NamModelError::InvalidConfig(
                                        "PReLU slopes must be numbers".into(),
                                    )
                                })
                            })
                            .collect::<Result<Vec<_>, _>>()?
                    }
                };
                if slopes.is_empty() {
                    // `apply` resolves the channel slope as
                    // `slopes.get(channel).unwrap_or(slopes[0])`, so a
                    // slope-less PReLU would panic on the first sample.
                    return Err(NamModelError::InvalidConfig(
                        "PReLU requires at least one negative slope".into(),
                    ));
                }
                Activation::Prelu(slopes)
            }
            "Sigmoid" => Activation::Sigmoid,
            "SiLU" => Activation::Silu,
            "Hardswish" => Activation::Hardswish,
            "LeakyHardtanh" | "LeakyHardTanh" => {
                let read = |key: &str, default: f32| -> f32 {
                    value
                        .and_then(|object| object.get(key))
                        .and_then(Value::as_f64)
                        .map(|value| value as f32)
                        .unwrap_or(default)
                };
                Activation::LeakyHardtanh {
                    min_val: read("min_val", -1.0),
                    max_val: read("max_val", 1.0),
                    min_slope: read("min_slope", 0.01),
                    max_slope: read("max_slope", 0.01),
                }
            }
            "Softsign" => Activation::Softsign,
            other => {
                return Err(NamModelError::InvalidConfig(format!(
                    "unknown activation \"{other}\""
                )));
            }
        };
        Ok(activation)
    }

    /// Apply to one sample. `channel` selects the learned slope for PReLU.
    #[inline]
    pub fn apply(&self, x: f32, channel: usize) -> f32 {
        match self {
            Activation::Tanh => tanh(x),
            Activation::Hardtanh => x.clamp(-1.0, 1.0),
            // NAMCore's polynomial rational approximation; shipped as its own
            // variant because trained models name it explicitly.
            Activation::Fasttanh => {
                let ax = x.abs();
                let x2 = x * x;
                x * (2.455_507_5_f32
                    + 2.455_507_5_f32 * ax
                    + (0.893_229_85_f32 + 0.821_226_67_f32 * ax) * x2)
                    / (2.445_066_3_f32
                        + (2.445_066_3_f32 + x2) * (x + 0.814_642_73_f32 * x * ax).abs())
            }
            Activation::Relu => x.max(0.0),
            Activation::LeakyRelu(slope) => {
                if x > 0.0 {
                    x
                } else {
                    slope * x
                }
            }
            Activation::Prelu(slopes) => {
                let slope = slopes.get(channel).copied().unwrap_or(slopes[0]);
                if x > 0.0 {
                    x
                } else {
                    slope * x
                }
            }
            Activation::Sigmoid => sigmoid(x),
            Activation::Silu => x * sigmoid(x),
            Activation::Hardswish => {
                let t = x + 3.0;
                let clamped = t.clamp(0.0, 6.0);
                x * clamped * (1.0 / 6.0)
            }
            Activation::LeakyHardtanh {
                min_val,
                max_val,
                min_slope,
                max_slope,
            } => {
                if x < *min_val {
                    (x - min_val) * min_slope + min_val
                } else if x > *max_val {
                    (x - max_val) * max_slope + max_val
                } else {
                    x
                }
            }
            Activation::Softsign => x / (1.0 + x.abs()),
        }
    }
}

#[inline]
pub fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

#[inline]
pub fn tanh(x: f32) -> f32 {
    // f32::tanh maps to the same libm semantics as C's tanhf on the targets
    // NAMCore builds for; residual ULP differences are covered by the parity
    // tolerance pinned in the fixture tests.
    x.tanh()
}
