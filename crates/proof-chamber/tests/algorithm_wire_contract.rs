//! What the persisted `algorithm` wire value is allowed to select.
//!
//! `algorithm` is a number stored in a project file and replayed verbatim on
//! load. Nothing between the store and this crate range-checks it: the write
//! path's only guard is `Number.isFinite`, the descriptor's `maxValue` is
//! enforced by no code at all, and `automatable: false` gates the automation
//! lane picker rather than the runtime apply. So a preset, a project file, or
//! a model-emitted `setDeviceParameter` reaches `set_param("algorithm", n)`
//! with an arbitrary `n`, and this dispatch is the only place that decides
//! what `n` means.
//!
//! That makes the mapping a wire format. Two rules follow, and both are
//! asserted here rather than left to review:
//!
//! 1. Existing values never move. A stored `0` must stay Plate forever.
//! 1b. Where a value's *behaviour* does change, that is stated and pinned
//!    rather than left for someone to trip over. Exactly one value changes
//!    here — see
//!    `stored_convolution_backed_values_now_render_plate_instead_of_dry_passthrough`.
//! 2. A value whose engine cannot render must not select that engine. The
//!    convolution-backed engines need an impulse response, and no transport
//!    exists to deliver one — `load_ir` has no caller anywhere in the app and
//!    the repo ships no impulse responses. They therefore fall back to Plate
//!    here instead of engaging an engine that renders its dry input and calls
//!    it reverb.

use proof_chamber::{ProofChamberInstance, UnexposedEngine};

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

fn engine_names(instance: &ProofChamberInstance) -> Vec<String> {
    serde_json::from_str(&instance.get_param_names()).expect("param names are a JSON string array")
}

fn engine_params(algorithm: f32) -> Vec<String> {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    engine_names(&instance)
}

fn latency_of(algorithm: f32) -> u32 {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    instance.get_latency()
}

