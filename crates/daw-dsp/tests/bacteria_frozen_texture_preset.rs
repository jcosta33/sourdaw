use daw_dsp::bacteria::engine::BacteriaEngine;

const SAMPLE_RATE: f32 = 48_000.0;
const FRAMES: usize = 96_000;
const DRY_GAIN: f32 = 0.2;

fn render_frozen_texture() -> (Vec<f32>, Vec<f32>) {
    let mut engine = BacteriaEngine::new(SAMPLE_RATE);
    engine.set_param("bandCount", 1.0);
    engine.set_param("band0_granularEnabled", 1.0);
    engine.set_param("band0_grainSize", 120.0);
    engine.set_param("band0_grainDensity", 25.0);
    engine.set_param("band0_grainPosOffset", 100.0);
    engine.set_param("band0_grainPitch", 7.0);
    engine.set_param("band0_grainFreeze", 0.0);
    engine.set_param("band0_grainMix", 0.8);

    let input: Vec<f32> = (0..FRAMES)
        .map(|frame| {
            let time = frame as f32 / SAMPLE_RATE;
            0.25 * (std::f32::consts::TAU * 220.0 * time).sin()
        })
        .collect();
    let mut left = input.clone();
    let mut right = input.clone();
    for start in (0..FRAMES).step_by(128) {
        let end = (start + 128).min(FRAMES);
        engine.process_block(&mut left[start..end], &mut right[start..end]);
    }
    (input, left)
}

#[test]
fn frozen_texture_preset_produces_wet_audio_beyond_its_dry_branch() {
    let (input, output) = render_frozen_texture();
    let residual_energy = output
        .iter()
        .zip(input)
        .map(|(sample, dry)| (sample - dry * DRY_GAIN).powi(2))
        .sum::<f32>();
    let residual_rms = (residual_energy / FRAMES as f32).sqrt();

    assert!(
        residual_rms > 0.01,
        "Frozen Texture is dry-only: wet residual RMS {residual_rms}"
    );
}
