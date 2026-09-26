//! Every note plays every loaded mic position together.
//!
//! A multi-mic bank holds one phase-locked recording per position of the same
//! performance (Kontakt/Spitfire-style mic positions). A note sounds every
//! loaded position at once, and the mixer places each through that position's
//! own level, constant-power pan and on/off switch.
//!
//! The fixtures give each position a sine at its own frequency, so which
//! positions a render carries is read per channel from a single-frequency DFT
//! bin rather than from level alone.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// One tenth of a second. Every tone below completes a whole number of cycles
/// in it, so a sustain looped over the whole recording has no seam.
const FRAME_COUNT: u32 = 4_800;
const SUSTAIN: u16 = 0;
const NOTE: u8 = 69;
const VELOCITY: u8 = 100;
/// Frames rendered after a note-on before measuring, past the attack.
const SETTLE_FRAMES: usize = 4_800;
/// DFT window: 8192 frames at 48 kHz resolve tones a few hertz apart.
const WINDOW: usize = 8_192;

const MIC_0_HZ: f32 = 440.0;
const MIC_1_HZ: f32 = 660.0;

/// An instrument id with a neutral realism preset: no body, sympathetic,
/// noise or damping stage, so the output carries exactly the recorded
/// content and silence on a position is exact.
const NEUTRAL_INSTRUMENT: &str = "soprano";
/// A bowed string, whose realism stages filter and add noise per position.
const BOWED_INSTRUMENT: &str = "violin-1";

/// One authored zone: which mic position, what it sounds, and where it sits.
#[derive(Clone, Copy)]
struct Take {
    mic: u8,
    hz: f32,
    lo_vel: u8,
    hi_vel: u8,
    is_release: bool,
}

impl Take {
    fn sustain(mic: u8, hz: f32) -> Self {
        Self {
            mic,
            hz,
            lo_vel: 0,
            hi_vel: 127,
            is_release: false,
        }
    }

    fn release(mic: u8, hz: f32) -> Self {
        Self {
            is_release: true,
            ..Self::sustain(mic, hz)
        }
    }

    fn velocities(self, lo_vel: u8, hi_vel: u8) -> Self {
        Self {
            lo_vel,
            hi_vel,
            ..self
        }
    }
}

fn sine(hz: f32) -> Vec<f32> {
    (0..FRAME_COUNT)
        .map(|frame| (frame as f32 / SAMPLE_RATE * hz * std::f32::consts::TAU).sin() * 0.5)
        .collect()
}

fn add_sine(instance: &mut LevainInstance, hz: f32) -> u32 {
    instance
        .add_sample(sine(hz), FRAME_COUNT, 1, SAMPLE_RATE)
        .expect("sample adds to a uniquely-owned bank")
}

/// Stage `takes` into a begun bank. Sustains loop the whole recording;
/// release takes are one-shots.
fn stage_takes(instance: &mut LevainInstance, takes: &[Take]) {
    for (zone_id, take) in takes.iter().enumerate() {
        let sample_id = add_sine(instance, take.hz);
        instance.add_zone(
            zone_id as u32,
            sample_id,
            SUSTAIN,
            NOTE,
            0.0,
            0,
            127,
            take.lo_vel,
            take.hi_vel,
            0,
            1,
            take.mic,
            take.is_release,
            if take.is_release { 0 } else { 1 },
            0,
            FRAME_COUNT,
            0,
            0.0,
            0.001,
            0.1,
            1.0,
            0.2,
        );
    }
}

fn commit(instance: &mut LevainInstance, mics: u32) {
    assert!(
        instance.build_zone_map(1, mics),
        "the bank is within the zone map's dimension limits",
    );
    assert!(instance.commit_sample_bank(), "a built bank must commit");
}

fn load(instance: &mut LevainInstance, instrument: &str, mics: u32, takes: &[Take]) {
    instance.begin_sample_bank(instrument);
    stage_takes(instance, takes);
    commit(instance, mics);
}

fn instance_with(instrument: &str, mics: u32, takes: &[Take]) -> LevainInstance {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    load(&mut instance, instrument, mics, takes);
    instance
}

/// The two-position bank: mic 0 records `MIC_0_HZ`, mic 1 `MIC_1_HZ`.
fn two_mic_instance() -> LevainInstance {
    instance_with(
        NEUTRAL_INSTRUMENT,
        2,
        &[Take::sustain(0, MIC_0_HZ), Take::sustain(1, MIC_1_HZ)],
    )
}

