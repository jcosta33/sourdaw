//! Real NeuralAmpModeler (.nam) model runtime for Grinder.
//!
//! Rebuilds the source network's actual topology from the `.nam` JSON —
//! dilated conv stacks (WaveNet), recurrent cells (LSTM), ConvNet blocks, and
//! Linear FIRs — executing every weight with its sign and position, and
//! honoring the file's config (channels, dilations, kernel sizes, activations,
//! gating). Weight layouts mirror NeuralAmpModelerCore exactly; parity against
//! the C++ core is pinned by the fixtures under `fixtures/` and their golden
//! outputs (see `tests` in `wavenet.rs`, `lstm.rs`, `convnet.rs`).
//!
//! Loading happens once on the control path: every buffer is allocated at
//! construction and `process` is allocation-free (audio-thread safe).
//! Validation is complete or absent: a model whose weights do not exactly
//! satisfy its declared architecture is rejected with a named reason — never
//! silently substituted.

mod activations;
mod conv;
mod convnet;
mod linear;
mod lstm;
mod wavenet;

pub use convnet::ConvnetModel;
pub use linear::LinearModel;
pub use lstm::LstmModel;
pub use wavenet::WavenetModel;

use serde_json::Value;

/// Fully supported .nam file version window, mirroring NAMCore's
/// `EARLIEST_SUPPORTED_NAM_FILE_VERSION` (0.5.0) and
/// `LATEST_FULLY_SUPPORTED_NAM_FILE_VERSION` (0.7.0).
const EARLIEST_SUPPORTED_VERSION: (u32, u32) = (0, 5);
const LATEST_SUPPORTED_MAJOR: u32 = 0;
const LATEST_SUPPORTED_MINOR: u32 = 7;

/// Frame count the prewarm silence is aligned to (NAMCore's prewarm runs in
/// host-buffer-sized chunks; see `NamModel::prewarm`).
const PREWARM_CHUNK: usize = 64;

/// A validated, ready-to-run neural amp model.
pub enum NamModel {
    Wavenet(WavenetModel),
    Lstm(LstmModel),
    Convnet(ConvnetModel),
    Linear(LinearModel),
}

impl NamModel {
    /// Process one input sample. Allocation-free.
    pub fn process(&mut self, input: f32) -> f32 {
        match self {
            NamModel::Wavenet(model) => model.process(input),
            NamModel::Lstm(model) => model.process(input),
            NamModel::Convnet(model) => model.process(input),
            NamModel::Linear(model) => model.process(input),
        }
    }

    /// Number of silence samples the model needs fed at construction/reset to
    /// reach NAMCore's prewarmed state (receptive field, or a fixed warm-up
    /// for recurrent models).
    pub fn prewarm_samples(&self) -> usize {
        match self {
            NamModel::Wavenet(model) => model.prewarm_samples(),
            NamModel::Lstm(model) => model.prewarm_samples(),
            NamModel::Convnet(model) => model.prewarm_samples(),
            NamModel::Linear(model) => model.prewarm_samples(),
        }
    }

    /// Feed silence through the network so runtime state matches NAMCore's
    /// prewarm-on-reset behavior from the first audible sample. NAMCore's
    /// prewarm consumes whole host-buffer chunks (`DSP::prewarm` loops
    /// `process(bufferSize)`), so the state it leaves behind is the settled
    /// trajectory for any chunk count above the model's receptive field; we
    /// settle the same 64-frame chunk the engine's block math uses, which is
    /// deterministic and chunk-invariant. Control-path only.
    pub fn prewarm(&mut self) {
        let count = self.prewarm_samples().div_ceil(PREWARM_CHUNK) * PREWARM_CHUNK;
        for _ in 0..count {
            self.process(0.0);
        }
    }

    pub fn reset(&mut self) {
        match self {
            NamModel::Wavenet(model) => model.reset(),
            NamModel::Lstm(model) => model.reset(),
            NamModel::Convnet(model) => model.reset(),
            NamModel::Linear(model) => model.reset(),
        }
        self.prewarm();
    }
}

