//! Telling a Levain instance which instrument it is must change what it renders.
//!
//! `set_instrument` is the only route to `RealismEngine::configure_for`. An
//! instance that never receives it stays at the constructor default
//! `Instrument::Other`, whose branch zeroes body resonance, sympathetic strings,
//! bow noise, breath and damping — against 0.65 / 0.5 / 0.5 / 0.4 for a bowed
//! string — and never fires the bow-scrape and bow-lift transients, which are
//! gated on `is_bowed_string()`. `realism.tick` sits in the per-sample render
//! path, so the difference is audible, not bookkeeping.
//!
//! The offline export path built its nodes without ever posting the message, so
//! every exported orchestral track was rendered by an unconfigured engine. These
//! tests assert on the rendered signal rather than on a flag, so dropping the
//! message again fails here instead of silently flattening every export.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 128;

/// Render `BLOCKS` blocks and return the interleaved L/R samples.
fn render(instance: &mut LevainInstance) -> Vec<f32> {
    let mut out = Vec::with_capacity(BLOCKS * BLOCK * 2);
    for _ in 0..BLOCKS {
        let left_ptr = instance.process(BLOCK as u32);
        let right_ptr = instance.get_right_ptr();
        // SAFETY: `process` guarantees BLOCK valid f32s in each channel buffer.
        let left = unsafe { std::slice::from_raw_parts(left_ptr, BLOCK) };
        let right = unsafe { std::slice::from_raw_parts(right_ptr, BLOCK) };
        for (l, r) in left.iter().zip(right.iter()) {
            out.push(*l);
            out.push(*r);
        }
    }
    out
}

fn rms(samples: &[f32]) -> f64 {
    let sum_sq: f64 = samples.iter().map(|s| (*s as f64) * (*s as f64)).sum();
    (sum_sq / samples.len() as f64).sqrt()
}

/// Build an instance that is audible (the fallback tone is armed by
/// `clear_zones`, which is what the sample loader posts first) and holding a
/// note. `instrument_id` is applied *before* `clear_zones`, which is the order
/// the offline path uses.
fn armed_instance(instrument_id: Option<&str>) -> LevainInstance {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    if let Some(id) = instrument_id {
        instance.set_instrument(id);
    }
    instance.clear_zones();
    instance.note_on(69, 100);
    instance
}

#[test]
fn an_instance_never_told_its_instrument_renders_a_different_signal() {
    let mut unconfigured = armed_instance(None);
    let mut bowed_string = armed_instance(Some("cello"));

    let plain = render(&mut unconfigured);
    let configured = render(&mut bowed_string);

    assert_eq!(plain.len(), configured.len());

    let difference: Vec<f32> = plain
        .iter()
        .zip(configured.iter())
        .map(|(a, b)| a - b)
        .collect();
    let peak_difference = difference.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
    let plain_rms = rms(&plain);
    let difference_rms = rms(&difference);

    // Both instances must actually be producing something, or "they differ"
    // would be satisfied by one of them being broken into silence.
    assert!(
        plain_rms > 1e-3,
        "the unconfigured instance rendered nothing (rms {plain_rms}); the fallback arming changed",
    );
    assert!(
        rms(&configured) > 1e-3,
        "the configured instance rendered nothing; the bowed-string branch is not passing signal",
    );

    // The realism layer for a bowed string adds body resonance, sympathetic
    // strings, a bow-scrape onset burst and frequency-dependent damping. None of
    // that exists on the `Other` branch, so the two renders cannot match.
    assert!(
        peak_difference > 0.01,
        "configuring the instrument changed the render by at most {peak_difference}; \
         `set_instrument` is no longer reaching the realism layer",
    );
    assert!(
        difference_rms / plain_rms > 0.05,
        "configured and unconfigured renders differ by only {:.4}% rms; \
         the realism layer is no longer instrument-dependent",
        100.0 * difference_rms / plain_rms,
    );
}

#[test]
fn clearing_zones_after_set_instrument_keeps_the_configuration() {
    // The offline path posts `setInstrument` and *then* starts the load, whose
    // first message is `clearZones`. `clear_zones` calls `realism.reset()`, so
    // this pins that reset clearing filter state only — if it ever also cleared
    // the instrument, this render would collapse onto the unconfigured one and
    // the ordering in `prepareOfflineLevain` would be silently wrong.
    let mut set_before_clear = armed_instance(Some("cello"));

    let mut set_after_clear = LevainInstance::new(SAMPLE_RATE, 8);
    set_after_clear.clear_zones();
    set_after_clear.set_instrument("cello");
    set_after_clear.note_on(69, 100);

    let mut never_set = armed_instance(None);

    let before = render(&mut set_before_clear);
    let after = render(&mut set_after_clear);
    let plain = render(&mut never_set);

    let distance = |left: &[f32], right: &[f32]| -> f64 {
        let diff: Vec<f32> = left.iter().zip(right.iter()).map(|(a, b)| a - b).collect();
        rms(&diff)
    };

    // Configuring before the clear must land no further from configuring after it
    // than the unconfigured render is — i.e. the clear did not undo it.
    let ordering_gap = distance(&before, &after);
    let unconfigured_gap = distance(&plain, &after);
    assert!(
        unconfigured_gap > 1e-4,
        "an unconfigured instance renders identically to a configured one, so this test cannot \
         tell the two orderings apart; `set_instrument` is not reaching the realism layer at all",
    );
    assert!(
        ordering_gap < unconfigured_gap * 0.5,
        "set_instrument before clear_zones ({ordering_gap:.6} from the reference) is nearly as \
         far off as never setting it at all ({unconfigured_gap:.6}); clear_zones now discards \
         the instrument configuration and prepareOfflineLevain must post it after the load",
    );
}
