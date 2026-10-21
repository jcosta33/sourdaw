//! Spring's late energy must come from the real selected body, not the picker.
use daw_dsp::bacteria::convolution::ConvolutionProcessor;
use daw_dsp::bacteria::engine::BacteriaEngine;

fn body(index: f32, rate: f32) -> ConvolutionProcessor {
    let mut result = ConvolutionProcessor::new(rate);
    result.set_param("convolutionIr", index);
    result.set_param("convolutionMix", 1.0);
    result.set_param("convolutionSeparation", 0.0);
    result
}

#[test]
fn spring_has_a_dispersive_tail_beyond_the_metal_body() {
    let render = |index: f32| {
        let mut body = ConvolutionProcessor::new(48_000.0);
        body.set_param("convolutionIr", index);
        body.set_param("convolutionMix", 1.0);
        body.set_param("convolutionSeparation", 0.0);
        let mut early = 0.0_f64;
        let mut late = 0.0_f64;
        for n in 0..9_600 {
            let input = if n == 0 { 1.0 } else { 0.0 };
            let (left, right) = body.process_stereo(input, input);
            assert!(left.is_finite() && right.is_finite());
            assert_eq!(left, right);
            if n < 4_800 {
                early += f64::from(left).powi(2);
            } else {
                late += f64::from(left).powi(2);
            }
        }
        assert!(early > 0.0, "the selected body never received the impulse");
        late
    };
    assert_eq!(render(2.0), 0.0, "Metal remains the original short FIR");
    let spring_late = render(3.0);
    // Published feedback/dispersion parameters predict 0.149 in this window.
    // The conservative energy budget rejects both Metal's alias and no feedback.
    assert!(
        spring_late > 0.05,
        "Spring's 100–200 ms impulse energy is {spring_late}; expected >0.05"
    );
}

#[test]
fn body_switches_keep_both_histories_warm_and_repeated_spring_does_not_restart() {
    for (before, after) in [(2.0, 3.0), (3.0, 2.0)] {
        let mut switched = body(before, 48_000.0);
        let mut reference = body(after, 48_000.0);
        for n in 0..4_800 {
            let input = if n == 4_700 { 1.0 } else { 0.0 };
            switched.process_stereo(input, input * 0.5);
            reference.process_stereo(input, input * 0.5);
        }
        switched.set_param("convolutionIr", after);
        let mut heard = 0.0_f32;
        for _ in 0..128 {
            switched.set_param("convolutionIr", after);
            let actual = switched.process_stereo(0.0, 0.0);
            let expected = reference.process_stereo(0.0, 0.0);
            assert_eq!(
                actual, expected,
                "{before} to {after} lost its input history"
            );
            heard += actual.0.abs();
        }
        assert!(heard > 1e-6, "the reference must carry an audible tail");
    }
}

#[test]
fn spring_reset_and_none_discard_the_old_tail_without_crossfeeding_channels() {
    for reset in [false, true] {
        let mut processor = body(3.0, 48_000.0);
        let mut heard = 0.0_f64;
        for n in 0..4_800 {
            let input = if n == 0 { 1.0 } else { 0.0 };
            let output = processor.process_stereo(input, 0.0);
            assert_eq!(output.1, 0.0);
            if n >= 4_000 {
                heard += f64::from(output.0).powi(2);
            }
        }
        assert!(heard > 1e-4, "the old Spring tail must actually exist");
        if reset {
            processor.reset();
        } else {
            processor.set_param("convolutionIr", -1.0);
            for _ in 0..128 {
                assert_eq!(processor.process_stereo(0.0, 0.0), (0.0, 0.0));
            }
            processor.set_param("convolutionIr", 3.0);
        }
        for _ in 0..9_600 {
            assert_eq!(processor.process_stereo(0.0, 0.0), (0.0, 0.0));
        }
    }
}