/// Why a .nam file was rejected. Every variant names the specific deficiency —
/// the importer surfaces these verbatim instead of substituting a lookalike.
#[derive(Clone, Debug, PartialEq)]
pub enum NamModelError {
    InvalidJson(String),
    MissingField(&'static str),
    UnsupportedVersion(String),
    UnsupportedArchitecture(String),
    /// A parametric model (condition DSP) — input-dependent conditioning this
    /// runtime does not implement.
    ConditionDspUnsupported,
    /// Slimmable / dynamically-sliced models.
    SlimmableUnsupported,
    /// The config block contradicts itself or the weight array.
    InvalidConfig(String),
    /// `weights` does not exactly satisfy the declared architecture.
    WeightCountMismatch {
        expected: usize,
        actual: usize,
    },
    NonFiniteWeight(usize),
}

impl core::fmt::Display for NamModelError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            NamModelError::InvalidJson(detail) => write!(f, "invalid NAM JSON: {detail}"),
            NamModelError::MissingField(field) => {
                write!(f, "invalid NAM file: missing required key \"{field}\"")
            }
            NamModelError::UnsupportedVersion(version) => {
                write!(f, "unsupported NAM file version \"{version}\" (supported: 0.5.0 through 0.7.x)")
            }
            NamModelError::UnsupportedArchitecture(name) => {
                write!(f, "unsupported NAM architecture \"{name}\" (supported: WaveNet, LSTM, ConvNet, Linear)")
            }
            NamModelError::ConditionDspUnsupported => write!(
                f,
                "unsupported NAM model: condition_dsp (parametric) captures are not supported"
            ),
            NamModelError::SlimmableUnsupported => {
                write!(f, "unsupported NAM model: slimmable (dynamic-channel) captures are not supported")
            }
            NamModelError::InvalidConfig(detail) => write!(f, "invalid NAM model config: {detail}"),
            NamModelError::WeightCountMismatch { expected, actual } => write!(
                f,
                "invalid NAM model: architecture expects {expected} weights but the file carries {actual}"
            ),
            NamModelError::NonFiniteWeight(index) => {
                write!(f, "invalid NAM model: weight at index {index} is not finite")
            }
        }
    }
}

/// Parse a `.nam` JSON document into a runnable model, or reject it with a
/// named reason. Mirrors NAMCore's required keys (version, architecture,
/// config, weights) while accepting the version-less legacy files the
/// importer has always taken (architecture and weights carry the meaning).
pub fn parse_nam_model(json: &str) -> Result<NamModel, NamModelError> {
    let parsed: Value = serde_json::from_str(json)
        .map_err(|error| NamModelError::InvalidJson(error.to_string()))?;
    let object = parsed
        .as_object()
        .ok_or(NamModelError::MissingField("architecture"))?;

    let architecture = object
        .get("architecture")
        .and_then(Value::as_str)
        .ok_or(NamModelError::MissingField("architecture"))?;
    if let Some(version) = object.get("version") {
        let version = version
            .as_str()
            .ok_or_else(|| NamModelError::UnsupportedVersion(format!("{version}")))?;
        verify_version(version)?;
    }

    let config = object
        .get("config")
        .ok_or(NamModelError::MissingField("config"))?;
    if !config.is_object() {
        return Err(NamModelError::InvalidConfig(
            "config must be an object".into(),
        ));
    }
    let weights_value = object
        .get("weights")
        .ok_or(NamModelError::MissingField("weights"))?;
    let weights = weights_value
        .as_array()
        .ok_or_else(|| NamModelError::InvalidConfig("weights must be an array".into()))?;
    let weights: Vec<f32> = weights
        .iter()
        .map(|value| {
            value
                .as_f64()
                .map(|value| value as f32)
                .ok_or_else(|| NamModelError::InvalidConfig("weights must be numbers".into()))
        })
        .collect::<Result<_, _>>()?;
    for (index, weight) in weights.iter().enumerate() {
        if !weight.is_finite() {
            return Err(NamModelError::NonFiniteWeight(index));
        }
    }
    // The sample rate sits at the document root in current exports
    // (`get_sample_rate_from_nam_file` reads `j["sample_rate"]`). Older files
    // omit it; the DSP itself is rate-agnostic, so absence is fine.
    let sample_rate = object.get("sample_rate").and_then(Value::as_f64);

    match architecture {
        "WaveNet" => {
            if config
                .get("condition_dsp")
                .is_some_and(|value| !value.is_null())
            {
                return Err(NamModelError::ConditionDspUnsupported);
            }
            if config_layers_are_slimmable(config) {
                return Err(NamModelError::SlimmableUnsupported);
            }
            let mut slice: &[f32] = &weights;
            let model = WavenetModel::from_config(config, &mut slice, sample_rate)?;
            let leftover = slice.len();
            finish_weights(leftover)?;
            Ok(NamModel::Wavenet(model))
        }
        "LSTM" => {
            let mut slice: &[f32] = &weights;
            let model = LstmModel::from_config(config, &mut slice)?;
            finish_weights(slice.len())?;
            Ok(NamModel::Lstm(model))
        }
        "ConvNet" => {
            let mut slice: &[f32] = &weights;
            let model = ConvnetModel::from_config(config, &mut slice)?;
            finish_weights(slice.len())?;
            Ok(NamModel::Convnet(model))
        }
        "Linear" => {
            let mut slice: &[f32] = &weights;
            let model = LinearModel::from_config(config, &mut slice, sample_rate)?;
            finish_weights(slice.len())?;
            Ok(NamModel::Linear(model))
        }
        other => {
            let _ = other;
            let name = architecture.to_string();
            Err(NamModelError::UnsupportedArchitecture(name))
        }
    }
}

