//! OE-21 — the engine-side contract the offline export fix depends on.
//!
//! A Levain instance that has never begun a sample load renders *digital silence*,
//! not a fallback tone. The fallback exists precisely to cover an unloaded
//! instrument, but it is constructed `enabled: false` (`levain/fallback.rs:100`)
//! and only `clear_zones()` arms it (`levain/engine.rs:112`) — and `clear_zones`
//! is the first step of the sample loader, not of construction.
//!
//! The offline render used to build Levain nodes without ever running that loader,
//! so every export and every freeze of a Levain track wrote silence. Measured at
//! the time of the fix: `peak=0.000000, voices=0` unloaded against
//! `peak=0.225170, voices=1` once armed.
//!
//! These tests pin both halves. If someone later arms the fallback at construction
//! the first test fails and this comment explains why that is not the fix: it
//! substitutes a sine tone for orchestral samples, which is audible garbage that
//! merely *looks* fixed. The load is the fix; this file guards the reason.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 64;

/// Render `BLOCKS` blocks and return the peak absolute sample across L+R.
fn render_peak(instance: &mut LevainInstance) -> f32 {
    let mut peak = 0.0_f32;
    for _ in 0..BLOCKS {
        let left_ptr = instance.process(BLOCK as u32);
        let right_ptr = instance.get_right_ptr();
        // SAFETY: `process` guarantees BLOCK valid f32s in each channel buffer.
        let left = unsafe { std::slice::from_raw_parts(left_ptr, BLOCK) };
        let right = unsafe { std::slice::from_raw_parts(right_ptr, BLOCK) };
        for sample in left.iter().chain(right.iter()) {
            peak = peak.max(sample.abs());
        }
    }
    peak
}

#[test]
fn an_instance_that_never_began_a_load_renders_silence_not_a_fallback_tone() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.note_on(69, 100);

    let peak = render_peak(&mut instance);

    assert_eq!(
        instance.active_voices(),
        0,
        "an unloaded instance allocated a voice; the zone lookup or fallback arming changed"
    );
    assert_eq!(
        peak, 0.0,
        "an unloaded instance produced output (peak {peak}); if the fallback is now armed at \
         construction, note that a sine tone is not a fix for missing orchestral samples"
    );
}

#[test]
fn beginning_a_load_arms_the_fallback_so_the_instance_is_audible() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    // `clear_zones` is what the sample loader posts first (`clearZones`), and it is
    // the only thing that arms the fallback. The offline render must reach this.
    instance.clear_zones();
    instance.note_on(69, 100);

    let peak = render_peak(&mut instance);

    assert_eq!(
        instance.active_voices(),
        1,
        "an armed instance did not allocate a voice for a held note"
    );
    assert!(
        peak > 0.05,
        "an armed instance rendered peak {peak}, expected an audible fallback tone"
    );
}
