//! The host's process modes, observed through the real wrappers driving the
//! dylib `cargo test` just built — once as a `.clap` file and once as a
//! `.vst3` bundle — and asserted against exact samples.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "tests assert by unwrapping"
)]

mod support;

use clap_sys::ext::render::CLAP_RENDER_OFFLINE;
use daw_plugin_host::clap_wrapper::{ClapError, MIN_PROCESS_FRAMES};
use daw_plugin_host::vst3_wrapper::{decode_state as decode_vst3_container, format_class_id};
use daw_plugin_host::{
    AudioPlugin, ClapWrapper, HostParameterUpdate, HostedPluginRuntime, ProcessMode, Vst3Wrapper,
};
use sourdaw_harness_fx::state::{decode, RecordedState, MODE_NEVER_SET};
use sourdaw_harness_fx::{
    CLAP_HARD_REALTIME_PLUGIN_ID, CLAP_PLUGIN_ID, ECHO_FRAMES, GAIN_DEFAULT, GAIN_PARAM_ID,
    LATENCY_FRAMES, VST3_CLASS_ID,
};
use support::{InstalledPlugin, SAMPLE_RATE};
use vst3::Steinberg::int32;
use vst3::Steinberg::Vst::ProcessModes_;

const BLOCK_FRAMES: usize = 128;
/// Enough whole blocks to carry the impulse, its echo, and silence after both.
const BLOCKS: usize = (LATENCY_FRAMES + ECHO_FRAMES) / BLOCK_FRAMES + 2;
const VST3_REALTIME: int32 = ProcessModes_::kRealtime as int32;
const VST3_OFFLINE: int32 = ProcessModes_::kOffline as int32;

/// Render a unit impulse at frame zero through `BLOCKS` blocks, with
/// `updates` delivered in the first block, and return both output channels.
fn render_impulse(
    plugin: &mut impl HostedPluginRuntime,
    updates: &[HostParameterUpdate],
) -> (Vec<f32>, Vec<f32>) {
    let mut left_out = Vec::new();
    let mut right_out = Vec::new();
    for block in 0..BLOCKS {
        let mut input = [0.0f32; BLOCK_FRAMES];
        if block == 0 {
            input[0] = 1.0;
        }
        let inputs: [&[f32]; 2] = [&input, &input];
        let (mut left, mut right) = ([0.0f32; BLOCK_FRAMES], [0.0f32; BLOCK_FRAMES]);
        {
            let mut outputs: [&mut [f32]; 2] = [&mut left, &mut right];
            let block_updates = if block == 0 { updates } else { &[] };
            plugin.process_with_parameter_updates(
                &inputs,
                &mut outputs,
                BLOCK_FRAMES,
                block_updates,
            );
        }
        left_out.extend_from_slice(&left);
        right_out.extend_from_slice(&right);
    }
    (left_out, right_out)
}

/// `g` at frame `L`, `0.5 g` at frame `L + E`, and exact zero everywhere else.
fn assert_impulse_response(channel: &[f32], gain: f32) {
    for (frame, sample) in channel.iter().enumerate() {
        let expected = if frame == LATENCY_FRAMES {
            gain
        } else if frame == LATENCY_FRAMES + ECHO_FRAMES {
            0.5 * gain
        } else {
            0.0
        };
        assert_eq!(*sample, expected, "frame {frame}");
    }
}

fn clap_recorded_state(wrapper: &ClapWrapper) -> RecordedState {
    decode(&wrapper.get_state().unwrap()).expect("the chunk is the fixture's own")
}

fn vst3_recorded_state(wrapper: &Vst3Wrapper) -> RecordedState {
    let (component, _controller) = decode_vst3_container(&wrapper.get_state().unwrap()).unwrap();
    decode(&component).expect("the chunk is the fixture's own")
}

fn gain_update(value: f64) -> HostParameterUpdate {
    HostParameterUpdate {
        param_id: GAIN_PARAM_ID,
        value,
    }
}

// ── Offline ─────────────────────────────────────────────────────────────

#[test]
fn an_offline_clap_instance_renders_the_exact_impulse_response_and_reports_offline() {
    let plugin = InstalledPlugin::create("clap-offline");
    let mut wrapper = plugin.clap(CLAP_PLUGIN_ID, ProcessMode::Offline).unwrap();

    let (left, right) = render_impulse(&mut wrapper, &[]);

    assert_impulse_response(&left, GAIN_DEFAULT as f32);
    assert_eq!(left, right);
    assert_eq!(wrapper.latency_samples(), LATENCY_FRAMES as u32);
    assert_eq!(wrapper.tail_samples(), ECHO_FRAMES as u32);
    assert_eq!(
        clap_recorded_state(&wrapper).configured_mode,
        CLAP_RENDER_OFFLINE
    );
}

#[test]
fn an_offline_vst3_instance_renders_the_exact_impulse_response_and_reports_offline() {
    let plugin = InstalledPlugin::create("vst3-offline");
    let mut wrapper = plugin.vst3(ProcessMode::Offline);

    let (left, right) = render_impulse(&mut wrapper, &[]);

    assert_impulse_response(&left, GAIN_DEFAULT as f32);
    assert_eq!(left, right);
    assert_eq!(wrapper.latency_samples(), LATENCY_FRAMES as u32);
    assert_eq!(wrapper.tail_samples(), ECHO_FRAMES as u32);
    let recorded = vst3_recorded_state(&wrapper);
    assert_eq!(
        (recorded.configured_mode, recorded.last_block_mode),
        (VST3_OFFLINE, VST3_OFFLINE),
        "setupProcessing and every ProcessData must both state offline"
    );
}

