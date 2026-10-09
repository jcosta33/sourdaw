//! Linear (FIR) runtime mirroring NAMCore's `NAM/linear.cpp` for the mono
//! captures Grinder hosts: a `receptive_field`-tap impulse response plus an
//! optional bias. NAMCore additionally resamples the impulse response when the
//! file's sample rate differs from the host rate; this runtime rejects that
//! case instead of silently skipping the resample.

use serde_json::Value;

use super::NamModelError;

pub struct LinearModel {
    /// Impulse response in NAMCore's stored order (oldest tap first).
    impulse_response: Vec<f32>,
    bias: f32,
    history: Vec<f32>,
    write_pos: usize,
    /// Reject marker set at construction when the file expects a different
    /// sample rate than the engine runs; surfaced by the loader.
    #[allow(dead_code)]
    sample_rate_mismatch: bool,
}

impl LinearModel {
    pub(super) fn from_config(
        config: &Value,
        weights: &mut &[f32],
        sample_rate: Option<f64>,
    ) -> Result<LinearModel, NamModelError> {
        let receptive_field = config
            .get("receptive_field")
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .ok_or_else(|| {
                NamModelError::InvalidConfig("Linear config requires receptive_field".into())
            })?;
        let bias = config
            .get("bias")
            .and_then(Value::as_bool)
            .ok_or_else(|| NamModelError::InvalidConfig("Linear config requires bias".into()))?;
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
        if in_channels != 1 || out_channels != 1 {
            return Err(NamModelError::InvalidConfig(format!(
                "multi-channel Linear ({in_channels} -> {out_channels}) is not supported; Grinder captures are mono"
            )));
        }
        if sample_rate.is_some_and(|rate| (rate - 48_000.0).abs() > 1.0) {
            // NAMCore resamples the impulse response for this case; skipping
            // that would change the transfer function, so refuse instead.
            return Err(NamModelError::InvalidConfig(
                "Linear capture recorded at a different sample rate than the engine; impulse-response resampling is not supported".into(),
            ));
        }

        let needed = receptive_field + usize::from(bias);
        if weights.len() != needed {
            return Err(NamModelError::WeightCountMismatch {
                expected: needed,
                actual: weights.len(),
            });
        }
        let impulse_response = weights[..receptive_field].to_vec();
        let bias_value = if bias { weights[receptive_field] } else { 0.0 };
        *weights = &[];

        Ok(LinearModel {
            impulse_response,
            bias: bias_value,
            history: vec![0.0; receptive_field.max(1)],
            write_pos: 0,
            sample_rate_mismatch: false,
        })
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        let len = self.history.len();
        self.history[self.write_pos] = input;
        // y = sum_j ir[j] * x(t - (rf - 1 - j)) — plain FIR convolution.
        let mut sum = self.bias;
        let taps = self.impulse_response.len();
        for (j, weight) in self.impulse_response.iter().enumerate() {
            let delay = taps - 1 - j;
            let read_pos = (self.write_pos + len - delay) % len;
            sum += weight * self.history[read_pos];
        }
        self.write_pos += 1;
        if self.write_pos == len {
            self.write_pos = 0;
        }
        sum
    }

    pub fn reset(&mut self) {
        self.history.fill(0.0);
        self.write_pos = 0;
    }

    pub fn prewarm_samples(&self) -> usize {
        self.impulse_response.len()
    }
}