fn engine(routing: f32, spring: bool) -> BacteriaEngine {
    let mut engine = BacteriaEngine::new(48_000.0);
    // This is the real key; `routing` is ignored by the engine. Values are
    // 0=Serial, 1=Parallel, 2=MidSide. Never rely on its factory default here.
    engine.set_param("globalRouting", routing);
    engine.set_param("bandCount", 3.0);
    engine.set_param("band2_convolutionEnabled", 1.0);
    engine.set_param("band2_convolutionMix", 1.0);
    engine.set_param("band2_convolutionSeparation", 0.0);
    engine.set_param("band2_convolutionIr", if spring { 3.0 } else { -1.0 });
    engine
}

#[test]
fn every_real_skipped_route_returns_with_fresh_spring_memory() {
    for (name, routing, key, skip, resume) in [
        ("Body disabled", 1.0, "band2_convolutionEnabled", 0.0, 1.0),
        ("band disabled", 1.0, "band2_enabled", 0.0, 1.0),
        ("parallel mute", 1.0, "band2_mute", 1.0, 0.0),
        ("parallel solo exclusion", 1.0, "band0_solo", 1.0, 0.0),
        ("serial pass-through", 0.0, "band2_mute", 1.0, 0.0),
        ("device bypass", 1.0, "bypass", 1.0, 0.0),
        ("MidSide unused band", 1.0, "globalRouting", 2.0, 1.0),
        ("bandCount shrink", 1.0, "bandCount", 2.0, 3.0),
    ] {
        let mut actual = engine(routing, true);
        let mut fresh = engine(routing, false);
        let mut tail_difference = 0.0_f64;
        for block in 0..38 {
            let mut left = [0.0; 128];
            if block == 0 {
                left[0] = 1.0;
            }
            let mut right = left;
            let mut expected_l = left;
            let mut expected_r = right;
            actual.process_block(&mut left, &mut right);
            fresh.process_block(&mut expected_l, &mut expected_r);
            if block == 37 {
                tail_difference = left
                    .iter()
                    .zip(expected_l)
                    .map(|(&a, b)| f64::from(a - b).powi(2))
                    .sum();
            }
        }
        assert!(tail_difference > 1e-6, "{name}: no pre-skip tail witness");
        actual.set_param(key, skip);
        fresh.set_param(key, skip);
        let mut skipped_l = std::array::from_fn::<_, 128, _>(|n| (n as f32 * 0.31).sin() * 0.2);
        let mut skipped_r = skipped_l;
        let mut expected_l = skipped_l;
        let mut expected_r = skipped_r;
        actual.process_block(&mut skipped_l, &mut skipped_r);
        fresh.process_block(&mut expected_l, &mut expected_r);
        // An ignored route selector leaves Spring audible and fails this
        // precondition. Reaching the post-resume assertion alone is insufficient.
        assert_eq!(skipped_l, expected_l, "{name}: route never skipped Spring");
        assert_eq!(
            skipped_r, expected_r,
            "{name}: right route never skipped Spring"
        );
        actual.set_param(key, resume);
        fresh.set_param(key, resume);
        fresh.set_param("band2_convolutionIr", 3.0);
        for _ in 0..4 {
            let mut left = [0.0; 128];
            let mut right = left;
            let mut expected_l = left;
            let mut expected_r = right;
            actual.process_block(&mut left, &mut right);
            fresh.process_block(&mut expected_l, &mut expected_r);
            assert_eq!(left, expected_l, "{name}: resurrected old Spring state");
            assert_eq!(right, expected_r, "{name}: resurrected right Spring state");
        }
    }
}

