//! Actual-instance checks for route-specific fixed-delay compensation.
//! Converter phase is measured through the unchanged Parallel route; only the
//! added compensation is compared with an independent ideal delay.

use daw_dsp::bacteria::BacteriaInstance;

#[cfg(debug_assertions)]
use assert_no_alloc::{assert_no_alloc, AllocDisabler};
#[cfg(debug_assertions)]
#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;
use std::f64::consts::PI;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const IMPULSE: f32 = 1.0e-4;
const FRAMES: usize = 1024;

fn configured(mid: usize, side: Option<usize>, mid_on: bool, side_on: bool) -> BacteriaInstance {
    let mut instance = BacteriaInstance::new(SAMPLE_RATE);
    instance.set_param("globalRouting", 2.0);
    instance.set_param("bandCount", if side.is_some() { 2.0 } else { 1.0 });
    instance.set_param("band0_oversampling", mid as f32);
    instance.set_param("band0_distortionEnabled", f32::from(mid_on));
    instance.set_param("band0_drive", 0.0);
    if let Some(factor) = side {
        instance.set_param("band1_oversampling", factor as f32);
        instance.set_param("band1_distortionEnabled", f32::from(side_on));
        instance.set_param("band1_drive", 0.0);
    }
    instance
}

fn render(
    instance: &mut BacteriaInstance,
    input: &[(f32, f32)],
    partition: usize,
) -> Vec<(f32, f32)> {
    let mut output = Vec::with_capacity(input.len());
    for chunk in input.chunks(partition) {
        unsafe {
            let left = instance.get_input_left_ptr();
            let right = instance.get_input_right_ptr();
            for (i, &(l, r)) in chunk.iter().enumerate() {
                *left.add(i) = l;
                *right.add(i) = r;
            }
        }
        let left = instance.process(chunk.len() as u32);
        let right = instance.get_right_ptr();
        for i in 0..chunk.len() {
            let frame = unsafe { (*left.add(i), *right.add(i)) };
            assert!(frame.0.is_finite() && frame.1.is_finite());
            output.push(frame);
        }
    }
    assert_eq!(
        instance.get_nan_flush_count(),
        0.0,
        "sanitization concealed non-finite PCM"
    );
    output
}

fn impulse(frames: usize) -> Vec<(f32, f32)> {
    let mut input = vec![(0.0, 0.0); frames];
    input[0] = (2.0 * IMPULSE, 0.0); // independent, equal mid and side impulses
    input
}

fn component(pcm: &[(f32, f32)], side: bool) -> Vec<f32> {
    pcm.iter()
        .map(|&(l, r)| if side { (l - r) * 0.5 } else { (l + r) * 0.5 })
        .collect()
}

fn dft(samples: &[f32], omega: f64) -> (f64, f64) {
    samples
        .iter()
        .enumerate()
        .fold((0.0, 0.0), |(re, im), (n, &sample)| {
            let angle = omega * n as f64;
            (
                re + f64::from(sample) * angle.cos(),
                im - f64::from(sample) * angle.sin(),
            )
        })
}

fn reference(factor: usize) -> Vec<f32> {
    let mut instance = configured(factor, None, true, false);
    instance.set_param("globalRouting", 1.0); // explicitly Parallel, independent of the default
    let mut input = vec![(0.0, 0.0); FRAMES];
    input[0] = (IMPULSE, IMPULSE);
    render(&mut instance, &input, BLOCK)
        .iter()
        .map(|frame| frame.0)
        .collect()
}

fn assert_added_delay(actual: &[f32], reference: &[f32], delay: f64, context: &str) {
    assert!(
        actual.iter().all(|sample| sample.is_finite()),
        "{context}: non-finite output"
    );
    assert!(
        actual.iter().any(|sample| sample.abs() > IMPULSE * 0.01),
        "{context}: silent output"
    );
    for omega in [PI / 16.0, PI / 8.0, PI / 4.0, 40000.0 * PI / 44100.0] {
        let (ar, ai) = dft(actual, omega);
        let (rr, ri) = dft(reference, omega);
        let norm = rr * rr + ri * ri;
        assert!(
            norm.is_finite() && norm > f64::from(IMPULSE).powi(2) * 1.0e-4,
            "{context}: silent/non-finite reference at {omega}"
        );
        let re = (ar * rr + ai * ri) / norm;
        let im = (ai * rr - ar * ri) / norm;
        let angle = omega * delay;
        let error = (re - angle.cos()).hypot(im + angle.sin());
        assert!(
            error <= 0.00075,
            "{context}: added delay {delay} error {error} at {omega}"
        );
    }
}