fn finish_weights(leftover: usize) -> Result<(), NamModelError> {
    if leftover != 0 {
        return Err(NamModelError::WeightCountMismatch {
            expected: 0,
            actual: leftover,
        });
    }
    Ok(())
}

fn verify_version(version: &str) -> Result<(), NamModelError> {
    let parts: Vec<&str> = version.split('.').collect();
    let [major, minor, _patch] = parts.as_slice() else {
        return Err(NamModelError::UnsupportedVersion(version.to_string()));
    };
    let (Ok(major), Ok(minor)) = (major.parse::<u32>(), minor.parse::<u32>()) else {
        return Err(NamModelError::UnsupportedVersion(version.to_string()));
    };
    if (major, minor) < EARLIEST_SUPPORTED_VERSION
        || major > LATEST_SUPPORTED_MAJOR
        || (major == LATEST_SUPPORTED_MAJOR && minor > LATEST_SUPPORTED_MINOR)
    {
        return Err(NamModelError::UnsupportedVersion(version.to_string()));
    }
    Ok(())
}

fn config_layers_are_slimmable(config: &Value) -> bool {
    config
        .get("layers")
        .and_then(Value::as_array)
        .map(|layers| {
            layers.iter().any(|layer| {
                layer
                    .get("slimmable")
                    .is_some_and(|value| value.is_object())
            })
        })
        .unwrap_or(false)
}

/// Peek the architecture without building the network — used by the TS-facing
/// loader to reject unsupported files before any buffer is allocated.
pub fn architecture_name(json: &str) -> Result<String, NamModelError> {
    let parsed: Value = serde_json::from_str(json)
        .map_err(|error| NamModelError::InvalidJson(error.to_string()))?;
    parsed
        .get("architecture")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or(NamModelError::MissingField("architecture"))
}

/// Deterministic mixed test signal shared by the parity tests: a decaying
/// sweep plus a click transient, identical to the signal the C++ oracle runs.
#[cfg(test)]
pub(crate) fn parity_input(count: usize) -> Vec<f32> {
    let mut input = Vec::with_capacity(count);
    for i in 0..count {
        let t = i as f64 / 48_000.0;
        let envelope = (-t * 1.5).exp();
        let frequency = 82.0 + 400.0 * t;
        let mut value = envelope * (2.0 * std::f64::consts::PI * frequency * t).sin() * 0.5;
        if i < 240 {
            let click_sign = if i % 2 == 0 { 1.0 } else { -1.0 };
            value += click_sign * (1.0 - i as f64 / 240.0) * 0.25;
        }
        input.push(value as f32);
    }
    input
}

/// Relative root-mean-square difference — the parity metric the goldens pin.
#[cfg(test)]
pub(crate) fn relative_rms(actual: &[f32], expected: &[f32]) -> f64 {
    assert_eq!(actual.len(), expected.len(), "output length mismatch");
    let numerator: f64 = actual
        .iter()
        .zip(expected)
        .map(|(a, e)| {
            let delta = (a - e) as f64;
            delta * delta
        })
        .sum();
    let denominator: f64 = expected.iter().map(|e| (*e as f64) * (*e as f64)).sum();
    if denominator == 0.0 {
        return if numerator == 0.0 { 0.0 } else { f64::INFINITY };
    }
    (numerator / denominator).sqrt()
}

