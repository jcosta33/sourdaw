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

fn stage_rate_take(
    instance: &mut LevainInstance,
    zone_id: u32,
    mic: u8,
    hz: f32,
    rate: f32,
    frames: u32,
) {
    stage_rate_take_keys(instance, zone_id, mic, hz, rate, frames, 0, 127);
}

fn stage_rate_take_keys(
    instance: &mut LevainInstance,
    zone_id: u32,
    mic: u8,
    hz: f32,
    rate: f32,
    frames: u32,
    key_lo: u8,
    key_hi: u8,
) {
    let data = (0..frames)
        .map(|frame| (frame as f32 / rate * hz * std::f32::consts::TAU).sin() * 0.5)
        .collect();
    let sample_id = instance
        .add_sample(data, frames, 1, rate)
        .expect("sample adds to a uniquely-owned bank");
    instance.add_zone(
        zone_id, sample_id, SUSTAIN, NOTE, 0.0, key_lo, key_hi, 0, 127, 0, 1, mic, false, 1, 0,
        frames, 0, 0.0, 0.001, 0.1, 1.0, 0.2,
    );
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
fn synthetic_glide_preserves_elapsed_time_across_mic_sample_rates() {
    for (lead_rate, other_rate) in [(48_000.0, 24_000.0), (24_000.0, 48_000.0)] {
        let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
        instance.set_param("humanize", 0.0);
        instance.set_param("mic_0_pan", -1.0);
        instance.set_param("mic_1_pan", 1.0);
        instance.begin_sample_bank(NEUTRAL_INSTRUMENT);
        stage_rate_take(
            &mut instance,
            0,
            0,
            451.0,
            lead_rate,
            (lead_rate / 2.0) as u32,
        );
        stage_rate_take(
            &mut instance,
            1,
            1,
            451.0,
            other_rate,
            (other_rate / 2.0) as u32,
        );
        commit(&mut instance, 2);

        instance.note_on(NOTE, VELOCITY);
        render(&mut instance, 4_800);
        instance.note_on(NOTE + 2, VELOCITY);
        render(&mut instance, 1_024);
        let after = render(&mut instance, BLOCK);

        assert_eq!(instance.active_voices(), 1);
        let drift = max_abs_diff(&after.left, &after.right);
        assert!(
            drift < 0.01,
            "the same performance on {lead_rate} and {other_rate} Hz mics drifted by {drift} after the glide",
        );
    }
}

#[test]
fn humanized_mics_start_at_the_same_recorded_time_across_sample_rates() {
    for (lead_rate, other_rate) in [
        (48_000.0, 24_000.0),
        (24_000.0, 48_000.0),
        (48_000.0, 48_000.0),
    ] {
        let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
        instance.set_param("humanize", 1.0);
        instance.set_param("humanize_timing_max_ms", 0.0);
        instance.set_param("humanize_tuning_max_cents", 0.0);
        instance.set_param("humanize_vibrato_var_max", 0.0);
        instance.set_param("mic_0_pan", -1.0);
        instance.set_param("mic_1_pan", 1.0);
        instance.begin_sample_bank(NEUTRAL_INSTRUMENT);
        stage_rate_take(
            &mut instance,
            0,
            0,
            451.0,
            lead_rate,
            (lead_rate / 2.0) as u32,
        );
        stage_rate_take(
            &mut instance,
            1,
            1,
            451.0,
            other_rate,
            (other_rate / 2.0) as u32,
        );
        commit(&mut instance, 2);

        instance.note_on(NOTE, VELOCITY);
        let out = render(&mut instance, BLOCK);
        assert!(peak(&out.left) > 0.01 && peak(&out.right) > 0.01);
        let drift = max_abs_diff(&out.left, &out.right);
        assert!(
            drift < 0.01,
            "humanized {lead_rate}/{other_rate} Hz mics drifted by {drift}"
        );
    }
}

#[test]
fn a_humanized_true_transition_keeps_mics_at_the_same_recorded_time() {
    let play = |with_transition: bool| {
        let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
        instance.set_param("humanize", 1.0);
        instance.set_param("humanize_timing_max_ms", 0.0);
        instance.set_param("humanize_tuning_max_cents", 0.0);
        instance.set_param("humanize_vibrato_var_max", 0.0);
        instance.set_param("mic_0_pan", -1.0);
        instance.set_param("mic_1_pan", 1.0);
        instance.begin_sample_bank(NEUTRAL_INSTRUMENT);
        stage_rate_take(&mut instance, 0, 0, 451.0, 48_000.0, 24_000);
        stage_rate_take(&mut instance, 1, 1, 451.0, 24_000.0, 12_000);
        if with_transition {
            let transition_id = add_sine(&mut instance, 1_000.0);
            instance.add_legato_transition(2, 0, 3, transition_id, 20.0);
        }
        commit(&mut instance, 2);

        instance.note_on(NOTE, VELOCITY);
        // The legato lookup only treats a recent note as slurred.
        render(&mut instance, 512);
        instance.note_on(NOTE + 2, VELOCITY);
        let transition = render(&mut instance, 2_048);
        render(&mut instance, 3 * SETTLE_FRAMES - 2_048);
        (transition, render(&mut instance, BLOCK))
    };

    let (transition, out) = play(true);
    let (without_transition, _) = play(false);
    let transition_amplitude = amplitude_at(&transition.left, 1_000.0);
    let absent_amplitude = amplitude_at(&without_transition.left, 1_000.0);
    assert!(
        transition_amplitude > absent_amplitude * 4.0 + 0.02,
        "the recorded transition route carried {transition_amplitude} of 1 kHz against {absent_amplitude} without the transition"
    );
    assert!(peak(&out.left) > 0.01 && peak(&out.right) > 0.01);
    let drift = max_abs_diff(&out.left, &out.right);
    assert!(drift < 0.01, "humanized true transition drifted by {drift}");
}

#[test]
fn synthetic_glide_uses_the_outgoing_lead_when_the_incoming_mic_was_missing() {
    let perform = |mic_0_had_outgoing_zone: bool| {
        let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
        instance.set_param("humanize", 0.0);
        instance.set_param("mic_0_pan", -1.0);
        instance.set_param("mic_1_pan", 1.0);
        instance.begin_sample_bank(NEUTRAL_INSTRUMENT);
        if mic_0_had_outgoing_zone {
            stage_rate_take_keys(&mut instance, 0, 0, 451.0, 48_000.0, 24_000, NOTE, NOTE);
        }
        let next_id = u32::from(mic_0_had_outgoing_zone);
        stage_rate_take_keys(
            &mut instance,
            next_id,
            1,
            451.0,
            24_000.0,
            12_000,
            NOTE,
            NOTE,
        );
        stage_rate_take_keys(
            &mut instance,
            next_id + 1,
            0,
            451.0,
            48_000.0,
            24_000,
            NOTE + 2,
            NOTE + 2,
        );
        commit(&mut instance, 2);
        instance.note_on(NOTE, VELOCITY);
        render(&mut instance, 4_800);
        instance.note_on(NOTE + 2, VELOCITY);
        render(&mut instance, 4_800);
        assert_eq!(instance.active_voices(), 1);
        render(&mut instance, BLOCK).left
    };

    let expected = perform(true);
    let after = perform(false);
    let drift = max_abs_diff(&after, &expected);
    assert!(peak(&expected) > 0.05, "the incoming mic is silent");
    assert!(
        drift < 0.01,
        "the newly available mic starts {drift} away from the outgoing lead's time"
    );
}

#[test]
fn bank_commit_clears_dormant_mic_tone_history() {
    let setup = || {
        let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
        instance.set_param("humanize", 0.0);
        instance.set_param("tone", 1.0);
        instance.set_param("mic_1_pan", 1.0);
        instance
    };
    let load_one = |instance: &mut LevainInstance, mic: u8, hz: f32, frames: u32| {
        instance.begin_sample_bank(NEUTRAL_INSTRUMENT);
        stage_rate_take(instance, 0, mic, hz, SAMPLE_RATE, frames);
        commit(instance, 2);
    };

    let mut reused = setup();
    load_one(&mut reused, 1, 660.0, 7_331);
    reused.note_on(NOTE, VELOCITY);
    render(&mut reused, 7_331);
    load_one(&mut reused, 0, 440.0, 2_401);
    reused.note_on(NOTE, VELOCITY);
    render(&mut reused, 2_401);
    load_one(&mut reused, 1, 440.0, FRAME_COUNT);
    reused.note_on(NOTE, VELOCITY);
    let after = render(&mut reused, BLOCK);

    let mut fresh = setup();
    load_one(&mut fresh, 1, 440.0, FRAME_COUNT);
    fresh.note_on(NOTE, VELOCITY);
    let expected = render(&mut fresh, BLOCK);
    let drift = max_abs_diff(&after.right, &expected.right);
    assert!(
        peak(&expected.right) > 1e-4,
        "the reference mic is silent: peak={}, voices={}",
        peak(&expected.right),
        fresh.active_voices()
    );
    assert!(
        drift < 1e-6,
        "bank C inherited {drift} of bank A's mic-1 Tone history"
    );
}

#[test]
fn failed_bank_commit_keeps_the_sounding_mic_tone_history() {
    let mut baseline = LevainInstance::new(SAMPLE_RATE, 8);
    let mut pending = LevainInstance::new(SAMPLE_RATE, 8);
    for instance in [&mut baseline, &mut pending] {
        instance.set_param("humanize", 0.0);
        instance.set_param("tone", 1.0);
        load(
            instance,
            NEUTRAL_INSTRUMENT,
            2,
            &[Take::sustain(1, MIC_1_HZ)],
        );
        instance.note_on(NOTE, VELOCITY);
        render(instance, 7_331);
    }

    pending.begin_sample_bank(NEUTRAL_INSTRUMENT);
    assert!(!pending.commit_sample_bank(), "an empty bank cannot commit");
    let expected = render(&mut baseline, BLOCK);
    let after = render(&mut pending, BLOCK);
    assert!(peak(&expected.right) > 1e-4, "the sounding bank is silent");
    assert_eq!(max_abs_diff(&after.right, &expected.right), 0.0);
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

// ---------------------------------------------------------------------------
// Pitch modulation must reach the CC1 dynamic-layer streams (#4843)
// ---------------------------------------------------------------------------

/// The adjacent CC1 layer tones of the bank below. Both sit far from every
/// other rendered frequency, so one DFT bin separates the layer's bent tone
/// from its unbent one.
const SOFT_0_HZ: f32 = 500.0;
const SOFT_1_HZ: f32 = 800.0;

/// The issue's probe bank: loud primaries at 440/660 Hz with
/// velocity-adjacent CC1 layers at 500/800 Hz, CC1 at its midpoint, humanize
/// off, and the mics hard-panned so the left channel is mic 0 alone. The
/// held note takes a +12-semitone per-note bend. `vibrato_depth` 0.0 keeps
/// `update_vibrato_block` in its static-bend branch; any real depth moves it
/// into the LFO branch.
fn bent_cc1_instance(vibrato_depth: f32) -> LevainInstance {
    let mut instance = instance_with(
        NEUTRAL_INSTRUMENT,
        2,
        &[
            Take::sustain(0, MIC_0_HZ).velocities(72, 127),
            Take::sustain(1, MIC_1_HZ).velocities(72, 127),
            Take::sustain(0, SOFT_0_HZ).velocities(0, 71),
            Take::sustain(1, SOFT_1_HZ).velocities(0, 71),
        ],
    );
    instance.set_param("humanize", 0.0);
    instance.set_param("vibrato_depth", vibrato_depth);
    instance.set_param("mic_0_pan", -1.0);
    instance.set_param("mic_1_pan", 1.0);
    instance.handle_cc(1, 64);
    instance
}

/// Play the held note, bend it +12 semitones per-note, and capture one
/// measurement window past the attack.
fn play_bent_and_measure(instance: &mut LevainInstance) -> Stereo {
    instance.note_on(NOTE, VELOCITY);
    instance.note_expression(NOTE, 0, 12.0, 0.0, 0.0);
    render(instance, SETTLE_FRAMES);
    render(instance, WINDOW)
}

/// The issue's ratio probe on mic 0: the layer's bent tone at twice its
/// recorded frequency must dominate its unbent tone by at least 10x. A
/// layer that ignores the pitch modulation reads as a second, detuned
/// voice under the bent one.
fn assert_bent_layer_dominates(signal: &[f32], context: &str) {
    let bent_hz = transposed(SOFT_0_HZ, NOTE + 12);
    let bent = amplitude_at(signal, bent_hz);
    let unbent = amplitude_at(signal, SOFT_0_HZ);
    assert!(
        bent > 0.05,
        "{context}: the bent layer tone is inaudible at {bent_hz} Hz (amplitude {bent})",
    );
    assert!(
        bent >= 10.0 * unbent,
        "{context}: the unbent tone holds {unbent} against {bent} at {bent_hz} Hz — the dynamic \
         layer is not following the pitch modulation",
    );
}

#[test]
fn a_per_note_bend_carries_the_cc1_dynamic_layer_with_it() {
    let mut instance = bent_cc1_instance(0.0);

    let out = play_bent_and_measure(&mut instance);

    assert_bent_layer_dominates(&out.left, "per-note bend");
}

#[test]
fn vibrato_also_carries_the_cc1_dynamic_layer_with_it() {
    let mut instance = bent_cc1_instance(0.25);

    let out = play_bent_and_measure(&mut instance);

    // The vibrato branch must actually be running: with depth engaged, the
    // render must differ from the static-bend render above.
    let mut static_instance = bent_cc1_instance(0.0);
    let static_out = play_bent_and_measure(&mut static_instance);
    assert!(
        max_abs_diff(&out.left, &static_out.left) > 1e-4,
        "vibrato depth produced an identical render — the LFO branch never ran",
    );
    assert_bent_layer_dominates(&out.left, "vibrato branch");
}
