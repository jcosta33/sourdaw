// Authored before extraction; branch expectations use exact binary fractions.
// UNRUN in the source-only draft.
use super::pipeline::{finish_yin, YinProfile};

#[test]
fn first_threshold_admits_search_boundary_and_unconstrained_fit() {
    let result = finish_yin(&[1.0, 0.0625, 0.125, 0.25], 48000.0, 2, 3, YinProfile::FirstThreshold { threshold: 0.15 });
    assert_eq!(result.tau, Some(0.5));
    assert_eq!(result.f0_hz, Some(96000.0));
}

#[test]
fn first_threshold_stops_at_first_plateau_and_admits_max_lag() {
    let result = finish_yin(&[1.0, 1.0, 0.125, 0.125, 0.25], 48000.0, 2, 4, YinProfile::FirstThreshold { threshold: 0.15 });
    assert_eq!(result.tau, Some(2.5));
    let endpoint = finish_yin(&[1.0, 1.0, 0.25, 0.125], 48000.0, 2, 3, YinProfile::FirstThreshold { threshold: 0.15 });
    assert_eq!(endpoint.tau, Some(3.0));
    assert_eq!(endpoint.periodicity, 0.875);
}

#[test]
fn absent_overlap_pitch_retains_nonzero_periodicity() {
    let result = finish_yin(&[1.0, 1.0, 0.25, 0.5], 48000.0, 2, 3, YinProfile::FirstThreshold { threshold: 0.15 });
    assert!(result.f0_hz.is_none());
    assert!(result.tau.is_none());
    assert_eq!(result.periodicity, 0.75);
}

#[test]
fn harmonic_policy_requires_interior_and_uses_integer_confidence() {
    let absent = finish_yin(&[1.0, 1.0, 0.25, 0.125], 48000.0, 2, 3, YinProfile::HarmonicWeighted { threshold: 0.1 });
    assert!(absent.f0_hz.is_none());
    let selected = finish_yin(&[1.0, 0.5, 0.125, 0.25, 1.0], 48000.0, 2, 4, YinProfile::HarmonicWeighted { threshold: 0.1 });
    assert_eq!(selected.periodicity, 0.875);
    assert!(selected.tau.unwrap() > 2.0);
}

#[test]
fn equal_harmonic_scores_keep_first_candidate() {
    let result = finish_yin(&[1.0; 6], 48000.0, 2, 5, YinProfile::HarmonicWeighted { threshold: 1.0 });
    assert_eq!(result.tau, Some(2.0));
    assert_eq!(result.periodicity, 0.0);
}

#[test]
fn threshold_equality_is_not_admitted_but_the_next_lower_value_is() {
    let threshold = 0.15_f32;
    let equal = finish_yin(
        &[1.0, 1.0, threshold], 48000.0, 2, 2,
        YinProfile::FirstThreshold { threshold },
    );
    assert!(equal.f0_hz.is_none());
    let below = f32::from_bits(threshold.to_bits() - 1);
    let admitted = finish_yin(
        &[1.0, 1.0, below], 48000.0, 2, 2,
        YinProfile::FirstThreshold { threshold },
    );
    assert_eq!(admitted.tau, Some(2.0));
}
