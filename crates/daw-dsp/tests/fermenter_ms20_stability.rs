//! Numeric stability guard for the shipped Fermenter MS-20 patches.

use daw_dsp::fermenter::FermenterInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const MAX_SAFE_PEAK: f32 = 2.0;

struct ShippedPreset {
    name: &'static str,
    parameters: &'static [(&'static str, f32)],
}

const CRUSTY_SCREAM: ShippedPreset = ShippedPreset {
    // Mirrors fermenterPresets.ts; keep this native guard in lockstep with
    // the shipped patch so the engine is tested without requiring a WASM build.
    name: "Crusty Scream",
    parameters: &[
        ("engine", 1.0),
        ("osc_waveform", 1.0),
        ("filter_model", 4.0),
        ("cutoff", 1_500.0),
        ("resonance", 7.0),
        ("filter_drive", 3.0),
        ("amp_sustain", 0.7),
        ("mod_env_to_filter", 0.8),
        ("portamento", 0.05),
        ("dist_mix", 0.15),
        ("dist_drive", 2.0),
    ],
};

const CRACKER_CLAV: ShippedPreset = ShippedPreset {
    // Mirrors fermenterPresets.ts; see the note above.
    name: "Cracker Clav",
    parameters: &[
        ("engine", 1.0),
        ("osc_waveform", 2.0),
        ("filter_model", 4.0),
        ("cutoff", 3_000.0),
        ("resonance", 4.0),
        ("amp_attack", 0.002),
        ("amp_decay", 0.3),
        ("amp_sustain", 0.1),
        ("amp_release", 0.1),
        ("filter_decay", 0.15),
        ("mod_env_to_filter", 0.8),
    ],
};

#[derive(Debug)]
struct Measurement {
    peak: f32,
    rms: f32,
    nan_flushes: u64,
}

fn render(preset: &ShippedPreset, sample_rate: f32, note: u8) -> Measurement {
    let mut instance = FermenterInstance::new(sample_rate, 8);
    for &(name, value) in preset.parameters {
        instance.set_param(name, value);
    }
    instance.note_on(note, 100);

    let mut peak = 0.0_f32;
    let mut sum_squares = 0.0_f64;
    let mut sample_count = 0_usize;
    let render_blocks = sample_rate as usize / BLOCK;
    for _ in 0..render_blocks {
        let left_pointer = instance.process(BLOCK as u32);
        let right_pointer = instance.get_right_ptr();
        // SAFETY: both pointers address the instance's 128-frame output buffers
        // and are consumed before the next process call.
        let left = unsafe { std::slice::from_raw_parts(left_pointer, BLOCK) };
        let right = unsafe { std::slice::from_raw_parts(right_pointer, BLOCK) };
        for &sample in left.iter().chain(right) {
            peak = peak.max(sample.abs());
            sum_squares += (sample as f64) * (sample as f64);
            sample_count += 1;
        }
    }

    Measurement {
        peak,
        rms: (sum_squares / sample_count as f64).sqrt() as f32,
        nan_flushes: instance.get_nan_flush_count() as u64,
    }
}

#[test]
fn shipped_ms20_presets_render_without_numeric_blowup() {
    let measurements = [
        (&CRUSTY_SCREAM, render(&CRUSTY_SCREAM, SAMPLE_RATE, 60)),
        (&CRACKER_CLAV, render(&CRACKER_CLAV, SAMPLE_RATE, 60)),
    ];

    for (preset, measurement) in &measurements {
        println!("{}: {measurement:?}", preset.name);
    }

    for (preset, measurement) in measurements {
        assert_eq!(
            measurement.nan_flushes, 0,
            "{} emitted non-finite samples",
            preset.name
        );
        assert!(
            measurement.peak.is_finite() && measurement.peak < MAX_SAFE_PEAK,
            "{} peak {} indicates numeric blowup",
            preset.name,
            measurement.peak
        );
        assert!(
            measurement.rms.is_finite() && measurement.rms > 1e-5,
            "{} did not render a finite audible signal: RMS {}",
            preset.name,
            measurement.rms
        );
    }
}

#[test]
fn max_range_ms20_controls_remain_level_safe() {
    let max_range = ShippedPreset {
        name: "Maximum-range MS-20 controls",
        parameters: &[
            ("filter_model", 4.0),
            ("cutoff", 100.0),
            ("resonance", 20.0),
            ("filter_drive", 10.0),
        ],
    };
    let measurement = render(&max_range, 96_000.0, 43);

    println!("{}: {measurement:?}", max_range.name);
    assert_eq!(
        measurement.nan_flushes, 0,
        "maximum-range controls emitted non-finite samples"
    );
    assert!(
        measurement.peak.is_finite() && measurement.peak < MAX_SAFE_PEAK,
        "maximum-range controls produced an unsafe peak: {}",
        measurement.peak
    );
}
