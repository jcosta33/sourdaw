//! The block-queued preview voice must remain outside MIDI note ownership.

#[cfg(debug_assertions)]
use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use daw_dsp::grand_boule::{GrandBouleInstance, GRAND_BOULE_BLOCK_FRAMES as FRAMES};

#[cfg(debug_assertions)]
#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const SAMPLE_RATE: f32 = 48_000.0;
const NOTE: u8 = 60;
const STRIKE: u32 = 19;

fn render(instance: &mut GrandBouleInstance) -> Vec<f32> {
    let left = instance.process(FRAMES as u32);
    // SAFETY: `process` returns its own readable left buffer, covering
    // FRAMES samples. The instance stays unchanged while we copy them.
    unsafe { std::slice::from_raw_parts(left, FRAMES) }.to_vec()
}

#[test]
fn a_preview_and_a_channel_zero_note_at_the_same_pitch_sound_in_two_slots() {
    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 2);
    assert!(instance.push_note_on(NOTE, 0.7, 0, 0));
    assert!(instance.push_preview_note_on(STRIKE, NOTE, 0.5, 128));

    let output = render(&mut instance);
    assert!(output.iter().any(|sample| sample.abs() > 1.0e-4));
    assert_eq!(
        instance.active_voices(),
        2,
        "the preview retriggered the ordinary MIDI note at the same pitch"
    );
}

#[test]
fn a_preview_off_cannot_change_the_pcm_of_an_ordinary_note_on_another_channel() {
    let programme = |send_preview_off| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 2);
        assert!(instance.push_note_on(NOTE, 0.7, 2, 0));
        if send_preview_off {
            assert!(instance.push_preview_note_off(STRIKE, 1024));
        }
        render(&mut instance)
    };
    let ordinary = programme(false);
    let with_stale_release = programme(true);

    assert!(ordinary[1024..].iter().any(|sample| sample.abs() > 1.0e-4));
    let difference = ordinary
        .iter()
        .zip(with_stale_release)
        .map(|(a, b)| (a - b).abs())
        .fold(0.0, f32::max);
    assert_eq!(
        difference, 0.0,
        "a preview release damped ordinary MIDI PCM"
    );
}

#[test]
fn midi_releases_and_expression_leave_preview_pcm_unchanged() {
    const BOUNDARY: usize = 1024;

    let programme = |midi_commands, release_preview| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 2);
        assert!(instance.push_preview_note_on(STRIKE, NOTE, 0.7, 128));
        if midi_commands {
            let at = BOUNDARY as u32;
            assert!(instance.push_note_expression(NOTE, 0, 12.0, 0.0, 0.0, at));
            assert!(instance.push_note_off_on_channel(NOTE, 0, at));
            assert!(instance.push_note_off(NOTE, at));
        }
        if release_preview {
            assert!(instance.push_preview_note_off(STRIKE, BOUNDARY as u32));
        }
        let block = render(&mut instance);
        let tail = render(&mut instance);
        (block, tail)
    };
    let (held, held_tail) = programme(false, false);
    let (midi_commands, midi_tail) = programme(true, false);
    let (released, released_tail) = programme(false, true);

    assert!(held[..128].iter().all(|sample| *sample == 0.0));
    assert!(held[128..BOUNDARY]
        .iter()
        .any(|sample| sample.abs() > 1.0e-4));
    assert_eq!(held, midi_commands);
    assert_eq!(held_tail, midi_tail);
    assert_eq!(held[..BOUNDARY], released[..BOUNDARY]);
    let energy = |samples: &[f32]| samples.iter().map(|sample| sample * sample).sum::<f32>();
    assert!(energy(&held_tail) > 4.0 * energy(&released_tail));
}

#[test]
fn a_full_voice_pool_counts_refusal_and_leaves_midi_pcm_unchanged() {
    let programme = |send_preview| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 1);
        assert!(instance.push_note_on(NOTE, 0.7, 6, 0));
        if send_preview {
            assert!(instance.push_preview_note_on(STRIKE, NOTE + 5, 0.8, 64));
            assert!(instance.push_preview_note_off(STRIKE, 128));
        }
        assert_eq!(instance.get_preview_voice_refusal_count(), 0.0);
        let output = render(&mut instance);
        (output, instance.get_preview_voice_refusal_count())
    };
    let (ordinary, ordinary_refusals) = programme(false);
    let (with_refused_preview, preview_refusals) = programme(true);

    assert!(ordinary.iter().any(|sample| sample.abs() > 1.0e-4));
    assert_eq!(ordinary, with_refused_preview);
    assert_eq!(ordinary_refusals, 0.0);
    assert_eq!(preview_refusals, 1.0);
}

#[test]
fn panic_kills_held_and_pending_previews() {
    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 2);
    assert!(instance.push_preview_note_on(STRIKE, NOTE, 0.7, 0));
    assert!(render(&mut instance)
        .iter()
        .any(|sample| sample.abs() > 1.0e-4));

    assert!(instance.push_preview_note_on(STRIKE + 1, NOTE + 2, 0.7, 256));
    assert!(instance.push_preview_note_off(STRIKE, 512));
    instance.all_notes_off();

    assert!(render(&mut instance).iter().all(|sample| *sample == 0.0));
    assert_eq!(instance.active_voices(), 0);
}