#[test]
fn one_band_real_pcm_has_the_prescribed_added_delay() {
    for (factor, target, deficit) in [(1, 0, 0.0), (2, 39, 32.5), (4, 42, 32.25), (8, 44, 32.625)] {
        let reference = reference(factor);
        let mut instance = configured(factor, None, true, false);
        let pcm = render(&mut instance, &impulse(FRAMES), BLOCK);
        assert_added_delay(
            &component(&pcm, false),
            &reference,
            deficit,
            &format!("factor {factor} mid"),
        );
        assert_eq!(instance.get_latency_samples(), target, "factor {factor}");
        let side = component(&pcm, true);
        for (n, &sample) in side.iter().enumerate() {
            let expected = if n == target as usize { IMPULSE } else { 0.0 };
            assert!(
                (sample - expected).abs() < 1.0e-10,
                "factor {factor} side sample {n}: {sample} vs {expected}"
            );
        }
    }
}

#[test]
fn midside_does_not_report_or_apply_the_unread_crossover_delay() {
    let input = impulse(FRAMES);
    for mix in [0.0, 0.5, 1.0] {
        let mut instance = configured(1, Some(1), false, false);
        instance.set_param("crossoverMode", 1.0);
        instance.set_param("mix", mix);
        render(&mut instance, &vec![(0.0, 0.0); 8192], BLOCK);
        let pcm = render(&mut instance, &input, BLOCK);
        assert_eq!(
            pcm, input,
            "M/S mix {mix} must deliver undelayed neutral PCM"
        );
        assert_eq!(
            instance.get_latency_samples(),
            0,
            "M/S cannot report an unread crossover's 63 samples"
        );
    }
    let mut parallel = configured(1, Some(1), false, false);
    parallel.set_param("globalRouting", 1.0);
    parallel.set_param("crossoverMode", 1.0);
    let pcm = render(&mut parallel, &input, BLOCK);
    assert_eq!(parallel.get_latency_samples(), 63);
    for (n, &frame) in pcm.iter().enumerate() {
        let expected = if n == 63 { input[0] } else { (0.0, 0.0) };
        assert!(
            (frame.0 - expected.0).abs() < 1.0e-10 && (frame.1 - expected.1).abs() < 1.0e-10,
            "Parallel linear-phase sample {n}: {frame:?} vs {expected:?}"
        );
    }
}

fn neutral_delay(samples: &[f32], target: usize, context: &str) {
    for (n, &sample) in samples.iter().enumerate() {
        let expected = if n == target { IMPULSE } else { 0.0 };
        assert!(
            (sample - expected).abs() < 1.0e-10,
            "{context}: sample {n}, {sample} vs integer-delay reference {expected}"
        );
    }
}

fn assert_same_pcm(actual: &[(f32, f32)], expected: &[(f32, f32)], context: &str) {
    assert_eq!(actual.len(), expected.len());
    for (n, (&a, &b)) in actual.iter().zip(expected).enumerate() {
        assert_eq!(
            (a.0.to_bits(), a.1.to_bits()),
            (b.0.to_bits(), b.1.to_bits()),
            "{context}: frame {n}"
        );
    }
}

