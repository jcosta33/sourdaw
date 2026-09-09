use scoring::ScoringInstance;

const FRAMES: usize = 128;
const SAMPLE_RATE: f32 = 48_000.0;

fn write_inputs(instance: &mut ScoringInstance, left: &[f32], right: &[f32]) {
    // SAFETY: both pointers address the instance's fixed 1024-sample channel
    // arrays, and FRAMES is 128 for the lifetime of this exclusive borrow.
    unsafe {
        std::slice::from_raw_parts_mut(instance.get_left_ptr() as *mut f32, FRAMES)
            .copy_from_slice(left);
        std::slice::from_raw_parts_mut(instance.get_right_ptr() as *mut f32, FRAMES)
            .copy_from_slice(right);
    }
}

fn output(instance: &ScoringInstance) -> (&[f32], &[f32]) {
    // SAFETY: both pointers address fixed instance-owned arrays, FRAMES is in
    // bounds, and the returned slices cannot outlive the shared instance borrow.
    unsafe {
        (
            std::slice::from_raw_parts(instance.get_left_ptr(), FRAMES),
            std::slice::from_raw_parts(instance.get_right_ptr(), FRAMES),
        )
    }
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
            output(&sliced),
            output(&in_place),
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