struct Stereo {
    left: Vec<f32>,
    right: Vec<f32>,
}

fn render_block(instance: &mut LevainInstance, frames: usize, out: &mut Stereo) {
    let left_ptr = instance.process(frames as u32);
    let right_ptr = instance.get_right_ptr();
    // SAFETY: `process` guarantees `frames` valid f32s in each channel buffer.
    let left = unsafe { std::slice::from_raw_parts(left_ptr, frames) };
    let right = unsafe { std::slice::from_raw_parts(right_ptr, frames) };
    out.left.extend_from_slice(left);
    out.right.extend_from_slice(right);
}

fn render(instance: &mut LevainInstance, frames: usize) -> Stereo {
    let mut out = Stereo {
        left: Vec::with_capacity(frames),
        right: Vec::with_capacity(frames),
    };
    let mut remaining = frames;
    while remaining > 0 {
        let block = remaining.min(BLOCK);
        render_block(instance, block, &mut out);
        remaining -= block;
    }
    out
}

/// Play the note, let it settle, and capture one measurement window.
fn play_and_measure(instance: &mut LevainInstance) -> Stereo {
    instance.note_on(NOTE, VELOCITY);
    render(instance, SETTLE_FRAMES);
    render(instance, WINDOW)
}

/// Amplitude of the `hz` component of `signal`, from one Hann-windowed DFT
/// bin (Goertzel). The window keeps a strong tone's leakage into a bin a few
/// hundred hertz away far below the 60 dB the isolation cases demand.
fn amplitude_at(signal: &[f32], hz: f32) -> f64 {
    let n = signal.len();
    let omega = std::f64::consts::TAU * f64::from(hz) / f64::from(SAMPLE_RATE);
    let coeff = 2.0 * omega.cos();
    let (mut s1, mut s2) = (0.0_f64, 0.0_f64);
    for (index, &sample) in signal.iter().enumerate() {
        let window = 0.5 - 0.5 * (std::f64::consts::TAU * index as f64 / (n - 1) as f64).cos();
        let s0 = f64::from(sample) * window + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    // A Hann window's coherent gain is one half.
    4.0 * power.max(0.0).sqrt() / n as f64
}

fn db(ratio: f64) -> f64 {
    20.0 * ratio.log10()
}

/// `absent_hz` sits at least 60 dB below `present_hz`, which is audible.
fn assert_only(signal: &[f32], present_hz: f32, absent_hz: f32, context: &str) {
    let present = amplitude_at(signal, present_hz);
    let absent = amplitude_at(signal, absent_hz);
    assert!(
        present > 0.05,
        "{context}: the {present_hz} Hz position is inaudible (amplitude {present})",
    );
    assert!(
        db(present / absent) >= 60.0,
        "{context}: {absent_hz} Hz is only {:.1} dB below {present_hz} Hz ({absent} vs {present})",
        db(present / absent),
    );
}

/// Both tones sound, at comparable level (within 6 dB of each other).
fn assert_both(signal: &[f32], first_hz: f32, second_hz: f32, context: &str) {
    let first = amplitude_at(signal, first_hz);
    let second = amplitude_at(signal, second_hz);
    assert!(
        first > 0.01 && second > 0.01,
        "{context}: expected {first_hz} Hz and {second_hz} Hz both audible, got amplitudes \
         {first} and {second}",
    );
    assert!(
        db(first / second).abs() <= 6.0,
        "{context}: {first_hz} Hz and {second_hz} Hz differ by {:.1} dB",
        db(first / second),
    );
}

fn max_abs_diff(a: &[f32], b: &[f32]) -> f32 {
    assert_eq!(a.len(), b.len());
    a.iter()
        .zip(b)
        .fold(0.0_f32, |acc, (x, y)| acc.max((x - y).abs()))
}

fn peak(signal: &[f32]) -> f32 {
    signal
        .iter()
        .fold(0.0_f32, |acc, sample| acc.max(sample.abs()))
}

/// A tone transposed from `NOTE` to `note`.
fn transposed(hz: f32, note: u8) -> f32 {
    hz * ((f32::from(note) - f32::from(NOTE)) / 12.0).exp2()
}

#[test]
fn the_default_plays_every_loaded_mic_layer() {
    let mut instance = two_mic_instance();

    let out = play_and_measure(&mut instance);

    assert_both(&out.left, MIC_0_HZ, MIC_1_HZ, "left, defaults");
    assert_both(&out.right, MIC_0_HZ, MIC_1_HZ, "right, defaults");
}

#[test]
fn panning_each_mic_hard_to_one_side_keeps_each_position_on_its_own_side() {
    let mut instance = two_mic_instance();
    instance.set_param("mic_0_pan", -1.0);
    instance.set_param("mic_1_pan", 1.0);

    let out = play_and_measure(&mut instance);

    assert_only(&out.left, MIC_0_HZ, MIC_1_HZ, "left, mic 0 panned left");
    assert_only(&out.right, MIC_1_HZ, MIC_0_HZ, "right, mic 1 panned right");
}

#[test]
fn both_centred_mics_sum_the_two_solo_renders() {
    // A bowed string with the Tone macro engaged, so each position's realism
    // and tone stages carry state and noise of their own.
    let render_with = |disabled: Option<&str>| {
        let mut instance = instance_with(
            BOWED_INSTRUMENT,
            2,
            &[Take::sustain(0, MIC_0_HZ), Take::sustain(1, MIC_1_HZ)],
        );
        instance.set_param("tone", 0.8);
        if let Some(param) = disabled {
            instance.set_param(param, 0.0);
        }
        play_and_measure(&mut instance)
    };

    let both = render_with(None);
    let mic_0_only = render_with(Some("mic_1_enabled"));
    let mic_1_only = render_with(Some("mic_0_enabled"));

    let summed = |a: &[f32], b: &[f32]| a.iter().zip(b).map(|(x, y)| x + y).collect::<Vec<_>>();
    let left_diff = max_abs_diff(&both.left, &summed(&mic_0_only.left, &mic_1_only.left));
    let right_diff = max_abs_diff(&both.right, &summed(&mic_0_only.right, &mic_1_only.right));
    assert!(
        left_diff <= 1e-5 && right_diff <= 1e-5,
        "the two-mic render differs from the sum of its solo renders by {left_diff} (left) and \
         {right_diff} (right)",
    );
    assert!(
        peak(&mic_1_only.left) > 0.05,
        "the mic-1 solo render is silent"
    );
}

#[test]
fn disabling_mic_1_leaves_only_mic_0s_layer() {
    let mut instance = two_mic_instance();
    instance.set_param("mic_1_enabled", 0.0);

    let out = play_and_measure(&mut instance);

    assert_only(&out.left, MIC_0_HZ, MIC_1_HZ, "mic 1 disabled");
}

#[test]
fn silencing_mic_1s_volume_leaves_only_mic_0s_layer() {
    let mut instance = two_mic_instance();
    instance.set_param("mic_1_volume", 0.0);

    let out = play_and_measure(&mut instance);

    assert_only(&out.left, MIC_0_HZ, MIC_1_HZ, "mic 1 at volume 0");
}

#[test]
fn disabling_mic_0_leaves_only_mic_1s_layer() {
    let mut instance = two_mic_instance();
    instance.set_param("mic_0_enabled", 0.0);

    let out = play_and_measure(&mut instance);

    assert_only(&out.left, MIC_1_HZ, MIC_0_HZ, "mic 0 disabled");
}

#[test]
fn disabling_every_layer_silences_the_note() {
    // The voice still exists — its positions have zones — so the assertion
    // has to be on the rendered signal, not the voice count.
    let mut instance = two_mic_instance();
    instance.set_param("mic_0_enabled", 0.0);
    instance.set_param("mic_1_enabled", 0.0);

    let out = play_and_measure(&mut instance);

    assert!(instance.active_voices() > 0, "the note created no voice");
    assert!(
        peak(&out.left) < 1e-6 && peak(&out.right) < 1e-6,
        "a note with no enabled mic layer rendered signal"
    );
}

#[test]
fn a_bank_authored_on_mic_1_only_sounds_with_default_settings() {
    let mut instance = instance_with(NEUTRAL_INSTRUMENT, 2, &[Take::sustain(1, MIC_1_HZ)]);

    let out = play_and_measure(&mut instance);

    assert!(instance.active_voices() > 0, "the note created no voice");
    assert!(
        amplitude_at(&out.left, MIC_1_HZ) > 0.05,
        "mic 1's zone is inaudible when mic 0 declares none",
    );
}

#[test]
fn a_two_mic_bank_with_only_mic_0_enabled_renders_exactly_the_one_mic_bank() {
    let perform = |instance: &mut LevainInstance| {
        instance.set_param("tone", 0.8);
        let mut out = Stereo {
            left: Vec::new(),
            right: Vec::new(),
        };
        let mut take = |instance: &mut LevainInstance, frames: usize| {
            let part = render(instance, frames);
            out.left.extend(part.left);
            out.right.extend(part.right);
        };
        instance.note_on(NOTE, VELOCITY);
        take(instance, 2_400);
        // A slur under the held note, then a chord, then releases.
        instance.note_on(NOTE + 2, VELOCITY);
        take(instance, 4_800);
        instance.note_off(NOTE);
        instance.note_off(NOTE + 2);
        instance.note_on(NOTE - 5, 80);
        instance.note_on(NOTE - 2, 90);
        take(instance, 4_800);
        instance.handle_cc(1, 100);
        take(instance, 2_400);
        instance.note_off(NOTE - 5);
        instance.note_off(NOTE - 2);
        take(instance, 9_600);
        out
    };

    let mut one_mic = instance_with(BOWED_INSTRUMENT, 1, &[Take::sustain(0, MIC_0_HZ)]);
    let mut two_mic = LevainInstance::new(SAMPLE_RATE, 8);
    two_mic.set_param("mic_1_enabled", 0.0);
    load(
        &mut two_mic,
        BOWED_INSTRUMENT,
        2,
        &[Take::sustain(0, MIC_0_HZ), Take::sustain(1, MIC_1_HZ)],
    );

    let reference = perform(&mut one_mic);
    let mixed = perform(&mut two_mic);

    assert!(peak(&reference.left) > 0.05, "the one-mic render is silent");
    assert_eq!(
        max_abs_diff(&reference.left, &mixed.left),
        0.0,
        "left channel differs from the one-mic bank",
    );
    assert_eq!(
        max_abs_diff(&reference.right, &mixed.right),
        0.0,
        "right channel differs from the one-mic bank",
    );
}

#[test]
fn a_mic_volume_sent_before_the_bank_loads_survives_its_commit() {
    // Hosts send position settings before loading the bank, while the engine
    // still has only its unloaded single position.
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.set_param("mic_1_volume", 0.0);
    load(
        &mut instance,
        NEUTRAL_INSTRUMENT,
        2,
        &[Take::sustain(0, MIC_0_HZ), Take::sustain(1, MIC_1_HZ)],
    );

    let out = play_and_measure(&mut instance);

    assert_only(
        &out.left,
        MIC_0_HZ,
        MIC_1_HZ,
        "mic 1 volume sent before load",
    );
}

#[test]
fn mic_pans_sent_before_the_bank_loads_survive_its_commit() {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.set_param("mic_1_pan", -1.0);
    instance.set_param("mic_0_pan", 1.0);
    instance.begin_sample_bank(NEUTRAL_INSTRUMENT);
    stage_takes(
        &mut instance,
        &[Take::sustain(0, MIC_0_HZ), Take::sustain(1, MIC_1_HZ)],
    );
    commit(&mut instance, 2);

    let out = play_and_measure(&mut instance);

    assert_only(&out.left, MIC_1_HZ, MIC_0_HZ, "left, pans sent before load");
    assert_only(
        &out.right,
        MIC_0_HZ,
        MIC_1_HZ,
        "right, pans sent before load",
    );
}

#[test]
fn switching_mic_1_on_mid_note_brings_in_the_held_note_phase_aligned() {
    // Mic 1 alone on the right channel, so the right channel is mic 1.
    let panned = |mic_1_enabled: bool| {
        let mut instance = two_mic_instance();
        instance.set_param("mic_0_pan", -1.0);
        instance.set_param("mic_1_pan", 1.0);
        if !mic_1_enabled {
            instance.set_param("mic_1_enabled", 0.0);
        }
        instance
    };
    // An odd frame count, so the held note is mid-cycle when mic 1 comes on.
    let held_frames = 7_331;

    let mut reference = panned(true);
    reference.note_on(NOTE, VELOCITY);
    render(&mut reference, held_frames);
    let expected = render(&mut reference, BLOCK);

    let mut switched = panned(false);
    switched.note_on(NOTE, VELOCITY);
    let before = render(&mut switched, held_frames);
    assert!(peak(&before.right) < 1e-6, "mic 1 sounded while disabled");
    switched.set_param("mic_1_enabled", 1.0);
    let after = render(&mut switched, BLOCK);

    assert_eq!(
        switched.active_voices(),
        1,
        "enabling a mic started a new voice"
    );
    assert!(
        peak(&after.right) > 0.05,
        "mic 1 is still silent one block after being switched on",
    );
    let drift = max_abs_diff(&expected.right, &after.right);
    assert!(
        drift <= 1e-6,
        "mic 1 came in {drift} away from where the held note's mic-1 layer is",
    );
}

#[test]
fn a_synthetic_glide_carries_every_mic_layer_to_the_new_note() {
    let mut instance = two_mic_instance();
    instance.note_on(NOTE, VELOCITY);
    render(&mut instance, SETTLE_FRAMES);

    // No transition recording is registered, so a slur under the held note
    // glides the sounding voice onto the new note's zones.
    let target = NOTE + 2;
    instance.note_on(target, VELOCITY);
    render(&mut instance, SETTLE_FRAMES);
    let out = render(&mut instance, WINDOW);

    assert_eq!(
        instance.active_voices(),
        1,
        "the slur started a new voice instead of gliding the held one",
    );
    assert_both(
        &out.left,
        transposed(MIC_0_HZ, target),
        transposed(MIC_1_HZ, target),
        "after a synthetic glide",
    );
}

#[test]
fn a_true_legato_transition_crosses_into_every_mic_layer() {
    const TRANSITION_HZ: f32 = 1_000.0;
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank(NEUTRAL_INSTRUMENT);
    stage_takes(
        &mut instance,
        &[Take::sustain(0, MIC_0_HZ), Take::sustain(1, MIC_1_HZ)],
    );
    let transition_id = add_sine(&mut instance, TRANSITION_HZ);
    instance.add_legato_transition(2, 0, 3, transition_id, 20.0);
    commit(&mut instance, 2);

    instance.note_on(NOTE, VELOCITY);
    render(&mut instance, SETTLE_FRAMES);
    let target = NOTE + 2;
    instance.note_on(target, VELOCITY);
    let transition = render(&mut instance, 2_048);
    assert!(
        amplitude_at(&transition.left, TRANSITION_HZ) > 0.05,
        "the slur did not play the recorded transition",
    );
    // Past the transition's crossfade and the slurred-from note's release.
    render(&mut instance, 3 * SETTLE_FRAMES);
    let out = render(&mut instance, WINDOW);

    assert_both(
        &out.left,
        transposed(MIC_0_HZ, target),
        transposed(MIC_1_HZ, target),
        "after a recorded legato transition",
    );
}

#[test]
fn a_release_trigger_sounds_on_every_mic_layer() {
    let release_0_hz = 550.0;
    let release_1_hz = 880.0;
    let mut instance = instance_with(
        NEUTRAL_INSTRUMENT,
        2,
        &[
            Take::sustain(0, MIC_0_HZ),
            Take::sustain(1, MIC_1_HZ),
            Take::release(0, release_0_hz),
            Take::release(1, release_1_hz),
        ],
    );
    instance.note_on(NOTE, VELOCITY);
    // Held long enough for the release trigger to judge itself audible.
    render(&mut instance, 48_000);

    instance.note_off(NOTE);
    let out = render(&mut instance, 4_096);

    assert_both(&out.left, release_0_hz, release_1_hz, "after note-off");
}

#[test]
fn cc1_blends_every_mic_layer_toward_its_adjacent_dynamic() {
    // Loud sustains take the note's velocity; the soft layers sit in the
    // neighbouring dynamic partition, which CC1 at its midpoint favours.
    let soft_0_hz = 500.0;
    let soft_1_hz = 800.0;
    let mut instance = instance_with(
        NEUTRAL_INSTRUMENT,
        2,
        &[
            Take::sustain(0, MIC_0_HZ).velocities(72, 127),
            Take::sustain(1, MIC_1_HZ).velocities(72, 127),
            Take::sustain(0, soft_0_hz).velocities(0, 71),
            Take::sustain(1, soft_1_hz).velocities(0, 71),
        ],
    );
    instance.handle_cc(1, 64);

    let out = play_and_measure(&mut instance);

    assert_both(&out.left, soft_0_hz, soft_1_hz, "CC1 dynamic layer");
}
