//! Parameter smoothing and utility functions for Grinder.

/// One-pole smoothing filter for parameter changes.
pub struct SmoothedParam {
    current: f32,
    target: f32,
    coeff: f32,
}

impl SmoothedParam {
    pub fn new(initial: f32, smooth_ms: f32, sample_rate: f32) -> Self {
        let coeff = if smooth_ms > 0.0 {
            (-1.0 / (smooth_ms * 0.001 * sample_rate)).exp()
        } else {
            0.0
        };
        Self {
            current: initial,
            target: initial,
            coeff,
        }
    }

    pub fn set_target(&mut self, target: f32) {
        self.target = target;
    }
    pub fn next(&mut self) -> f32 {
        self.current = self.target + self.coeff * (self.current - self.target);
        self.current
    }
    pub fn current(&self) -> f32 {
        self.current
    }
    pub fn snap(&mut self) {
        self.current = self.target;
    }
}

pub fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}
pub fn linear_to_db(linear: f32) -> f32 {
    if linear <= 0.0 {
        -100.0
    } else {
        20.0 * linear.log10()
    }
}

#[cfg(test)]
mod tests {
    use super::{GrinderAutomatableParamDomain, GRINDER_AUTOMATABLE_PARAM_CONTRACT};

    #[test]
    fn automatable_param_contract() {
        let actual = GRINDER_AUTOMATABLE_PARAM_CONTRACT
            .iter()
            .map(|param| {
                (
                    param.name,
                    param.minimum,
                    param.maximum,
                    param.default,
                    param.domain,
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            actual,
            vec![
                ("gain", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
                ("bass", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
                ("mid", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
                ("treble", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
                ("presence", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
                ("resonance", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
                ("master", 0.0, 10.0, 5.0, GrinderAutomatableParamDomain::Raw),
                (
                    "inputGain",
                    -24.0,
                    24.0,
                    0.0,
                    GrinderAutomatableParamDomain::DecibelsToLinear,
                ),
                (
                    "outputGain",
                    -24.0,
                    24.0,
                    0.0,
                    GrinderAutomatableParamDomain::DecibelsToLinear,
                ),
                (
                    "transformerDrive",
                    0.0,
                    1.0,
                    0.3,
                    GrinderAutomatableParamDomain::Raw,
                ),
                (
                    "negFeedback",
                    0.0,
                    1.0,
                    0.5,
                    GrinderAutomatableParamDomain::Raw,
                ),
            ]
        );
    }
}
