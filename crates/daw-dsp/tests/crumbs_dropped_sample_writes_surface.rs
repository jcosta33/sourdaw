//! The sample pool's refused writes must be observable from the host.
//!
//! PR #2033 made a full pool refuse writes as a counted no-op instead of a
//! debug assert that would kill the render thread. The count then sat in the
//! pool with no reader. This guard proves the count reaches the metering the
//! host reads: fill the pool past its bound, render a block, and the wasm
//! surface must report the refusals. With the metering mirror reverted, the
//! export stays at 0 and the guard fails.

use daw_dsp::crumbs::CrumbsInstance;

const SAMPLE_RATE: f32 = 48_000.0;
/// `MAX_POOL_SAMPLES` — the pool's fixed per-instance slot count.
const MAX_POOL_SAMPLES: usize = 4096;

#[test]
fn writes_past_the_pool_bound_surface_through_the_metering() {
    let mut instance = CrumbsInstance::new(SAMPLE_RATE);

    // Fill every slot, then two more: each add past the bound is refused and
    // counted, and `add_sample` still returns (the returned id addresses an
    // empty slot, which every reader already treats as silence).
    for _ in 0..(MAX_POOL_SAMPLES + 2) {
        let _ = instance.add_sample(vec![0.0], 1, SAMPLE_RATE as u32);
    }

    // The metering mirror refreshes in `process`, as the voice count does.
    let _ = instance.process(1);

    assert_eq!(
        instance.dropped_sample_writes(),
        2,
        "two writes past the pool bound were refused; the surfaced count must match, or sample \
         loads are failing silently again"
    );
}

#[test]
fn a_pool_within_its_bound_reports_no_refusals() {
    let mut instance = CrumbsInstance::new(SAMPLE_RATE);
    let _ = instance.add_sample(vec![0.0], 1, SAMPLE_RATE as u32);
    let _ = instance.process(1);

    assert_eq!(
        instance.dropped_sample_writes(),
        0,
        "a pool with one live sample refused nothing; a non-zero count here would make the \
         surfaced warning meaningless"
    );
}