#[test]
fn all_ordered_factor_and_distortion_toggle_pairs_deliver_their_deficits() {
    // Independent fixed-delay arithmetic, not engine-reported values. The
    // real Parallel PCM de-embeds each converter, including its non-ideal
    // 4x/8x phase; disabled paths use a bare integer delay as their oracle.
    let factors = [1, 2, 4, 8];
    let fixed_delays = [0.0, 6.5, 9.75, 11.375];
    let targets = [0, 39, 42, 44];
    let references: Vec<_> = factors.iter().map(|&factor| reference(factor)).collect();
    let input = impulse(FRAMES);
    for mid in 0..4 {
        for side in 0..4 {
            let target = targets[mid.max(side)];
            for (mid_on, side_on) in [(true, true), (false, true), (true, false), (false, false)] {
                let context = format!(
                    "mid {} side {}, distortion {mid_on}/{side_on}",
                    factors[mid], factors[side]
                );
                let mut instance = configured(factors[mid], Some(factors[side]), mid_on, side_on);
                let pcm = render(&mut instance, &input, BLOCK);
                assert_eq!(
                    instance.get_latency_samples(),
                    target as u32,
                    "{context}: report"
                );
                for (is_side, index, on) in [(false, mid, mid_on), (true, side, side_on)] {
                    let actual = component(&pcm, is_side);
                    if on {
                        assert_added_delay(
                            &actual,
                            &references[index],
                            target as f64 - fixed_delays[index],
                            &context,
                        );
                    } else {
                        neutral_delay(&actual, target, &context);
                    }
                }
                // Metadata, wet, and settled dry/mixed observations are
                // separate. The one-pole mix retains an f32 settling residual;
                // the absolute PCM bound below allows that residual.
                for mix in [0.0, 0.5] {
                    let mut blended =
                        configured(factors[mid], Some(factors[side]), mid_on, side_on);
                    blended.set_param("mix", mix);
                    render(&mut blended, &vec![(0.0, 0.0); 8192], BLOCK);
                    let actual = render(&mut blended, &input, BLOCK);
                    assert_eq!(blended.get_latency_samples(), target as u32);
                    for (n, (&(al, ar), &(wl, wr))) in actual.iter().zip(&pcm).enumerate() {
                        let (dl, dr) = if n == target { input[0] } else { (0.0, 0.0) };
                        let expected = (dl * (1.0 - mix) + wl * mix, dr * (1.0 - mix) + wr * mix);
                        assert!(
                            (al - expected.0).abs() < 2.0e-9 && (ar - expected.1).abs() < 2.0e-9,
                            "{context}, mix {mix}: frame {n} {al}/{ar} vs {expected:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn one_band_and_odd_requests_use_actual_normalized_factors() {
    let input = impulse(FRAMES);
    for (requested, effective, target, fixed) in [
        (1, 1, 0, 0.0),
        (2, 2, 39, 6.5),
        (3, 2, 39, 6.5),
        (4, 4, 42, 9.75),
        (5, 4, 42, 9.75),
        (6, 4, 42, 9.75),
        (7, 4, 42, 9.75),
        (8, 8, 44, 11.375),
    ] {
        let reference = reference(effective);
        for on in [false, true] {
            let mut instance = configured(requested, None, on, false);
            let pcm = render(&mut instance, &input, BLOCK);
            assert_eq!(
                instance.get_latency_samples(),
                target as u32,
                "request {requested}, distortion {on}"
            );
            let mid = component(&pcm, false);
            if on {
                assert_added_delay(
                    &mid,
                    &reference,
                    target as f64 - fixed,
                    &format!("request {requested}"),
                );
            } else {
                neutral_delay(&mid, target, "one-band bypassed mid");
            }
            neutral_delay(&component(&pcm, true), target, "one-band raw side");
        }
    }
}

#[test]
fn one_band_settled_dry_and_mix_use_the_same_integer_target() {
    let input = impulse(FRAMES);
    for (factor, target) in [(1, 0), (2, 39), (4, 42), (8, 44)] {
        for on in [false, true] {
            let mut wet = configured(factor, None, on, false);
            let wet_pcm = render(&mut wet, &input, BLOCK);
            for mix in [0.0, 0.5] {
                let mut blended = configured(factor, None, on, false);
                blended.set_param("mix", mix);
                render(&mut blended, &vec![(0.0, 0.0); 8192], BLOCK);
                let actual = render(&mut blended, &input, BLOCK);
                assert_eq!(blended.get_latency_samples(), target as u32);
                for (n, (&(al, ar), &(wl, wr))) in actual.iter().zip(&wet_pcm).enumerate() {
                    let (dl, dr) = if n == target { input[0] } else { (0.0, 0.0) };
                    let expected = (dl * (1.0 - mix) + wl * mix, dr * (1.0 - mix) + wr * mix);
                    assert!(
                        (al - expected.0).abs() < 2.0e-9 && (ar - expected.1).abs() < 2.0e-9,
                        "one band factor {factor}, distortion {on}, mix {mix}: frame {n}"
                    );
                }
            }
        }
    }
}

#[test]
fn configured_integer_windows_and_enabled_spectral_delay_are_accounted_separately() {
    for (factor, spectral, target) in [
        (1, false, 2304),
        (1, true, 4352),
        (2, false, 1319),
        (3, false, 1319),
        (4, true, 2858),
        (5, true, 2858),
        (6, true, 2858),
        (7, true, 2858),
        (8, true, 2604),
    ] {
        let mut instance = configured(factor, Some(1), false, false);
        instance.set_param("band0_distortionMode", 7.0); // configured Smudge, not engaged
        instance.set_param("band0_codecArtifact", 0.5); // configured codec, not engaged
        instance.set_param("band0_spectralMix", 0.0); // exact delayed spectral dry tap
        instance.set_param("band0_spectralEnabled", f32::from(spectral));
        assert_eq!(
            instance.get_latency_samples(),
            target as u32,
            "factor {factor}, spectral {spectral}"
        );
        let pcm = render(&mut instance, &impulse(8192), BLOCK);
        neutral_delay(&component(&pcm, false), target, "configured windows: mid");
        neutral_delay(&component(&pcm, true), target, "configured windows: side");
        instance.reset();
        instance.set_param("mix", 0.0);
        render(&mut instance, &vec![(0.0, 0.0); 8192], BLOCK);
        let dry = render(&mut instance, &impulse(8192), BLOCK);
        neutral_delay(&component(&dry, false), target, "configured windows: dry");
    }

    // A fractional contributor selects support even when another configured
    // band's larger delay is an integer window.
    let mut instance = configured(2, Some(1), true, false);
    instance.set_param("band1_spectralMix", 0.0);
    instance.set_param("band1_spectralEnabled", 1.0);
    let pcm = render(&mut instance, &impulse(8192), BLOCK);
    assert_eq!(instance.get_latency_samples(), 2080);
    assert_added_delay(
        &component(&pcm, false),
        &reference(2),
        2073.5,
        "fraction beside larger integer",
    );
    neutral_delay(&component(&pcm, true), 2080, "integer spectral side");

    let mut maximum = configured(1, Some(8), false, false);
    maximum.set_param("band0_distortionMode", 7.0);
    maximum.set_param("band0_codecArtifact", 0.5);
    maximum.set_param("band0_spectralMix", 0.0);
    maximum.set_param("band0_spectralEnabled", 1.0);
    assert_eq!(maximum.get_latency_samples(), 4384);
    let pcm = render(&mut maximum, &impulse(8192), BLOCK);
    neutral_delay(&component(&pcm, false), 4384, "maximum configured mid");
    neutral_delay(&component(&pcm, true), 4384, "maximum configured side");
}

#[test]
fn unused_bands_and_crossover_controls_do_not_change_midside_pcm() {
    let input = impulse(FRAMES);
    let mut reference = configured(4, Some(8), true, true);
    let expected = render(&mut reference, &input, BLOCK);
    for count in 2..=6 {
        for linear in [false, true] {
            let mut instance = configured(4, Some(8), true, true);
            instance.set_param("bandCount", count as f32);
            instance.set_param("crossoverMode", f32::from(linear));
            instance.set_param("crossoverSlope", 3.0);
            instance.set_param("crossoverFreq1", 2300.0);
            // A large configured term on an unread band must not enter T.
            instance.set_param("band2_oversampling", 8.0);
            instance.set_param("band2_distortionMode", 7.0);
            instance.set_param("band2_spectralEnabled", 1.0);
            instance.set_param("band2_codecArtifact", 0.5);
            let actual = render(&mut instance, &input, BLOCK);
            assert_eq!(instance.get_latency_samples(), 44);
            assert_same_pcm(
                &actual,
                &expected,
                &format!("count {count}, linear {linear}"),
            );
        }
    }
}

#[test]
fn broadcast_parameters_and_solo_follow_the_actual_midside_sources() {
    let input = impulse(FRAMES);
    let mut explicit = configured(4, Some(4), true, true);
    let expected = render(&mut explicit, &input, BLOCK);
    let mut broadcast = configured(1, Some(1), false, false);
    broadcast.set_param("oversampling", 4.0);
    broadcast.set_param("distortionEnabled", 1.0);
    broadcast.set_param("drive", 0.0);
    assert_eq!(broadcast.get_latency_samples(), 42);
    let actual = render(&mut broadcast, &input, BLOCK);
    assert_same_pcm(&actual, &expected, "broadcast controls");

    let mut explicit = configured(4, Some(8), true, true);
    let expected = render(&mut explicit, &input, BLOCK);
    for selected in ["band0_solo", "band1_solo"] {
        let mut soloed = configured(4, Some(8), true, true);
        soloed.set_param(selected, 1.0);
        assert_eq!(soloed.get_latency_samples(), 44);
        let actual = render(&mut soloed, &input, BLOCK);
        assert_same_pcm(
            &actual,
            &expected,
            "M/S retains its existing solo execution",
        );
    }
}

fn prime(instance: &mut BacteriaInstance, mid: bool, side: bool) {
    let m = if mid { 0.25 } else { 0.0 };
    let s = if side { 0.125 } else { 0.0 };
    let input = vec![(m + s, m - s); 16];
    let output = render(instance, &input, 16);
    assert!(
        output.iter().all(|&(l, r)| l == 0.0 && r == 0.0),
        "priming must leave real audio in flight"
    );
}

fn assert_silent(instance: &mut BacteriaInstance, context: &str) {
    let output = render(instance, &vec![(0.0, 0.0); 256], BLOCK);
    assert!(
        output.iter().all(|&(l, r)| l == 0.0 && r == 0.0),
        "{context}: old compensation history replayed"
    );
}

#[test]
fn real_compensation_histories_clear_at_source_and_inactive_boundaries() {
    for transition in ["reset", "bypass", "routing", "one-to-two", "two-to-one"] {
        let count = if transition == "one-to-two" {
            None
        } else {
            Some(8)
        };
        let mut instance = configured(8, count, false, false);
        prime(&mut instance, true, true);
        match transition {
            "reset" => instance.reset(),
            "bypass" => {
                instance.set_param("bypass", 1.0);
                let input = vec![(0.3, -0.2); 8];
                let output = render(&mut instance, &input, 8);
                assert_same_pcm(&output, &input, "immediate device bypass");
                instance.set_param("bypass", 0.0);
            }
            "routing" => {
                instance.set_param("globalRouting", 1.0);
                render(&mut instance, &vec![(0.0, 0.0); 8], 8);
                instance.set_param("globalRouting", 2.0);
            }
            "one-to-two" => {
                instance.set_param("bandCount", 2.0);
                // Only side changes source. Reset the unchanged mid source
                // here to let this assertion isolate side invalidation.
                instance.set_param("band0_mute", 1.0);
            }
            "two-to-one" => {
                instance.set_param("bandCount", 1.0);
                instance.set_param("band0_mute", 1.0);
            }
            _ => unreachable!(),
        }
        assert_silent(&mut instance, transition);
        assert_eq!(instance.get_latency_samples(), 44);
    }
    for (band, control) in [(0, "mute"), (0, "enabled"), (1, "mute"), (1, "enabled")] {
        let mut instance = configured(8, Some(8), false, false);
        prime(&mut instance, band == 0, band == 1);
        let parameter = format!("band{band}_{control}");
        let inactive = if control == "mute" { 1.0 } else { 0.0 };
        instance.set_param(&parameter, inactive);
        // Suppression is immediate, before any delay has had time to drain.
        let suppressed = render(&mut instance, &vec![(0.0, 0.0); 8], 8);
        assert!(
            suppressed.iter().all(|&(l, r)| l == 0.0 && r == 0.0),
            "mute/disable must suppress immediately"
        );
        instance.set_param(&parameter, 1.0 - inactive);
        assert_silent(&mut instance, "mute/disable re-entry");
        assert_eq!(instance.get_latency_samples(), 44);
    }
}

#[test]
fn raw_side_remains_active_and_idempotent_writes_keep_pending_audio() {
    let mut instance = configured(8, None, false, false);
    prime(&mut instance, false, true);
    instance.set_param("band0_mute", 1.0);
    let output = render(&mut instance, &vec![(0.0, 0.0); 128], BLOCK);
    let mid = component(&output, false);
    let side = component(&output, true);
    assert!(mid.iter().all(|&x| x == 0.0));
    assert_eq!(
        side[44 - 16],
        0.125,
        "muted mid must not suppress the raw side source"
    );

    let input = impulse(FRAMES);
    let mut unchanged = configured(8, Some(8), false, false);
    let expected = render(&mut unchanged, &input, BLOCK);
    let mut written = configured(8, Some(8), false, false);
    let mut actual = render(&mut written, &input[..16], 16);
    for (name, value) in [
        ("globalRouting", 2.0),
        ("bandCount", 2.0),
        ("band0_gain", 0.0),
        ("band1_gain", 0.0),
        ("mix", 1.0),
        ("band0_oversampling", 8.0),
        ("band0_solo", 1.0),
    ] {
        written.set_param(name, value);
    }
    actual.extend(render(&mut written, &input[16..], BLOCK));
    assert_same_pcm(&actual, &expected, "unchanged delay writes");

    // Re-targeting the same active source is a splice, not a reset. With the
    // creative stage disabled the result is an independent pure delay.
    let mut retargeted = configured(8, None, false, false);
    let mut output = render(&mut retargeted, &input[..16], 16);
    retargeted.set_param("band0_oversampling", 2.0);
    output.extend(render(&mut retargeted, &input[16..], BLOCK));
    assert_eq!(retargeted.get_latency_samples(), 39);
    neutral_delay(&component(&output, false), 39, "retargeted active mid");
    neutral_delay(&component(&output, true), 39, "retargeted raw side");
}

#[test]
fn mixed_fractional_render_is_block_partition_invariant() {
    let input: Vec<_> = (0..4096)
        .map(|n| {
            let angle = n as f32 * 0.071;
            (angle.sin() * 0.13, (angle * 1.37).cos() * 0.09)
        })
        .collect();
    let mut reference = configured(4, Some(8), true, true);
    let expected = render(&mut reference, &input, BLOCK);
    for partition in [1, 7, 127, 513] {
        let mut instance = configured(4, Some(8), true, true);
        let actual = render(&mut instance, &input, partition);
        assert_same_pcm(&actual, &expected, &format!("partition {partition}"));
    }
}

#[cfg(debug_assertions)]
#[test]
fn debug_allocator_intercepts_both_allocation_and_free() {
    const CHILD_ENV: &str = "BACTERIA_MS_ALLOCATOR_CANARY";
    const NAME: &str = "debug_allocator_intercepts_both_allocation_and_free";
    if let Ok(operation) = std::env::var(CHILD_ENV) {
        if operation == "free" {
            let allocation = vec![0.0_f32; 1024];
            assert_no_alloc(|| drop(std::hint::black_box(allocation)));
        } else {
            assert_no_alloc(|| std::hint::black_box(vec![0.0_f32; 1024]));
        }
        return;
    }
    for operation in ["allocate", "free"] {
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([NAME, "--exact", "--test-threads=1"])
            .env(CHILD_ENV, operation)
            .output()
            .unwrap();
        assert!(
            !child.status.success(),
            "debug interceptor admitted forbidden {operation}"
        );
        let stderr = String::from_utf8_lossy(&child.stderr);
        assert!(
            stderr.contains("memory allocation of"),
            "canary failed for an unrelated reason: {stderr}"
        );
    }
}

#[cfg(debug_assertions)]
#[test]
fn real_mixed_render_and_control_writes_neither_allocate_nor_free() {
    let mut instance = configured(4, Some(8), true, true);
    let input: [(f32, f32); BLOCK] = std::array::from_fn(|n| {
        let angle = n as f32 * 0.043;
        (angle.sin() * 0.2, (angle * 1.7).cos() * 0.15)
    });
    let mut output = [(0.0_f32, 0.0_f32); BLOCK];
    assert_no_alloc(|| {
        for _ in 0..32 {
            unsafe {
                let left = instance.get_input_left_ptr();
                let right = instance.get_input_right_ptr();
                for (n, &(l, r)) in input.iter().enumerate() {
                    *left.add(n) = l;
                    *right.add(n) = r;
                }
            }
            let left = instance.process(BLOCK as u32);
            let right = instance.get_right_ptr();
            for (n, frame) in output.iter_mut().enumerate() {
                *frame = unsafe { (*left.add(n), *right.add(n)) };
            }
        }
    });
    assert!(output
        .iter()
        .any(|&(l, r)| l.abs() > 1.0e-3 && r.abs() > 1.0e-3));
    assert!(output.iter().all(|&(l, r)| l.is_finite() && r.is_finite()));
    assert_eq!(instance.get_nan_flush_count(), 0.0);
    assert_no_alloc(|| {
        for (name, value) in [
            ("band0_oversampling", 2.0),
            ("band1_oversampling", 4.0),
            ("band0_mute", 1.0),
            ("band0_mute", 0.0),
            ("band1_enabled", 0.0),
            ("band1_enabled", 1.0),
            ("globalRouting", 0.0),
            ("globalRouting", 1.0),
            ("globalRouting", 2.0),
            ("bandCount", 1.0),
            ("bandCount", 2.0),
            ("bypass", 1.0),
            ("bypass", 0.0),
        ] {
            instance.set_param(name, value);
        }
    });
}
