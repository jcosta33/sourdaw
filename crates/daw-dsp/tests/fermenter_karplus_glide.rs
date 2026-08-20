use daw_dsp::fermenter::FermenterInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

fn configure_karplus(instance: &mut FermenterInstance) {
    instance.set_param("engine", 3.0);
    instance.set_param("osc_level", 0.7);
    instance.set_param("ks_brightness", 0.8);
    instance.set_param("ks_damping", 0.0);
    instance.set_param("filter_mode", 0.0);
    instance.set_param("filter_keytrack", 0.0);
    instance.set_param("cutoff", 18_000.0);
    instance.set_param("resonance", 0.5);
    instance.set_param("amp_attack", 0.001);
    instance.set_param("amp_decay", 5.0);
    instance.set_param("amp_sustain", 1.0);
    instance.set_param("amp_release", 0.005);
    instance.set_param("dist_mix", 0.0);
    instance.set_param("comp_mix", 0.0);
    instance.set_param("delay_mix", 0.0);
    instance.set_param("chorus_mix", 0.0);
    instance.set_param("phaser_mix", 0.0);
    instance.set_param("reverb_mix", 0.0);
    instance.set_param("master_gain", 1.0);
    instance.set_param("portamento_mode", 0.0);
}

fn render_blocks(instance: &mut FermenterInstance, blocks: usize, output: &mut Vec<f32>) {
    for _ in 0..blocks {
        let pointer = instance.process(BLOCK as u32);
        // SAFETY: process returns the instance-owned left buffer for BLOCK frames.
        let block = unsafe { std::slice::from_raw_parts(pointer, BLOCK) };
        output.extend_from_slice(block);
    }
}

fn render_glide(source_note: u8, destination_note: u8, glide_seconds: f32) -> Vec<f32> {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 8);
    configure_karplus(&mut instance);

    instance.set_param("portamento", 0.0);
    instance.note_on(source_note, 127);
    let mut discarded = Vec::with_capacity(96 * BLOCK);
    render_blocks(&mut instance, 32, &mut discarded);
    instance.note_off(source_note);
    render_blocks(&mut instance, 64, &mut discarded);

    instance.set_param("portamento", glide_seconds);
    instance.note_on(destination_note, 127);
    let mut output = Vec::with_capacity(900 * BLOCK);
    render_blocks(&mut instance, 900, &mut output);
    output
}

fn render_first_note(note: u8, glide_seconds: f32) -> Vec<f32> {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 8);
    configure_karplus(&mut instance);
    instance.set_param("portamento", glide_seconds);
    instance.note_on(note, 127);
    let mut output = Vec::with_capacity(192 * BLOCK);
    render_blocks(&mut instance, 192, &mut output);
    output
}

fn rms(samples: &[f32]) -> f32 {
    (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
}

fn difference_rms(left: &[f32], right: &[f32]) -> f32 {
    let square_sum = left
        .iter()
        .zip(right)
        .map(|(left, right)| {
            let difference = left - right;
            difference * difference
        })
        .sum::<f32>();
    (square_sum / left.len() as f32).sqrt()
}

fn estimated_frequency(samples: &[f32], expected: f32) -> f32 {
    let min_lag = (SAMPLE_RATE / (expected * 1.2)) as usize;
    let max_lag = (SAMPLE_RATE / (expected * 0.8)) as usize;
    let mut best_lag = min_lag;
    let mut best_correlation = f32::NEG_INFINITY;

    for lag in min_lag..=max_lag {
        let mut product_sum = 0.0;
        let mut leading_energy = 0.0;
        let mut trailing_energy = 0.0;
        for index in 0..samples.len() - lag {
            let leading = samples[index];
            let trailing = samples[index + lag];
            product_sum += leading * trailing;
            leading_energy += leading * leading;
            trailing_energy += trailing * trailing;
        }
        let normalization = (leading_energy * trailing_energy).sqrt();
        if normalization <= f32::EPSILON {
            continue;
        }
        let correlation = product_sum / normalization;
        if correlation > best_correlation {
            best_correlation = correlation;
            best_lag = lag;
        }
    }

    SAMPLE_RATE / best_lag as f32
}

fn note_frequency(note: u8) -> f32 {
    440.0 * 2.0f32.powf((note as f32 - 69.0) / 12.0)
}

fn octave_distance(actual: f32, expected: f32) -> f32 {
    (actual / expected).log2().abs()
}

fn expected_glide_frequency(source: f32, destination: f32, elapsed_seconds: f32) -> f32 {
    destination + (source - destination) * (-std::f32::consts::TAU * elapsed_seconds / 2.0).exp()
}

#[test]
fn karplus_glide_changes_pitch_without_losing_the_pluck_in_either_direction() {
    for (source_note, destination_note) in [(48, 72), (84, 60)] {
        let snapped = render_glide(source_note, destination_note, 0.0);
        let gliding = render_glide(source_note, destination_note, 2.0);
        let snapped_rms = rms(&snapped);
        let gliding_rms = rms(&gliding);
        let changed_rms = difference_rms(&snapped, &gliding);
        assert!(
            snapped_rms > 0.001,
            "snapped Karplus render must be audible"
        );
        assert!(
            gliding_rms > snapped_rms * 0.1,
            "glide {source_note}->{destination_note} lost the pluck: snapped {snapped_rms}, gliding {gliding_rms}"
        );
        assert!(
            changed_rms > snapped_rms * 0.1,
            "glide {source_note}->{destination_note} remained inert: snapped {snapped_rms}, difference {changed_rms}"
        );

        let source_frequency = note_frequency(source_note);
        let destination_frequency = note_frequency(destination_note);
        let expected_early =
            expected_glide_frequency(source_frequency, destination_frequency, 0.093);
        let expected_late =
            expected_glide_frequency(source_frequency, destination_frequency, 2.127);
        let early_frequency = estimated_frequency(&gliding[2_400..6_496], expected_early);
        let late_frequency = estimated_frequency(&gliding[100_000..104_096], expected_late);
        assert!(
            octave_distance(early_frequency, expected_early) < 0.12,
            "glide {source_note}->{destination_note} began at {early_frequency} Hz, expected {expected_early} Hz"
        );
        assert!(
            octave_distance(late_frequency, expected_late) < 0.08,
            "glide {source_note}->{destination_note} missed its destination: {late_frequency} Hz"
        );
        if source_note < destination_note {
            assert!(early_frequency < late_frequency);
        } else {
            assert!(early_frequency > late_frequency);
        }
    }
}

#[test]
fn karplus_first_note_and_nonfinite_glide_preserve_the_snap_path() {
    assert!(
        render_first_note(72, 2.0) == render_first_note(72, 0.0),
        "a first note with no glide origin must use the exact snap path"
    );
    assert!(
        render_glide(48, 72, f32::NAN) == render_glide(48, 72, 0.0),
        "nonfinite portamento must use the exact snap path"
    );
}
