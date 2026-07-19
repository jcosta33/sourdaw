use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use daw_dsp::grinder::engine::GrinderEngine;
use daw_dsp::grinder::params::{
    GRINDER_AUTOMATABLE_PARAM_CONTRACT, GRINDER_AUTOMATABLE_PARAM_COUNT,
};

#[cfg(debug_assertions)]
#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const FRAMES: usize = 128;

#[test]
fn automated_block_is_allocation_and_ir_refresh_free() {
    let mut engine = GrinderEngine::new(48_000.0);
    let mut left = vec![0.05; FRAMES];
    let mut right = vec![0.05; FRAMES];
    let mut automation =
        vec![0.0; GRINDER_AUTOMATABLE_PARAM_COUNT + GRINDER_AUTOMATABLE_PARAM_COUNT * FRAMES];

    for (index, param) in GRINDER_AUTOMATABLE_PARAM_CONTRACT.iter().enumerate() {
        automation[index] = 1.0;
        automation[GRINDER_AUTOMATABLE_PARAM_COUNT + index * FRAMES] = param.default;
    }

    automation[0] = FRAMES as f32;
    for frame in 0..FRAMES {
        automation[GRINDER_AUTOMATABLE_PARAM_COUNT + frame] =
            frame as f32 / (FRAMES - 1) as f32 * 10.0;
    }

    engine.process_block(&mut left, &mut right);

    assert_no_alloc(|| {
        engine.process_block_automated(&mut left, &mut right, &automation, FRAMES);
    });
}