#[cfg(debug_assertions)]
#[test]
fn pushing_and_rendering_preview_events_does_not_allocate() {
    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 1);
    let left = assert_no_alloc(|| {
        assert!(instance.push_preview_note_on(STRIKE, NOTE, 0.7, 128));
        assert!(instance.push_preview_note_on(STRIKE + 1, NOTE + 2, 0.7, 192));
        assert!(instance.push_preview_note_off(STRIKE, 2048));
        instance.process(FRAMES as u32)
    });

    // SAFETY: `process` returned the instance's buffer of FRAMES samples.
    // No other call has borrowed the instance or changed that buffer.
    let output = unsafe { std::slice::from_raw_parts(left, FRAMES) };
    assert!(output[128..2048].iter().any(|sample| sample.abs() > 1.0e-4));
    assert_eq!(instance.get_preview_voice_refusal_count(), 1.0);
}

fn fundamental_energy(samples: &[f32], frequency: f32) -> f32 {
    let radians_per_frame = std::f32::consts::TAU * frequency / SAMPLE_RATE;
    let mut in_phase = 0.0;
    let mut quadrature = 0.0;
    for (frame, &sample) in samples.iter().enumerate() {
        let (sine, cosine) = (frame as f32 * radians_per_frame).sin_cos();
        in_phase += sample * cosine;
        quadrature += sample * sine;
    }
    in_phase * in_phase + quadrature * quadrature
}

#[test]
fn either_same_pitch_release_leaves_the_other_voice_ringing() {
    const RELEASE_AT: u32 = 1024;
    const C4_HZ: f32 = 261.63;
    const G4_HZ: f32 = 392.0;

    // Bend the channel's C4 into G4 so the rendered channel and preview
    // contributions can be observed independently even though both own C4.
    let programme = |channel, release_preview, release_midi| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 2);
        assert!(instance.push_preview_note_on(STRIKE, NOTE, 0.7, 0));
        assert!(instance.push_note_on(NOTE, 0.7, channel, 0));
        assert!(instance.push_note_expression(NOTE, channel, 7.0, 0.0, 0.0, 0));
        if release_preview {
            assert!(instance.push_preview_note_off(STRIKE, RELEASE_AT));
        }
        if release_midi {
            let accepted = if channel == 0 {
                instance.push_note_off(NOTE, RELEASE_AT)
            } else {
                instance.push_note_off_on_channel(NOTE, channel, RELEASE_AT)
            };
            assert!(accepted);
        }
        render(&mut instance);
        let tail = render(&mut instance);
        [
            fundamental_energy(&tail, C4_HZ),
            fundamental_energy(&tail, G4_HZ),
        ]
    };

    for channel in [0, 2] {
        let [preview, midi] = programme(channel, false, false);
        assert!(preview > 1.0 && midi > 1.0, "both controls must sound");
        let [damped_preview, held_midi] = programme(channel, true, false);
        assert!(damped_preview < preview / 8.0);
        assert!(held_midi > midi / 2.0);

        let [held_preview, damped_midi] = programme(channel, false, true);
        assert!(held_preview > preview / 2.0);
        assert!(damped_midi < midi / 8.0);
    }
}

#[test]
fn a_released_strikes_duplicate_off_leaves_the_later_same_pitch_preview_held() {
    let programme = |repeat_release| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 2);
        assert!(instance.push_preview_note_on(STRIKE, NOTE, 0.7, 0));
        assert!(instance.push_preview_note_off(STRIKE, 256));
        assert!(instance.push_preview_note_on(STRIKE + 1, NOTE, 0.8, 512));
        if repeat_release {
            assert!(instance.push_preview_note_off(STRIKE, 1024));
        }
        render(&mut instance)
    };
    let held = programme(false);
    let after_old_off = programme(true);
    assert!(held[1024..].iter().any(|sample| sample.abs() > 1.0e-4));
    assert_eq!(held, after_old_off);
}

#[test]
fn a_stolen_strikes_off_leaves_the_midi_replacement_and_its_fade_alone() {
    let programme = |release_stolen_preview| {
        let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 1);
        assert!(instance.push_preview_note_on(STRIKE, NOTE, 0.7, 0));
        assert!(instance.push_note_on(NOTE, 0.8, 0, 1024));
        if release_stolen_preview {
            assert!(instance.push_preview_note_off(STRIKE, 1028));
        }
        render(&mut instance)
    };
    let held = programme(false);
    let after_old_off = programme(true);
    assert!(held[2048..].iter().any(|sample| sample.abs() > 1.0e-4));
    assert_eq!(held, after_old_off);
}

#[test]
fn preview_releases_follow_sustain_and_sostenuto() {
    type PushPedal = fn(&mut GrandBouleInstance, bool, u32) -> bool;
    let sustain: PushPedal =
        |instance, down, at| instance.push_sustain(if down { 1.0 } else { 0.0 }, at);
    let sostenuto: PushPedal = GrandBouleInstance::push_sostenuto;

    for pedal in [sustain, sostenuto] {
        let programme = |preview, keep_pedal_down| {
            let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 1);
            if preview {
                assert!(instance.push_preview_note_on(STRIKE, NOTE, 0.7, 0));
            } else {
                assert!(instance.push_note_on(NOTE, 0.7, 0, 0));
            }
            assert!(pedal(&mut instance, true, 128));
            if preview {
                assert!(instance.push_preview_note_off(STRIKE, 256));
            } else {
                assert!(instance.push_note_off(NOTE, 256));
            }
            if !keep_pedal_down {
                assert!(pedal(&mut instance, false, 1024));
            }
            (render(&mut instance), render(&mut instance))
        };

        let (reference, reference_tail) = programme(false, false);
        let (preview, preview_tail) = programme(true, false);
        let (pedal_held, pedal_held_tail) = programme(true, true);
        assert_eq!(reference, preview);
        assert_eq!(reference_tail, preview_tail);
        assert_eq!(pedal_held[..1024], preview[..1024]);
        assert!(
            fundamental_energy(&pedal_held_tail, 261.63)
                > fundamental_energy(&preview_tail, 261.63) * 4.0
        );
    }
}