/// Index of the first output sample above the audibility floor, driving a
/// short burst followed by silence for `frames` samples.
fn onset_index(instance: &mut ProofChamberInstance, frames: usize) -> Option<usize> {
    let mut index = 0;
    while index < frames {
        let left: Vec<f32> = (0..BLOCK)
            .map(|i| if index + i < 512 { 0.8 } else { 0.0 })
            .collect();
        let right = left.clone();
        let ptr = instance.process(&left, &right, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        let out: Vec<f32> = (0..BLOCK).map(|i| unsafe { *ptr.add(i) }).collect();
        if let Some(offset) = out.iter().position(|s| s.abs() > 1e-3) {
            return Some(index + offset);
        }
        index += BLOCK;
    }
    None
}

/// Build Reverse, apply `settings`, and report when its reversed playback
/// first becomes audible. `mix` is forced to 1.0 so the dry signal cannot be
/// mistaken for engine output.
fn reverse_onset_with(settings: &[(&str, f32)]) -> usize {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", 6.0);
    instance.set_param("mix", 1.0);
    for (name, value) in settings {
        instance.set_param(name, *value);
    }
    onset_index(&mut instance, 400_000)
        .unwrap_or_else(|| panic!("Reverse stayed silent for 400 000 samples with {settings:?}"))
}

/// The four wire values that predate this change, plus the one it adds. Each
/// is identified by a parameter only that engine accepts, so the assertion
/// fails if the dispatch is renumbered rather than only if it is deleted.
#[test]
fn every_selectable_wire_value_keeps_its_engine() {
    let cases: [(f32, &str); 5] = [
        (0.0, "diffusion"),  // Plate — Dattorro tank diffusers
        (1.0, "matrix"),     // FDN-8 — Hadamard feedback matrix
        (2.0, "matrix"),     // FDN-16
        (3.0, "dispersion"), // Spring — allpass dispersion chain
        (6.0, "size"),       // Reverse — buffer length
    ];

    for (value, marker) in cases {
        let names = engine_params(value);
        assert!(
            names.iter().any(|n| n == marker),
            "algorithm {value} no longer advertises `{marker}`, so the wire value has been \
             renumbered onto a different engine. Stored projects carry these numbers; they \
             cannot move. Advertised: {names:?}"
        );
    }
}

/// Reverse's buffer length is reachable through the descriptor's `size`, which
/// is already declared. `reverse_time` is the engine-native alias and is
/// deliberately not advertised, matching how the FDN pair advertises `decay`
/// while still accepting `rt60`.
#[test]
fn reverse_advertises_only_parameters_the_host_declares() {
    let names = engine_params(6.0);

    assert_eq!(
        names,
        vec![
            "algorithm",
            "vintage",
            "mix",
            "decay",
            "size",
            "high_cut",
            "low_cut"
        ],
        "Reverse must advertise the host-facing parameter names. A name the descriptor never \
         declares is a control the host cannot send, and a declared control the engine drops \
         is a dead knob."
    );

    // `width` is declared by the descriptor and is *not* here on purpose. This
    // engine's wet path is one mono sample copied to both channels, so the
    // mid/side matrix has no side component to scale: a `width` arm would
    // accept the write and provably not move an output sample. It stays a
    // recorded gap until the reverse buffer is stereo, rather than becoming a
    // knob that reports success and does nothing.
    assert!(
        !names.iter().any(|n| n == "width"),
        "Reverse advertised `width` while its wet path is still mono: {names:?}"
    );

    // The unadvertised alias still has to work, or dropping it from the
    // advertised list was a deletion rather than a rename. Both names set the
    // same buffer length, and that length is exactly what delays playback.
    let short = reverse_onset_with(&[("size", 0.0)]);
    let aliased = reverse_onset_with(&[("reverse_time", 0.0)]);
    let long = reverse_onset_with(&[("size", 1.0)]);

    assert_eq!(
        aliased, short,
        "`reverse_time` and `size` are the same control on this engine, so they must produce \
         the same playback start. Got {aliased} via the alias and {short} via `size`."
    );
    assert!(
        long > short + 100_000,
        "a longer reverse buffer must delay playback further; got {long} at size 1.0 versus \
         {short} at size 0.0, so the control barely reaches the DSP"
    );
}

/// The engines that need an impulse response must not be selectable by wire
/// value while no impulse response can reach them. `get_latency` is the
/// observable: the convolution path reports 128 samples of PDC alignment and
/// every algorithmic path reports zero.
#[test]
fn convolution_backed_wire_values_fall_back_instead_of_engaging() {
    for value in [4.0_f32, 5.0] {
        let names = engine_params(value);

        for forbidden in [
            "ir_stretch",
            "ir_eq_1",
            "hybrid_mode",
            "hybrid_blend",
            "conv_mix",
        ] {
            assert!(
                !names.iter().any(|n| n == forbidden),
                "algorithm {value} engaged a convolution-backed engine (advertises \
                 `{forbidden}`). Nothing loads an impulse response, so that engine renders its \
                 dry input. Advertised: {names:?}"
            );
        }

        assert_eq!(
            latency_of(value),
            0,
            "algorithm {value} reported convolution PDC latency, so a convolution-backed \
             engine is live on a value the product cannot support yet"
        );
    }
}

/// Render a burst through one wire value at the engine's own default mix.
/// Returns the output alongside the input it was given, so a caller can ask
/// whether anything happened to it at all.
fn render_wire_value(algorithm: f32) -> (Vec<f32>, Vec<f32>) {
    const FRAMES: usize = 8_192;

    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);

    let mut input = Vec::with_capacity(FRAMES);
    let mut output = Vec::with_capacity(FRAMES);
    let mut index = 0;
    while index < FRAMES {
        let left: Vec<f32> = (0..BLOCK)
            .map(|i| if index + i < 256 { 0.8 } else { 0.0 })
            .collect();
        let right = left.clone();
        let ptr = instance.process(&left, &right, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for i in 0..BLOCK {
            output.push(unsafe { *ptr.add(i) });
        }
        input.extend_from_slice(&left);
        index += BLOCK;
    }

    (output, input)
}

/// A stored `algorithm: 4` does **not** load identically, and that is
/// deliberate. This pins the change so the next person to touch the dispatch
/// sees the decision instead of rediscovering it.
///
/// Before this change, wire value 4 built a `ConvolutionEngine` whose `loaded`
/// flag starts false and whose `process` returns before touching the buffers.
/// A project carrying 4 therefore rendered unconditional dry passthrough with
/// the `mix` knob completely inert — not a quiet reverb, but the input itself.
/// It now renders Plate, which is audible where nothing was audible before.
///
/// That trade is taken knowingly. A stored 4 could only have arrived through a
/// path that should never have produced it — an unvalidated
/// `setDeviceParameter`, a preset, or a model-emitted action — so the old
/// output is a bug's output. Preserving it would promote that bug to a
/// contract and keep a selector value that renders nothing.
///
/// Value 5 has no equivalent gap: `HybridMode::Off` routes the same
/// `ProofChamber` that backs Plate, so it already sounded like Plate.
#[test]
fn stored_convolution_backed_values_now_render_plate_instead_of_dry_passthrough() {
    let (plate, _) = render_wire_value(0.0);

    for value in [4.0_f32, 5.0] {
        let (rendered, input) = render_wire_value(value);

        assert_eq!(
            rendered, plate,
            "algorithm {value} must now render exactly what Plate renders; it falls through to \
             the same engine, so any divergence means the fallback is not the one it claims"
        );
        assert_ne!(
            rendered, input,
            "algorithm {value} returned its input untouched. That is the pre-change behaviour of \
             an unloaded convolution engine — dry passthrough with `mix` inert — which means the \
             fallback did not engage."
        );
    }
}

/// Out-of-range and malformed values land on Plate rather than anywhere
/// surprising. `value as u8` saturates in Rust, so 300.0 and -1.0 both need
/// covering alongside the obvious 7.
#[test]
fn unrecognised_wire_values_fall_back_to_plate() {
    for value in [7.0_f32, 42.0, 300.0, -1.0, f32::NAN] {
        let names = engine_params(value);
        assert!(
            names.iter().any(|n| n == "diffusion"),
            "algorithm {value} did not fall back to Plate; advertised {names:?}"
        );
    }
}

/// The convolution engines stay built and stay testable — they are just not
/// wire-selectable. This is the path their own tests use, and it is not a
/// `#[wasm_bindgen]` export, so no JS caller can reach it.
#[test]
fn unexposed_engines_remain_reachable_from_rust_for_evaluation() {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);

    instance.select_unexposed_engine(UnexposedEngine::Convolution);
    assert_eq!(instance.get_latency(), 128);
    assert!(engine_names(&instance).iter().any(|n| n == "ir_stretch"));

    instance.select_unexposed_engine(UnexposedEngine::Hybrid);
    assert_eq!(instance.get_latency(), 128);
    assert!(engine_names(&instance).iter().any(|n| n == "hybrid_mode"));

    // A wire write still pulls the instance back out of an unexposed engine.
    instance.set_param("algorithm", 0.0);
    assert_eq!(instance.get_latency(), 0);
    assert!(engine_names(&instance).iter().any(|n| n == "diffusion"));
}