// Test-only FFT of the actual output, so a multi-second tail does not turn
// the audible-band assertion into billions of direct Fourier evaluations.
fn audible_band_level(signal: &[f32], rate: f32) -> f64 {
    let length = signal.len().next_power_of_two();
    let mut re = vec![0.0_f64; length];
    let mut im = vec![0.0_f64; length];
    for (to, &from) in re.iter_mut().zip(signal) {
        *to = f64::from(from);
    }
    let mut j = 0;
    for i in 1..length {
        let mut bit = length >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut width = 2;
    while width <= length {
        let angle = -std::f64::consts::TAU / width as f64;
        let step = (angle.cos(), angle.sin());
        for start in (0..length).step_by(width) {
            let mut rotation = (1.0, 0.0);
            for k in 0..width / 2 {
                let a = start + k;
                let b = a + width / 2;
                let t = (
                    rotation.0 * re[b] - rotation.1 * im[b],
                    rotation.0 * im[b] + rotation.1 * re[b],
                );
                re[b] = re[a] - t.0;
                im[b] = im[a] - t.1;
                re[a] += t.0;
                im[a] += t.1;
                rotation = (
                    rotation.0 * step.0 - rotation.1 * step.1,
                    rotation.0 * step.1 + rotation.1 * step.0,
                );
            }
        }
        width *= 2;
    }
    let first = (20.0 * length as f64 / f64::from(rate)).ceil() as usize;
    let last = (20_000.0 * length as f64 / f64::from(rate)).floor() as usize;
    let power: f64 = (first..=last).map(|n| re[n].powi(2) + im[n].powi(2)).sum();
    10.0 * (power / (last - first + 1) as f64).log10()
}

/// Kept in ordinary Cargo collection; local focused runs can select the cheap
/// regressions above. Hosted execution proves the complete multi-rate tail.
#[test]
fn full_tail_energy_decay_and_audible_level_hold_across_session_rates() {
    let mut reference = None;
    for rate in [48_000.0_f32, 44_100.0, 96_000.0, 176_400.0, 192_000.0] {
        let mut processor = body(3.0, rate);
        let heard: Vec<f32> = (0..(rate * 3.0) as usize)
            .map(|n| {
                let impulse = if n == 0 { 1.0 } else { 0.0 };
                let output = processor.process_stereo(impulse, impulse);
                assert!(output.0.is_finite() && output.1.is_finite());
                assert_eq!(output.0, output.1);
                output.0
            })
            .collect();
        let total: f64 = heard.iter().map(|&x| f64::from(x).powi(2)).sum();
        let expected = 48_000.0 / f64::from(rate);
        assert!(
            (total - expected).abs() < 1e-3,
            "{rate}: energy {total}, expected {expected}"
        );
        let late: f64 = heard[(rate * 0.1) as usize..]
            .iter()
            .map(|&x| f64::from(x).powi(2))
            .sum();
        assert!(late / total > 0.1, "{rate}: the 100-ms tail was lost");
        let mut remaining = total;
        let mut sixty_db = None;
        for (n, &sample) in heard.iter().enumerate() {
            remaining -= f64::from(sample).powi(2);
            if remaining / total <= 1e-6 {
                sixty_db = Some(n as f64 / f64::from(rate));
                break;
            }
        }
        let decay = sixty_db.expect("the measured tail must decay below -60 dB");
        assert!(
            (1.0..1.8).contains(&decay),
            "{rate}: EDC -60 dB at {decay}s"
        );
        let level = audible_band_level(&heard, rate);
        match reference {
            None => reference = Some(level),
            Some(reference) => assert!(
                (level - reference).abs() <= 0.5,
                "{rate}: audible level {level}, 48 kHz {reference}"
            ),
        }
    }
}

#[test]
fn full_spring_white_noise_gain_is_unity_at_the_reference_rate() {
    use daw_dsp::fermenter::noise::{NoiseGen, NOISE_WHITE};
    let mut noise = NoiseGen::new();
    noise.color = NOISE_WHITE;
    let mut processor = body(3.0, 48_000.0);
    let mut input = 0.0_f64;
    let mut output = 0.0_f64;
    for n in 0..6 * 48_000 {
        let x = noise.tick();
        let y = processor.process_stereo(x, x).0;
        if n >= 2 * 48_000 {
            input += f64::from(x).powi(2);
            output += f64::from(y).powi(2);
        }
    }
    let gain = 10.0 * (output / input).log10();
    assert!(gain.abs() <= 0.5, "Spring white-noise gain {gain} dB");
}
