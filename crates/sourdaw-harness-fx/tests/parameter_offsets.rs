//! Where a hosted parameter write lands inside a block, observed at the
//! plugin-facing boundary: the instrument class of the dylib `cargo test` just
//! built, loaded through the real CLAP and VST3 wrappers.
//!
//! The instrument holds one note at `Gain * velocity` and applies each `Gain`
//! point on the sample its format's offset names, so every printed sample
//! says which point it was rendered under.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "tests assert by unwrapping"
)]

mod support;

use daw_plugin_host::{HostMidiEvent, HostParameterUpdate, HostedPluginRuntime, ProcessMode};
use sourdaw_harness_fx::{
    CLAP_INSTRUMENT_PLUGIN_ID, GAIN_DEFAULT, GAIN_PARAM_ID, VST3_INSTRUMENT_CLASS_ID,
};
use support::InstalledPlugin;

const BLOCK_FRAMES: usize = 256;

fn full_velocity_note_on() -> HostMidiEvent {
    HostMidiEvent {
        note: 60,
        velocity: 127,
        channel: 0,
        is_note_on: true,
        frame_offset: 0,
    }
}

fn gain_at(sample_offset: u32, value: f64) -> HostParameterUpdate {
    HostParameterUpdate {
        param_id: GAIN_PARAM_ID,
        value,
        sample_offset,
    }
}

/// One block carrying `midi` and `updates`, returning the left channel.
fn render(
    runtime: &mut impl HostedPluginRuntime,
    midi: &[HostMidiEvent],
    updates: &[HostParameterUpdate],
) -> Vec<f32> {
    let silence = vec![0.0f32; BLOCK_FRAMES];
    let inputs: [&[f32]; 2] = [&silence, &silence];
    let (mut left, mut right) = (vec![0.0f32; BLOCK_FRAMES], vec![0.0f32; BLOCK_FRAMES]);
    let mut outputs: [&mut [f32]; 2] = [&mut left, &mut right];
    runtime.process_with_midi_and_parameters(&inputs, &mut outputs, BLOCK_FRAMES, midi, updates);
    left
}

/// The level the held full-velocity note prints at, frame by frame, for gain
/// steps `(first frame, gain)` starting from the default.
fn held_note_levels(steps: &[(usize, f64)]) -> Vec<f32> {
    (0..BLOCK_FRAMES)
        .map(|frame| {
            steps
                .iter()
                .rev()
                .find(|(from, _)| *from <= frame)
                .map_or(GAIN_DEFAULT, |(_, gain)| *gain) as f32
        })
        .collect()
}

/// Two points for one parameter at distinct non-zero samples of one block
/// both reach the plugin, each on its own sample. Delivered at the block head,
/// the first would sound up to a buffer early; collapsed to one point, the
/// first would not sound at all.
fn two_points_in_one_block_land_on_their_samples(runtime: &mut impl HostedPluginRuntime) {
    let printed = render(
        runtime,
        &[full_velocity_note_on()],
        &[gain_at(10, 0.25), gain_at(200, 0.75)],
    );

    assert_eq!(printed, held_note_levels(&[(10, 0.25), (200, 0.75)]));

    let next = render(runtime, &[], &[gain_at(30, 1.0)]);
    let mut expected = vec![0.75f32; BLOCK_FRAMES];
    expected[30..].fill(1.0);
    assert_eq!(
        next, expected,
        "the next block's point is measured from that block's own head"
    );
}

#[test]
fn a_clap_plugin_receives_each_parameter_point_at_its_sample_offset() {
    let plugin = InstalledPlugin::create("offsets-clap");
    let mut wrapper = plugin
        .clap(CLAP_INSTRUMENT_PLUGIN_ID, ProcessMode::Realtime)
        .expect("the CLAP instrument class loads");
    two_points_in_one_block_land_on_their_samples(&mut wrapper);
}

#[test]
fn a_vst3_plugin_receives_each_parameter_point_at_its_sample_offset() {
    let plugin = InstalledPlugin::create("offsets-vst3");
    let mut wrapper = plugin.vst3_class(&VST3_INSTRUMENT_CLASS_ID, ProcessMode::Realtime);
    two_points_in_one_block_land_on_their_samples(&mut wrapper);
}