// ── Realtime stays the default ──────────────────────────────────────────

#[test]
fn the_realtime_clap_constructor_never_moves_the_plugin_off_its_realtime_default() {
    let plugin = InstalledPlugin::create("clap-realtime");
    let path = plugin.clap_path.to_str().unwrap();
    let mut wrapper = ClapWrapper::new(path, CLAP_PLUGIN_ID, SAMPLE_RATE).unwrap();

    render_impulse(&mut wrapper, &[]);

    assert_eq!(
        clap_recorded_state(&wrapper).configured_mode,
        MODE_NEVER_SET,
        "a realtime instance is left on CLAP's realtime default, never told a mode"
    );
}

#[test]
fn the_realtime_vst3_constructor_states_realtime_to_setup_and_every_block() {
    let plugin = InstalledPlugin::create("vst3-realtime");
    let mut wrapper = Vst3Wrapper::new(
        &plugin.vst3_bundle,
        &format_class_id(&VST3_CLASS_ID),
        SAMPLE_RATE,
    )
    .unwrap();

    render_impulse(&mut wrapper, &[]);

    let recorded = vst3_recorded_state(&wrapper);
    assert_eq!(
        (recorded.configured_mode, recorded.last_block_mode),
        (VST3_REALTIME, VST3_REALTIME)
    );
}

// ── State round trip into an offline instance ───────────────────────────

#[test]
fn a_clap_gain_saved_from_one_instance_drives_a_fresh_offline_instance() {
    let plugin = InstalledPlugin::create("clap-state");
    let mut source = plugin.clap(CLAP_PLUGIN_ID, ProcessMode::Realtime).unwrap();
    render_impulse(&mut source, &[gain_update(0.25)]);
    let saved = source.get_state().unwrap();

    let mut target = plugin.clap(CLAP_PLUGIN_ID, ProcessMode::Offline).unwrap();
    target.set_state(&saved).unwrap();
    let (left, _) = render_impulse(&mut target, &[]);

    assert_impulse_response(&left, 0.25);
}

#[test]
fn a_vst3_gain_saved_from_one_instance_drives_a_fresh_offline_instance() {
    let plugin = InstalledPlugin::create("vst3-state");
    let mut source = plugin.vst3(ProcessMode::Realtime);
    render_impulse(&mut source, &[gain_update(0.25)]);
    let saved = source.get_state().unwrap();

    let mut target = plugin.vst3(ProcessMode::Offline);
    target.set_state(&saved).unwrap();
    let (left, _) = render_impulse(&mut target, &[]);

    assert_impulse_response(&left, 0.25);
}

// ── A plugin that cannot render offline ─────────────────────────────────

#[test]
fn a_clap_plugin_with_a_hard_realtime_requirement_is_refused_offline_by_name() {
    let plugin = InstalledPlugin::create("clap-hard-realtime");

    let error = plugin
        .clap(CLAP_HARD_REALTIME_PLUGIN_ID, ProcessMode::Offline)
        .err()
        .expect("an offline instance of a hard-realtime plugin must be refused");

    assert!(
        matches!(&error, ClapError::RequiresRealtime { name } if name == "Sourdaw Harness Fx Hard Realtime"),
        "{error}"
    );
    assert_eq!(
        error.to_string(),
        "[CLAP] 'Sourdaw Harness Fx Hard Realtime' requires real-time rendering and cannot \
         render offline"
    );
    assert!(plugin
        .clap(CLAP_HARD_REALTIME_PLUGIN_ID, ProcessMode::Realtime)
        .is_ok());
}

// ── The block sizes activation promised ─────────────────────────────────

/// Render one block of silence of `frames` frames.
fn render_silence(plugin: &mut impl HostedPluginRuntime, frames: usize) {
    let input = vec![0.0f32; frames];
    let inputs: [&[f32]; 2] = [&input, &input];
    let (mut left, mut right) = (vec![0.0f32; frames], vec![0.0f32; frames]);
    let mut outputs: [&mut [f32]; 2] = [&mut left, &mut right];
    plugin.process_with_parameter_updates(&inputs, &mut outputs, frames, &[]);
}

#[test]
fn a_short_block_after_a_long_one_is_never_below_the_minimum_activation_promised() {
    let plugin = InstalledPlugin::create("clap-min-frames");
    let mut wrapper = plugin.clap(CLAP_PLUGIN_ID, ProcessMode::Realtime).unwrap();

    // The shape a loop seam cuts a callback into: most of it, then the rest.
    render_silence(&mut wrapper, 123);
    render_silence(&mut wrapper, 5);

    let recorded = clap_recorded_state(&wrapper);
    assert_eq!(recorded.declared_min_frames, MIN_PROCESS_FRAMES);
    assert_eq!(recorded.smallest_block_frames, 5);
    assert!(
        recorded.smallest_block_frames >= recorded.declared_min_frames,
        "activate promised blocks of at least {} frames and process was handed {}",
        recorded.declared_min_frames,
        recorded.smallest_block_frames
    );
}
