use daw_dsp::fermenter::FermenterInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

fn configure_karplus(instance: &mut FermenterInstance) {
    instance.set_param("engine", 3.0);
    instance.set_param("osc_level", 0.7);
    instance.set_param("ks_brightness", 0.8);
    instance.set_param("ks_damping", 0.5);
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
    }
}
