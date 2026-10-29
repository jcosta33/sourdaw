use daw_dsp::toaster::transient::{TransientShaper, TransientShaperInstance};

#[test]
fn transient_shaper_matches_two_independent_existing_scalars() {
    for rate in [8_000.0, 44_100.0, 48_000.0, 96_000.0] {
        let mut effect = TransientShaperInstance::new(rate).unwrap();
        let mut left = TransientShaper::new(rate);
        let mut right = TransientShaper::new(rate);
        for frame in 0..12_731 {
            let l = if frame < 5_000 { 0.5 } else { -0.2 };
            let r = if frame % 137 < 3 { 0.7 } else { 0.001 };
            let attack = if frame < 3_500 { 1.0 } else { 1.5 };
            let sustain = if frame < 3_500 { 1.0 } else { 0.25 };
            left.set_attack(attack);
            left.set_sustain(sustain);
            right.set_attack(attack);
            right.set_sustain(sustain);
            assert_eq!(effect.process_left(l, attack, sustain), left.process(l));
            assert_eq!(effect.process_right(r, attack, sustain), right.process(r));
        }
    }
}

#[test]
fn transient_shaper_unity_warms_and_reset_changes_first_reentry_sample() {
    let mut effect = TransientShaperInstance::new(48_000.0).unwrap();
    for _ in 0..48_000 {
        assert_eq!(effect.process_left(0.5, 1.0, 1.0), 0.5);
        assert_eq!(effect.process_right(0.5, 1.0, 1.0), 0.5);
    }
    assert_eq!(effect.process_left(0.5, 2.0, 0.25), 0.125);
    effect.reset();
    assert_eq!(effect.process_left(0.5, 2.0, 0.25), 1.0);
    assert_eq!(effect.process_right(0.5, 2.0, 0.25), 1.0);
}

#[test]
fn transient_shaper_rejects_invalid_rates_and_retains_finite_bounded_gains() {
    for rate in [0.0, -1.0, f32::NAN, f32::INFINITY] {
        assert!(TransientShaperInstance::new(rate).is_err());
    }
    let mut effect = TransientShaperInstance::new(48_000.0).unwrap();
    assert_eq!(effect.process_left(0.5, 20.0, -20.0), 1.0);
    assert_eq!(effect.process_left(0.5, f32::NAN, f32::INFINITY), 1.0);
    for input in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, f32::MAX] {
        assert!(effect.process_left(input, 2.0, 0.5).is_finite());
    }
    // Invalid PCM never enters the other channel's detector either.
    assert_eq!(effect.process_right(f32::NAN, 2.0, 0.25), 0.0);
    assert_eq!(effect.process_right(0.5, 2.0, 0.25), 1.0);
}

#[test]
fn transient_shaper_preserves_toaster_transient_lock_write_restore() {
    use daw_dsp::toaster::ToasterInstance;
    fn render(instance: &mut ToasterInstance, blocks: usize) -> Vec<f32> {
        let mut audio = Vec::new();
        for _ in 0..blocks {
            let pointer = instance.process(128);
            audio.extend_from_slice(unsafe { std::slice::from_raw_parts(pointer, 128) });
        }
        audio
    }
    for (id, name) in [(13, "transient_attack"), (14, "transient_sustain")] {
        let mut locked = ToasterInstance::new(48_000.0, 16);
        let mut restored = ToasterInstance::new(48_000.0, 16);
        let mut persistent = ToasterInstance::new(48_000.0, 16);
        locked.set_pad_param_lock_by_id(0, id, 0.25);
        restored.set_pad_param(0, name, 0.25);
        persistent.set_pad_param(0, name, 0.25);
        for instance in [&mut locked, &mut restored, &mut persistent] {
            instance.note_on(0, 100.0, 60);
        }
        let first = render(&mut locked, 8);
        assert_eq!(first, render(&mut restored, 8));
        assert_eq!(first, render(&mut persistent, 8));
        // Transient gains are read during the whole voice, unlike voice tune
        // captured at note_on. Preserve identical effect histories through its
        // tail, then restore the legacy base gain before the next hit.
        for instance in [&mut locked, &mut restored, &mut persistent] {
            instance.note_off(0);
            for _ in 0..4000 {
                if instance.lifecycle_state()
                    == daw_dsp::primitives::lifecycle::ProcessLifecycle::SLEEP_CODE
                {
                    break;
                }
                render(instance, 1);
            }
            assert_eq!(
                instance.lifecycle_state(),
                daw_dsp::primitives::lifecycle::ProcessLifecycle::SLEEP_CODE
            );
        }
        restored.set_pad_param(0, name, 1.0);
        for instance in [&mut locked, &mut restored, &mut persistent] {
            instance.note_on(0, 100.0, 60);
        }
        let next = render(&mut locked, 8);
        assert_eq!(next, render(&mut restored, 8));
        assert_ne!(next, render(&mut persistent, 8));
    }
}

#[test]
fn transient_shaper_old_scalar_matches_frozen_dual_follower_recurrence() {
    let rate = 48_000.0_f32;
    let fast = 1.0 - (-1.0 / (0.0005 * rate)).exp();
    let slow = 1.0 - (-1.0 / (0.02 * rate)).exp();
    let mut fast_env = 0.0_f32;
    let mut slow_env = 0.0_f32;
    let mut scalar = TransientShaper::new(rate);
    scalar.set_attack(1.5);
    scalar.set_sustain(0.25);
    for frame in 0..48_000 {
        let input = if frame < 1024 {
            0.5_f32
        } else if frame < 2048 {
            -0.125
        } else {
            0.0
        };
        fast_env += fast * (input.abs() - fast_env);
        slow_env += slow * (input.abs() - slow_env);
        if fast_env.abs() < f32::MIN_POSITIVE {
            fast_env = 0.0;
        }
        if slow_env.abs() < f32::MIN_POSITIVE {
            slow_env = 0.0;
        }
        let expected = input
            * if (fast_env - slow_env).max(0.0) > 0.01 {
                1.5
            } else {
                0.25
            };
        assert_eq!(
            scalar.process(input),
            expected,
            "frozen recurrence frame {frame}"
        );
    }
}