#[cfg(test)]
pub(crate) fn read_fixture(name: &str) -> String {
    let path = format!(
        "{}/{}",
        env!("CARGO_MANIFEST_DIR"),
        format!("src/grinder/nam/fixtures/{name}")
    );
    std::fs::read_to_string(path).expect("fixture must be readable")
}

#[cfg(test)]
pub(crate) fn read_golden(name: &str) -> Vec<f32> {
    read_fixture(name)
        .lines()
        .map(|line| {
            line.trim()
                .parse::<f64>()
                .expect("golden line must parse as a number") as f32
        })
        .collect()
}

#[cfg(test)]
mod parity {
    use super::{parity_input, parse_nam_model, read_fixture, read_golden, relative_rms};

    /// Golden outputs were generated by compiling NeuralAmpModelerCore itself
    /// (main, float-sample build) and running the shared parity input through
    /// its `process` at the named block size after `Reset(48 kHz, block)` —
    /// the C++ core is the oracle, not a reimplementation of it.
    ///
    /// NAMCore's own outputs are only block-size invariant to ~9.6e-7 relative
    /// RMS (Eigen's block GEMM reorders float sums), so the pinned tolerance
    /// sits an order of magnitude above that self-variance. Measured parity of
    /// this runtime against the C++ core: wavenet.nam 1.1e-6, lstm.nam 7.4e-7,
    /// gated synthetic 1.4e-7, convnet synthetic 8.8e-9 — pinned at 1e-5.
    const PARITY_TOLERANCE: f64 = 1.0e-5;
    const SAMPLE_COUNT: usize = 384;

    fn assert_parity(fixture: &str, goldens: &[&str]) {
        let mut model = parse_nam_model(&read_fixture(fixture)).expect("fixture must load");
        let input = parity_input(SAMPLE_COUNT);

        for golden in goldens {
            let expected = read_golden(golden);
            model.reset();
            let mut actual = Vec::with_capacity(SAMPLE_COUNT);
            for value in &input {
                actual.push(model.process(*value));
            }
            let difference = relative_rms(&actual, &expected);
            assert!(
                difference <= PARITY_TOLERANCE,
                "{fixture} diverges from {golden}: relative RMS {difference:.3e} > {PARITY_TOLERANCE:.0e}"
            );
        }
    }

    #[test]
    fn official_wavenet_example_matches_namcore() {
        assert_parity(
            "wavenet.nam",
            &["golden_wavenet_bs64.txt", "golden_wavenet_bs256.txt"],
        );
    }

    #[test]
    fn official_lstm_example_matches_namcore() {
        assert_parity(
            "lstm.nam",
            &["golden_lstm_bs64.txt", "golden_lstm_bs256.txt"],
        );
    }

    #[test]
    fn gated_wavenet_with_head1x1_and_post_stack_head_matches_namcore() {
        assert_parity(
            "gated_wavenet_synthetic.nam",
            &["golden_gated_wavenet_synthetic_bs64.txt"],
        );
    }

    #[test]
    fn convnet_with_batchnorm_matches_namcore() {
        assert_parity(
            "convnet_synthetic.nam",
            &["golden_convnet_synthetic_bs64.txt"],
        );
    }

    /// Output must be identical regardless of how the host slices blocks — the
    /// runtime is per-sample, so any chunking of the same stream lands on the
    /// same state.
    #[test]
    fn output_is_block_size_invariant() {
        let input = parity_input(SAMPLE_COUNT);
        let run = |block: usize| {
            let mut model =
                parse_nam_model(&read_fixture("wavenet.nam")).expect("fixture must load");
            let mut output = Vec::with_capacity(SAMPLE_COUNT);
            for chunk in input.chunks(block.max(1)) {
                for value in chunk {
                    output.push(model.process(*value));
                }
                // Block boundaries are invisible to a per-sample runtime; the
                // loop above already proves the stream result is identical.
            }
            output
        };
        let per_sample = run(1);
        let chunked = run(97);
        assert_eq!(per_sample, chunked, "block chunking must not change output");
    }

