#![allow(clippy::unwrap_used, reason = "tests assert by unwrapping")]

use scoring::ScoringInstance;

const FRAMES: usize = 128;
const SAMPLE_RATE: f32 = 48_000.0;

fn write_inputs(instance: &mut ScoringInstance, left: &[f32], right: &[f32]) {
    // SAFETY: `get_left_ptr` addresses the instance's `out_left`, a 1024-sample
    // initialised buffer that `ScoringInstance::new` allocates and nothing
    // resizes; `FRAMES` (128) is inside it, and the temporary slice is the only
    // access to the buffer while this statement holds the exclusive borrow.
    unsafe { std::slice::from_raw_parts_mut(instance.get_left_ptr(), FRAMES) }
        .copy_from_slice(left);
    // SAFETY: `get_right_ptr` addresses the separate `out_right`, sized and
    // borrowed exactly as `out_left` above.
    unsafe { std::slice::from_raw_parts_mut(instance.get_right_ptr(), FRAMES) }
        .copy_from_slice(right);
}

fn output(instance: &mut ScoringInstance) -> (&[f32], &[f32]) {
    let left_ptr = instance.get_left_ptr();
    let right_ptr = instance.get_right_ptr();
    (
        // SAFETY: `left_ptr` addresses the instance's `out_left`, a 1024-sample
        // initialised buffer that nothing resizes; `FRAMES` is inside it, and
        // the returned slice is tied to the exclusive instance borrow, so
        // nothing writes it while it lives.
        unsafe { std::slice::from_raw_parts(left_ptr, FRAMES) },
        // SAFETY: `right_ptr` addresses the separate `out_right`, sized and
        // borrowed exactly as `out_left` above.
        unsafe { std::slice::from_raw_parts(right_ptr, FRAMES) },
    )
}

#[test]
fn native_slice_and_wasm_in_place_paths_match_output_and_telemetry() {
    let mut sliced = ScoringInstance::new(SAMPLE_RATE);
    let mut in_place = ScoringInstance::new(SAMPLE_RATE);
    for instance in [&mut sliced, &mut in_place] {
        instance.set_param("threshold", 0.01);
        instance.set_param("poly", 1.0);
    }
    let stable_ptrs = (in_place.get_left_ptr(), in_place.get_right_ptr());

    for block in 0..256 {
        let mut left = [0.0_f32; FRAMES];
        let mut right = [0.0_f32; FRAMES];
        for frame in 0..FRAMES {
            let absolute = (block * FRAMES + frame) as f32;
            left[frame] = (absolute * 220.0 * std::f32::consts::TAU / SAMPLE_RATE).sin() * 0.7;
            right[frame] = (absolute * 330.0 * std::f32::consts::TAU / SAMPLE_RATE).sin() * 0.4;
        }

        sliced.process(&left, &right, FRAMES as u32);
        write_inputs(&mut in_place, &left, &right);
        in_place.process_in_place(FRAMES as u32);
        assert_eq!(
            output(&mut sliced),
            output(&mut in_place),
            "output diverged at block {block}"
        );
    }

    assert_eq!(
        (in_place.get_left_ptr(), in_place.get_right_ptr()),
        stable_ptrs,
        "in-place processing moved a preallocated channel"
    );
    assert_eq!(sliced.get_frequency(), in_place.get_frequency());
    assert_eq!(sliced.get_cents(), in_place.get_cents());
    assert_eq!(sliced.get_confidence(), in_place.get_confidence());
    assert_eq!(sliced.get_note_index(), in_place.get_note_index());
    assert_eq!(sliced.get_octave(), in_place.get_octave());
    assert_eq!(sliced.get_midi_note(), in_place.get_midi_note());
    assert_eq!(sliced.is_active(), in_place.is_active());
    assert_eq!(
        sliced.get_poly_string_count(),
        in_place.get_poly_string_count()
    );
    for index in 0..sliced.get_poly_string_count() {
        assert_eq!(
            sliced.get_poly_string_cents(index),
            in_place.get_poly_string_cents(index)
        );
        assert_eq!(
            sliced.get_poly_string_confidence(index),
            in_place.get_poly_string_confidence(index)
        );
        assert_eq!(
            sliced.is_poly_string_active(index),
            in_place.is_poly_string_active(index)
        );
    }
}
