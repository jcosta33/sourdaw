//! `cabIrSlot` is reachable from the AudioWorklet's `set_param`, which runs on
//! the audio thread. Switching slots therefore has to refill buffers the
//! cabinet already owns instead of allocating new ones.
//!
//! The interceptor is debug-only (`assert_no_alloc`'s `disable_release`
//! feature) — run this through `pnpm cargo:test`, and expect a violation to
//! abort the process with `memory allocation of N bytes failed` rather than
//! fail as a normal assertion.

use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use daw_dsp::grinder::engine::GrinderEngine;

#[cfg(debug_assertions)]
#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

#[test]
fn switching_the_cabinet_ir_slot_does_not_allocate() {
    let mut engine = GrinderEngine::new(48_000.0);
    let mut left = vec![0.05_f32; 128];
    let mut right = vec![0.05_f32; 128];
    engine.process_block(&mut left, &mut right);

    assert_no_alloc(|| {
        engine.set_param("cabIrSlot", 1.0);
        engine.set_param("cabIrSlot", 2.0);
        engine.set_param("cabIrSlot", 0.0);
        engine.set_param("cabEnabled", 0.0);
        engine.set_param("cabEnabled", 1.0);
    });

    engine.process_block(&mut left, &mut right);
    assert!(
        left.iter().all(|sample| sample.is_finite()),
        "the cabinet must keep rendering after an in-place slot switch"
    );
}