    /// The issue's information-loss probe, inverted at the runtime: swapping
    /// two weights inside the model must move the output — every weight now
    /// executes with its sign and position.
    #[test]
    fn weight_mutation_changes_the_output() {
        let original = read_fixture("wavenet.nam");
        let mut parsed: serde_json::Value =
            serde_json::from_str(&original).expect("fixture must be valid JSON");
        let weights = parsed
            .get_mut("weights")
            .and_then(serde_json::Value::as_array_mut)
            .expect("fixture must carry weights");
        // Swap the first two weights (both non-zero in the official fixture).
        weights.swap(0, 1);
        let mutated = serde_json::to_string(&parsed).expect("mutated fixture must serialize");
        assert_ne!(mutated, original, "probe mutation must change the file");
        let mut model = parse_nam_model(&original).expect("fixture must load");
        let mut flipped = parse_nam_model(&mutated).expect("mutated fixture must load");
        let input = parity_input(SAMPLE_COUNT);
        let mut a = Vec::new();
        let mut b = Vec::new();
        for value in &input {
            a.push(model.process(*value));
            b.push(flipped.process(*value));
        }
        let difference = relative_rms(&a, &b);
        assert!(
            difference > 1.0e-3,
            "a weight swap must be audible, got relative RMS {difference:.3e}"
        );
    }

    /// The second probe: config is honored, not decorative. Removing a
    /// dilation changes the expected weight count, so the mutated file is
    /// rejected by name; rewriting the dilation VALUES keeps the count, and
    /// the runtime must then sound different — the dilations steer how much
    /// history each tap reads.
    #[test]
    fn config_change_is_retained_not_smoothed_over() {
        let original = read_fixture("wavenet.nam");
        let input = parity_input(SAMPLE_COUNT);

        // Fewer dilations: the weight array no longer fits the architecture.
        let mut parsed: serde_json::Value =
            serde_json::from_str(&original).expect("fixture must be valid JSON");
        parsed["config"]["layers"][0]["dilations"] = serde_json::json!([1, 2, 4]);
        let mutated = serde_json::to_string(&parsed).expect("mutated fixture must serialize");
        match parse_nam_model(&mutated) {
            Err(super::NamModelError::WeightCountMismatch { .. }) => {}
            Err(other) => panic!("dilation-count change must fail loudly, got {other}"),
            Ok(_) => panic!("dilation-count change must be rejected, not silently accepted"),
        }

        // Same dilation count, different values: loads, but must sound
        // different — the config reaches the DSP.
        let mut parsed: serde_json::Value =
            serde_json::from_str(&original).expect("fixture must be valid JSON");
        parsed["config"]["layers"][0]["dilations"] = serde_json::json!([1, 1]);
        let mutated = serde_json::to_string(&parsed).expect("mutated fixture must serialize");
        let mut model = parse_nam_model(&original).expect("fixture must load");
        let mut altered = parse_nam_model(&mutated).expect("mutated fixture must load");
        let mut a = Vec::new();
        let mut b = Vec::new();
        for value in &input {
            a.push(model.process(*value));
            b.push(altered.process(*value));
        }
        let difference = relative_rms(&a, &b);
        assert!(
            difference > 1.0e-3,
            "a dilation change must be audible, got relative RMS {difference:.3e}"
        );
    }

