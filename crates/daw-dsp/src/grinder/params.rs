//! Parameter smoothing and utility functions for Grinder.

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GrinderAutomatableParamDomain {
    Raw,
    DecibelsToLinear,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GrinderAutomatableParamDescriptor {
    pub name: &'static str,
    pub minimum: f32,
    pub maximum: f32,
    pub default: f32,
    pub domain: GrinderAutomatableParamDomain,
}

impl GrinderAutomatableParamDescriptor {
    pub fn clamp(self, value: f32) -> Option<f32> {
        value
            .is_finite()
            .then(|| value.clamp(self.minimum, self.maximum))
    }
}

pub const GRINDER_AUTOMATABLE_PARAM_CONTRACT: [GrinderAutomatableParamDescriptor; 11] = [
    GrinderAutomatableParamDescriptor {
        name: "gain",
        minimum: 0.0,
        maximum: 10.0,
        default: 5.0,
        domain: GrinderAutomatableParamDomain::Raw,
    },
    GrinderAutomatableParamDescriptor {
        name: "bass",
        minimum: 0.0,
        maximum: 10.0,
        default: 5.0,
        domain: GrinderAutomatableParamDomain::Raw,
    },
    GrinderAutomatableParamDescriptor {
        name: "mid",
        minimum: 0.0,
        maximum: 10.0,
        default: 5.0,
        domain: GrinderAutomatableParamDomain::Raw,
    },
    GrinderAutomatableParamDescriptor {
        name: "treble",
        minimum: 0.0,
        maximum: 10.0,
        default: 5.0,
        domain: GrinderAutomatableParamDomain::Raw,
    },
    GrinderAutomatableParamDescriptor {
        name: "presence",
        minimum: 0.0,
        maximum: 10.0,
        default: 5.0,
        domain: GrinderAutomatableParamDomain::Raw,
    },
    GrinderAutomatableParamDescriptor {
        name: "resonance",
        minimum: 0.0,
        maximum: 10.0,
        default: 5.0,
        domain: GrinderAutomatableParamDomain::Raw,
    },
    GrinderAutomatableParamDescriptor {
        name: "master",
        minimum: 0.0,
        maximum: 10.0,
        default: 5.0,
        domain: GrinderAutomatableParamDomain::Raw,
    },
    GrinderAutomatableParamDescriptor {
        name: "inputGain",
        minimum: -24.0,
        maximum: 24.0,
        default: 0.0,
        domain: GrinderAutomatableParamDomain::DecibelsToLinear,
    },
    GrinderAutomatableParamDescriptor {
        name: "outputGain",
        minimum: -24.0,
        maximum: 24.0,
        default: 0.0,
        domain: GrinderAutomatableParamDomain::DecibelsToLinear,
    },
    GrinderAutomatableParamDescriptor {
        name: "transformerDrive",
        minimum: 0.0,
        maximum: 1.0,
        default: 0.3,
        domain: GrinderAutomatableParamDomain::Raw,
    },
    GrinderAutomatableParamDescriptor {
        name: "negFeedback",
        minimum: 0.0,
        maximum: 1.0,
        default: 0.5,
        domain: GrinderAutomatableParamDomain::Raw,
    },
];

pub const GRINDER_AUTOMATABLE_PARAM_COUNT: usize = GRINDER_AUTOMATABLE_PARAM_CONTRACT.len();

pub fn get_automatable_param_index(name: &str) -> Option<usize> {
    match name {
        "gain" => Some(0),
        "bass" => Some(1),
        "mid" => Some(2),
        "treble" => Some(3),
        "presence" => Some(4),
        "resonance" => Some(5),
        "master" => Some(6),
        "inputGain" => Some(7),
        "outputGain" => Some(8),
        "transformerDrive" => Some(9),
        "negFeedback" => Some(10),
        _ => None,
    }
}

pub fn get_automatable_param_descriptor(
    name: &str,
) -> Option<&'static GrinderAutomatableParamDescriptor> {
    get_automatable_param_index(name)
        .and_then(|index| GRINDER_AUTOMATABLE_PARAM_CONTRACT.get(index))
}

pub fn normalize_automatable_param(name: &str, value: f32) -> Option<f32> {
    get_automatable_param_descriptor(name).and_then(|param| param.clamp(value))
}

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
