use proof_chamber::ProofChamberInstance;

const FRAMES: usize = 128;
const SAMPLE_RATE: f32 = 48_000.0;

fn write_inputs(instance: &mut ProofChamberInstance, left: &[f32], right: &[f32]) {
    // SAFETY: both pointers address the instance's fixed 1024-sample channel
    // arrays, and FRAMES is 128 for the lifetime of this exclusive borrow.
    unsafe {
        std::slice::from_raw_parts_mut(instance.get_left_ptr() as *mut f32, FRAMES)
            .copy_from_slice(left);
        std::slice::from_raw_parts_mut(instance.get_right_ptr() as *mut f32, FRAMES)
            .copy_from_slice(right);
    }
}

fn output(instance: &ProofChamberInstance) -> (&[f32], &[f32]) {
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
fn native_slice_and_wasm_in_place_paths_match_every_shipped_algorithm() {
    for algorithm in [0.0, 1.0, 2.0, 3.0, 6.0] {
        let mut sliced = ProofChamberInstance::new(SAMPLE_RATE);
        let mut in_place = ProofChamberInstance::new(SAMPLE_RATE);
        for instance in [&mut sliced, &mut in_place] {
            instance.set_param("algorithm", algorithm);
            instance.set_param("mix", 1.0);
            instance.set_param("decay", 0.7);
            instance.set_param("size", 0.0);
        }
        let stable_ptrs = (in_place.get_left_ptr(), in_place.get_right_ptr());

        for block in 0..224 {
            let mut left = [0.0_f32; FRAMES];
            let mut right = [0.0_f32; FRAMES];
            for frame in 0..FRAMES {
                let absolute = (block * FRAMES + frame) as f32;
                left[frame] = (absolute * 173.0 * std::f32::consts::TAU / SAMPLE_RATE).sin() * 0.6;
                right[frame] =
                    (absolute * 281.0 * std::f32::consts::TAU / SAMPLE_RATE).cos() * 0.35;
            }

            sliced.process(&left, &right, FRAMES as u32);
            write_inputs(&mut in_place, &left, &right);
            in_place.process_in_place(FRAMES as u32);
            assert_eq!(
                output(&sliced),
                output(&in_place),
                "algorithm {algorithm} diverged at block {block}"
            );
        }

        assert_eq!(
            (in_place.get_left_ptr(), in_place.get_right_ptr()),
            stable_ptrs,
            "algorithm {algorithm} moved a preallocated channel"
        );
    }
}