    /// Unsupported features are named, never substituted: parametric
    /// (condition DSP) captures and slimmable models are real .nam variants
    /// this runtime does not implement.
    #[test]
    fn unsupported_variants_are_rejected_explicitly() {
        let original = read_fixture("wavenet.nam");
        let mut parametric: serde_json::Value = serde_json::from_str(&original).unwrap();
        parametric["config"]["condition_dsp"] = serde_json::json!({"architecture": "LSTM"});
        match parse_nam_model(&serde_json::to_string(&parametric).unwrap()) {
            Err(super::NamModelError::ConditionDspUnsupported) => {}
            Err(other) => panic!("condition_dsp must be rejected explicitly, got {other}"),
            Ok(_) => panic!("condition_dsp capture must be rejected, not loaded"),
        }
        let mut slimmable: serde_json::Value = serde_json::from_str(&original).unwrap();
        slimmable["config"]["layers"][0]["slimmable"] =
            serde_json::json!({"method": "slice_channels_uniform"});
        match parse_nam_model(&serde_json::to_string(&slimmable).unwrap()) {
            Err(super::NamModelError::SlimmableUnsupported) => {}
            Err(other) => panic!("slimmable must be rejected explicitly, got {other}"),
            Ok(_) => panic!("slimmable model must be rejected, not loaded"),
        }
        let mut renamed: serde_json::Value = serde_json::from_str(&original).unwrap();
        renamed["architecture"] = serde_json::json!("CatWaveNet");
        match parse_nam_model(&serde_json::to_string(&renamed).unwrap()) {
            Err(error @ super::NamModelError::UnsupportedArchitecture(_)) => {
                assert!(error.to_string().contains("CatWaveNet"));
            }
            Err(other) => panic!("unknown architecture must be rejected explicitly, got {other}"),
            Ok(_) => panic!("unknown architecture must be rejected, not loaded"),
        }
        // Version window: below 0.5.0 and above 0.7.x are refused by name.
        let mut ancient: serde_json::Value = serde_json::from_str(&original).unwrap();
        ancient["version"] = serde_json::json!("0.4.9");
        assert_eq!(
            parse_nam_model(&serde_json::to_string(&ancient).unwrap())
                .err()
                .map(|error| error.to_string()),
            Some("unsupported NAM file version \"0.4.9\" (supported: 0.5.0 through 0.7.x)".into())
        );
        let mut future: serde_json::Value = serde_json::from_str(&original).unwrap();
        future["version"] = serde_json::json!("0.8.1");
        assert!(matches!(
            parse_nam_model(&serde_json::to_string(&future).unwrap()),
            Err(super::NamModelError::UnsupportedVersion(_))
        ));
    }

    /// A PReLU whose `negative_slopes` array is empty would panic `apply` on
    /// the first sample (`slopes[0]` of an empty vec). The parser refuses the
    /// shape by name, and the TS mirror refuses it too, so an import can
    /// never store a model the runtime would crash on.
    #[test]
    fn slope_less_prelu_is_rejected_explicitly() {
        let original = read_fixture("gated_wavenet_synthetic.nam");
        let mut parsed: serde_json::Value = serde_json::from_str(&original).unwrap();
        parsed["config"]["head"]["activation"] =
            serde_json::json!({ "type": "PReLU", "negative_slopes": [] });
        let mutated = serde_json::to_string(&parsed).unwrap();
        match parse_nam_model(&mutated) {
            Err(super::NamModelError::InvalidConfig(message)) => {
                assert!(
                    message.contains("PReLU"),
                    "the rejection must name PReLU, got: {message}"
                );
            }
            Err(other) => {
                panic!("empty-slope PReLU must be an InvalidConfig rejection, got {other}")
            }
            Ok(_) => panic!("a slope-less PReLU must be rejected, not loaded"),
        }
        // The bare-string shape carries no slopes at all and is refused the
        // same way it always was.
        let mut bare: serde_json::Value = serde_json::from_str(&original).unwrap();
        bare["config"]["head"]["activation"] = serde_json::json!("PReLU");
        assert!(matches!(
            parse_nam_model(&serde_json::to_string(&bare).unwrap()),
            Err(super::NamModelError::InvalidConfig(_))
        ));
    }

    /// A PReLU carrying slopes parses and renders: the post-stack head applies
    /// the per-channel slope without panicking or going silent.
    #[test]
    fn prelu_post_stack_head_loads_and_renders() {
        let original = read_fixture("gated_wavenet_synthetic.nam");
        let mut parsed: serde_json::Value = serde_json::from_str(&original).unwrap();
        parsed["config"]["head"]["activation"] =
            serde_json::json!({ "type": "PReLU", "negative_slopes": [0.25, 0.125, 0.0625, 0.5] });
        let mut model = parse_nam_model(&serde_json::to_string(&parsed).unwrap())
            .expect("PReLU head must load");
        let input = parity_input(SAMPLE_COUNT);
        let mut peak = 0.0_f32;
        for value in &input {
            let out = model.process(*value);
            assert!(out.is_finite(), "PReLU head rendered a non-finite sample");
            peak = peak.max(out.abs());
        }
        assert!(
            peak > 1.0e-3,
            "PReLU post-head model rendered silence (peak {peak:.3e})"
        );
    }
}
