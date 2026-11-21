//! VST3 hosting rules observed at the plugin-facing boundary: purpose-built
//! classes of the dylib `cargo test` just built, loaded as a `.vst3` bundle
//! through the real module loader and `Vst3Wrapper`.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "tests assert by unwrapping"
)]

mod support;

use daw_plugin_host::vst3_wrapper::decode_state as decode_vst3_container;
use daw_plugin_host::{
    take_pending_process_refusal_signal, AudioPlugin, HostParameterUpdate, HostedPluginRuntime,
    PluginHostRequest, ProcessMode, Vst3Wrapper,
};
use sourdaw_harness_fx::state::decode;
use sourdaw_harness_fx::{
    ADDED_PARAM_ID, ADD_PARAMETER_PARAM_ID, GAIN_DEFAULT, GAIN_PARAM_ID, LATENCY_FRAMES,
    LEVEL_PARAM_ID, LOG_ACTIVATE, LOG_BUS_ARRANGEMENTS, LOG_BUS_INFO, LOG_DEACTIVATE,
    LOG_SETUP_PROCESSING, RESTART_FOREVER_PARAM_ID, SURROUND_OUTPUT_PARAM_ID,
    VST3_MONO_COPY_CLASS_ID, VST3_PROCESSOR_TRUTH_CLASS_ID, VST3_PROCESSOR_TRUTH_FAILING_CLASS_ID,
    VST3_PROCESSOR_TRUTH_LATE_START_CLASS_ID, VST3_RECONFIGURING_CLASS_ID,
    VST3_RECONFIGURING_INSTRUMENT_CLASS_ID, VST3_START_REFUSED_CLASS_ID, WIDEN_OUTPUT_PARAM_ID,
};
use std::sync::{Arc, Mutex};
use support::InstalledPlugin;

const BLOCK_FRAMES: usize = 64;

/// The process-refusal hint is process-wide, so every test here that raises
/// or reads it takes this first.
static REFUSAL_HINT: Mutex<()> = Mutex::new(());

fn refusal_hint_guard() -> std::sync::MutexGuard<'static, ()> {
    let guard = REFUSAL_HINT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    take_pending_process_refusal_signal();
    guard
}

/// A left and a right channel no sum or copy of one can pass for the other.
fn distinct_pair() -> (Vec<f32>, Vec<f32>) {
    let left = (0..BLOCK_FRAMES).map(|frame| frame as f32 / 64.0).collect();
    let right = (0..BLOCK_FRAMES)
        .map(|frame| -0.25 - frame as f32 / 128.0)
        .collect();
    (left, right)
}

/// One block of `left`/`right` through the plugin, returning both outputs.
fn process(plugin: &mut Vst3Wrapper, left: &[f32], right: &[f32]) -> (Vec<f32>, Vec<f32>) {
    let inputs: [&[f32]; 2] = [left, right];
    let (mut out_left, mut out_right) = (vec![0.0f32; BLOCK_FRAMES], vec![0.0f32; BLOCK_FRAMES]);
    {
        let mut outputs: [&mut [f32]; 2] = [&mut out_left, &mut out_right];
        plugin.process_with_parameter_updates(&inputs, &mut outputs, BLOCK_FRAMES, &[]);
    }
    (out_left, out_right)
}

fn average(left: &[f32], right: &[f32]) -> Vec<f32> {
    left.iter()
        .zip(right)
        .map(|(left, right)| 0.5 * (left + right))
        .collect()
}

// ── A mono main input on a stereo slot (#6561) ──────────────────────────

/// The mono-input copy class hears the pair's average on its one input, and
/// its mono output is fanned to both channels — so each output channel is
/// exactly what the plugin was fed.
#[test]
fn a_mono_input_hears_the_average_of_the_stereo_pair() {
    let plugin = InstalledPlugin::create("vst3-mono-downmix");
    let mut wrapper = plugin.vst3_class(&VST3_MONO_COPY_CLASS_ID, ProcessMode::Realtime);
    let silence = vec![0.0f32; BLOCK_FRAMES];
    let tone: Vec<f32> = (0..BLOCK_FRAMES)
        .map(|frame| (frame as f32 / 8.0).sin())
        .collect();
    let inverted: Vec<f32> = tone.iter().map(|sample| -sample).collect();

    for (case, left, right) in [
        ("left only", &tone, &silence),
        ("right only", &silence, &tone),
        ("anti-phase", &tone, &inverted),
    ] {
        let (out_left, out_right) = process(&mut wrapper, left, right);

        let expected = average(left, right);
        assert_eq!(out_left, expected, "{case}: the plugin's one input");
        assert_eq!(out_right, expected, "{case}: the mono output fans to both");
    }
    let (heard, _) = process(&mut wrapper, &silence, &tone);
    assert!(
        heard.iter().any(|sample| *sample != 0.0),
        "a right-only signal must reach a mono input"
    );
}

/// A stereo input is still handed both channels apart: the reconfiguring class
/// starts stereo in, mono out, and copies its input's first channel — which
/// must be the left channel alone, not a downmix.
#[test]
fn a_stereo_input_is_handed_each_channel_unmixed() {
    let plugin = InstalledPlugin::create("vst3-stereo-unmixed");
    let mut wrapper = plugin.vst3_class(&VST3_RECONFIGURING_CLASS_ID, ProcessMode::Realtime);
    let (left, right) = distinct_pair();

    let (out_left, out_right) = process(&mut wrapper, &left, &right);

    assert_eq!(out_left, left);
    assert_eq!(out_right, left, "the mono output fans to both channels");
}

// ── Restart requests that change the component (#6563) ──────────────────

/// The reconfiguring class's lifecycle log, read through its state chunk.
fn lifecycle_log(wrapper: &Vst3Wrapper) -> Vec<u8> {
    let (component, _controller) =
        decode_vst3_container(&wrapper.get_state().expect("the probe reports its log")).unwrap();
    component
}

/// The calls a restart cycle made, in order, with the repeated bus reads
/// folded to one: deactivate, read the buses, state an arrangement, set
/// processing up, activate.
fn cycle_shape(calls: &[u8]) -> Vec<u8> {
    let mut shape: Vec<u8> = Vec::new();
    for call in calls {
        if shape.last() != Some(call) {
            shape.push(*call);
        }
    }
    shape
}

fn wrapper_recording_requests(
    plugin: &InstalledPlugin,
) -> (Vst3Wrapper, Arc<Mutex<Vec<PluginHostRequest>>>) {
    let wrapper = plugin.vst3_class(&VST3_RECONFIGURING_CLASS_ID, ProcessMode::Realtime);
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded = Arc::clone(&requests);
    assert!(
        wrapper.set_plugin_host_request_notifier(Box::new(move |request| {
            recorded.lock().unwrap().push(request);
        }))
    );
    (wrapper, requests)
}

/// `kIoChanged` after the output widens to stereo: the handler only records
/// it, blocks keep the geometry they had until the control path runs the
/// cycle, and the cycle deactivates, re-reads, re-negotiates and reactivates
/// in that order before the new layout carries audio.
#[test]
fn a_bus_change_is_answered_by_a_reactivation_that_adopts_the_new_layout() {
    let plugin = InstalledPlugin::create("vst3-io-changed");
    let (mut wrapper, requests) = wrapper_recording_requests(&plugin);
    let (left, right) = distinct_pair();

    wrapper.set_parameter(WIDEN_OUTPUT_PARAM_ID, 1.0);
    let before_cycle = lifecycle_log(&wrapper);

    assert_eq!(
        *requests.lock().unwrap(),
        [PluginHostRequest::ComponentRestart]
    );
    assert_eq!(
        process(&mut wrapper, &left, &right),
        (left.clone(), left.clone()),
        "until the cycle runs, blocks use the layout the plugin agreed at activation"
    );
    assert_eq!(
        lifecycle_log(&wrapper),
        before_cycle,
        "neither the handler nor a block runs any part of the cycle"
    );

    assert_eq!(wrapper.apply_component_restart().ok(), Some(true));

    let log = lifecycle_log(&wrapper);
    assert_eq!(
        cycle_shape(&log[before_cycle.len()..]),
        [
            LOG_DEACTIVATE,
            LOG_BUS_INFO,
            LOG_BUS_ARRANGEMENTS,
            LOG_BUS_INFO,
            LOG_SETUP_PROCESSING,
            LOG_ACTIVATE
        ]
    );
    assert_eq!(
        process(&mut wrapper, &left, &right),
        (left, right),
        "the stereo output the plugin moved to reaches both channels"
    );
    assert_eq!(
        wrapper.apply_component_restart().ok(),
        Some(false),
        "one request, one cycle"
    );
}

/// `kReloadComponent` after the plugin publishes another parameter: the same
/// cycle runs, and the parameter list is asked to be read again.
#[test]
fn a_reload_reactivates_and_asks_for_a_parameter_rescan() {
    let plugin = InstalledPlugin::create("vst3-reload");
    let (mut wrapper, requests) = wrapper_recording_requests(&plugin);

    wrapper.set_parameter(ADD_PARAMETER_PARAM_ID, 1.0);
    let before_cycle = lifecycle_log(&wrapper);
    assert!(
        !wrapper.take_parameters_rescan(),
        "the rescan follows the cycle"
    );

    assert_eq!(wrapper.apply_component_restart().ok(), Some(true));

    let log = lifecycle_log(&wrapper);
    let shape = cycle_shape(&log[before_cycle.len()..]);
    assert_eq!(shape.first(), Some(&LOG_DEACTIVATE));
    assert_eq!(shape.last(), Some(&LOG_ACTIVATE));
    assert_eq!(
        *requests.lock().unwrap(),
        [
            PluginHostRequest::ComponentRestart,
            PluginHostRequest::ParametersRescan
        ]
    );
    assert!(wrapper.take_parameters_rescan());
    assert!(wrapper
        .get_parameters()
        .iter()
        .any(|parameter| parameter.id == ADDED_PARAM_ID));
}

/// A six-channel output no stereo slot can carry is refused by name, and the
/// slot passes its effect's dry signal rather than running on the two-channel
/// geometry it had before.
#[test]
fn a_bus_change_the_host_cannot_route_takes_the_slot_out_of_service() {
    let _hint = refusal_hint_guard();
    let plugin = InstalledPlugin::create("vst3-io-unroutable");
    let (mut wrapper, _requests) = wrapper_recording_requests(&plugin);
    let (left, right) = distinct_pair();

    wrapper.set_parameter(SURROUND_OUTPUT_PARAM_ID, 1.0);
    let refusal = wrapper
        .apply_component_restart()
        .expect_err("six output channels cannot be routed")
        .to_string();
    assert!(
        take_pending_process_refusal_signal(),
        "the refusal wakes the control path's failure reporter"
    );

    assert!(
        refusal.contains("Sourdaw Harness Fx Reconfiguring")
            && refusal.contains("main output bus runs 6 channels"),
        "{refusal}"
    );
    assert!(!wrapper.is_activated());
    assert!(wrapper.has_passed_a_block_unprocessed());
    assert_eq!(
        process(&mut wrapper, &left, &right),
        (left, right),
        "an effect out of service passes its dry input"
    );

    assert_eq!(wrapper.reactivate_for_latency().ok(), Some(0));
    assert!(
        !wrapper.is_activated(),
        "a latency change does not bring back a layout the host refused"
    );

    let report = wrapper
        .take_layout_refusal_report()
        .expect("a standing refusal is reported");
    assert!(
        report.contains("Sourdaw Harness Fx Reconfiguring")
            && report.ends_with("its blocks pass through unprocessed"),
        "{report}"
    );
    assert_eq!(
        wrapper.take_layout_refusal_report(),
        None,
        "the refusal is reported once"
    );
}

/// The control path's reporter is what takes the refusal's one report, so a
/// slot out of service says so in the running app and only once.
#[test]
fn the_reporter_reports_a_refused_layout_once() {
    let _hint = refusal_hint_guard();
    let plugin = InstalledPlugin::create("vst3-io-unroutable-reported");
    let (mut wrapper, _requests) = wrapper_recording_requests(&plugin);

    wrapper.set_parameter(SURROUND_OUTPUT_PARAM_ID, 1.0);
    wrapper
        .apply_component_restart()
        .expect_err("six output channels cannot be routed");
    wrapper.report_plugin_observations();

    assert_eq!(
        wrapper.take_layout_refusal_report(),
        None,
        "the reporter already took the refusal's report"
    );
}

/// An engine write carried by a block the slot skips while out of service
/// waits for the processor: once a restart the host can route brings the
/// slot back, the first block the plugin is handed carries it.
#[test]
fn a_write_made_while_out_of_service_lands_once_the_slot_recovers() {
    let _hint = refusal_hint_guard();
    let plugin = InstalledPlugin::create("vst3-io-recovers");
    let (mut wrapper, _requests) = wrapper_recording_requests(&plugin);
    let (left, right) = distinct_pair();
    let (unity, _) = process(&mut wrapper, &left, &right);

    wrapper.set_parameter(SURROUND_OUTPUT_PARAM_ID, 1.0);
    wrapper
        .apply_component_restart()
        .expect_err("six output channels cannot be routed");
    let level = HostParameterUpdate {
        param_id: LEVEL_PARAM_ID,
        value: 0.5,
    };
    let inputs: [&[f32]; 2] = [&left, &right];
    let (mut skipped_left, mut skipped_right) =
        (vec![0.0f32; BLOCK_FRAMES], vec![0.0f32; BLOCK_FRAMES]);
    let mut outputs: [&mut [f32]; 2] = [&mut skipped_left, &mut skipped_right];
    wrapper.process_with_parameter_updates(&inputs, &mut outputs, BLOCK_FRAMES, &[level]);
    process(&mut wrapper, &left, &right);

    wrapper.set_parameter(SURROUND_OUTPUT_PARAM_ID, 0.0);
    assert_eq!(wrapper.apply_component_restart().ok(), Some(true));
    assert!(wrapper.is_activated());

    let halved: Vec<f32> = unity.iter().map(|sample| sample * 0.5).collect();
    let (out_left, out_right) = process(&mut wrapper, &left, &right);
    assert_eq!(
        out_left, halved,
        "the write made out of service reached the processor"
    );
    assert_eq!(out_right, halved);
}

/// The same refusal on a class the factory lists as an instrument silences
/// the slot: an instrument has no dry signal of its own, and passing what it
/// was fed would play routed audio out of a voice slot at unity.
#[test]
fn an_instrument_whose_bus_change_cannot_be_routed_falls_silent() {
    let _hint = refusal_hint_guard();
    let plugin = InstalledPlugin::create("vst3-io-unroutable-instrument");
    let mut wrapper = plugin.vst3_class(
        &VST3_RECONFIGURING_INSTRUMENT_CLASS_ID,
        ProcessMode::Realtime,
    );
    let (left, right) = distinct_pair();

    wrapper.set_parameter(SURROUND_OUTPUT_PARAM_ID, 1.0);
    wrapper
        .apply_component_restart()
        .expect_err("six output channels cannot be routed");

    let silence = vec![0.0f32; BLOCK_FRAMES];
    assert_eq!(
        process(&mut wrapper, &left, &right),
        (silence.clone(), silence),
        "an instrument out of service is silenced, never fed through"
    );
}

/// A plugin that asks for another bus restart from inside every activation
/// is chased only so far: one call runs a bounded number of cycles, drops the
/// last ask, and the next call has nothing to run.
#[test]
fn a_plugin_that_asks_for_a_restart_on_every_activation_is_cycled_a_bounded_number_of_times() {
    let plugin = InstalledPlugin::create("vst3-io-restart-forever");
    let (mut wrapper, _requests) = wrapper_recording_requests(&plugin);
    let activations = |wrapper: &Vst3Wrapper| {
        lifecycle_log(wrapper)
            .iter()
            .filter(|call| **call == LOG_ACTIVATE)
            .count()
    };

    wrapper.set_parameter(RESTART_FOREVER_PARAM_ID, 1.0);
    let before = activations(&wrapper);

    assert_eq!(wrapper.apply_component_restart().ok(), Some(true));
    assert_eq!(
        activations(&wrapper) - before,
        4,
        "one call runs the bounded number of reactivations"
    );
    assert!(wrapper.is_activated());

    assert_eq!(wrapper.apply_component_restart().ok(), Some(false));
    assert_eq!(
        activations(&wrapper) - before,
        4,
        "the dropped ask runs no cycle"
    );
}

// ── A host parameter write the plugin takes (#6592) ─────────────────────

/// A plugin whose controller refuses host writes and reads every value back
/// from its processor: a write to an instance no engine is running reaches
/// the processor at once, so the next read and the saved state both hold it.
#[test]
fn a_write_to_an_idle_instance_whose_processor_is_the_truth_lands() {
    let plugin = InstalledPlugin::create("vst3-processor-truth-write");
    let mut wrapper = plugin.vst3_class(&VST3_PROCESSOR_TRUTH_CLASS_ID, ProcessMode::Realtime);

    wrapper.set_parameter(GAIN_PARAM_ID, 0.25);

    let gain = wrapper
        .get_parameters()
        .into_iter()
        .find(|parameter| parameter.id == GAIN_PARAM_ID)
        .expect("the class publishes Gain")
        .value;
    assert_eq!(gain, 0.25);
    let (component, _controller) = decode_vst3_container(&wrapper.get_state().unwrap()).unwrap();
    assert_eq!(decode(&component).unwrap().gain, 0.25);
}

/// A write the flush delivered is taken off the queue: a preset loaded
/// afterwards keeps its own value through the next block instead of having
/// the already-delivered write played back over it.
#[test]
fn a_flushed_write_is_not_delivered_again_over_a_later_preset() {
    let plugin = InstalledPlugin::create("vst3-processor-truth-flush-settles");
    let preset = {
        let mut donor = plugin.vst3_class(&VST3_PROCESSOR_TRUTH_CLASS_ID, ProcessMode::Realtime);
        donor.set_parameter(GAIN_PARAM_ID, 0.7);
        donor.get_state().unwrap()
    };
    let mut wrapper = plugin.vst3_class(&VST3_PROCESSOR_TRUTH_CLASS_ID, ProcessMode::Realtime);

    wrapper.set_parameter(GAIN_PARAM_ID, 0.25);
    wrapper.set_state(&preset).unwrap();
    let (left, right) = distinct_pair();
    process(&mut wrapper, &left, &right);

    let (component, _controller) = decode_vst3_container(&wrapper.get_state().unwrap()).unwrap();
    assert_eq!(decode(&component).unwrap().gain, 0.7);
}

/// An engine write carried by a block whose processing start the plugin
/// refused is not lost with that block: it reaches the processor on the first
/// block the plugin does process.
#[test]
fn a_write_in_a_block_the_plugin_refused_to_start_lands_on_its_first_processed_block() {
    let plugin = InstalledPlugin::create("vst3-processor-truth-late-start");
    let mut wrapper = plugin.vst3_class(
        &VST3_PROCESSOR_TRUTH_LATE_START_CLASS_ID,
        ProcessMode::Realtime,
    );
    let (left, right) = distinct_pair();
    let gain = |wrapper: &Vst3Wrapper| {
        wrapper
            .get_parameters()
            .into_iter()
            .find(|parameter| parameter.id == GAIN_PARAM_ID)
            .expect("the class publishes Gain")
            .value
    };
    let block = |wrapper: &mut Vst3Wrapper, updates: &[HostParameterUpdate]| {
        let inputs: [&[f32]; 2] = [&left, &right];
        let (mut out_left, mut out_right) =
            (vec![0.0f32; BLOCK_FRAMES], vec![0.0f32; BLOCK_FRAMES]);
        let mut outputs: [&mut [f32]; 2] = [&mut out_left, &mut out_right];
        wrapper.process_with_parameter_updates(&inputs, &mut outputs, BLOCK_FRAMES, updates);
    };

    block(
        &mut wrapper,
        &[HostParameterUpdate {
            param_id: GAIN_PARAM_ID,
            value: 0.25,
        }],
    );
    assert_ne!(
        gain(&wrapper),
        0.25,
        "the refused block reached no processor"
    );

    block(&mut wrapper, &[]);
    assert_eq!(gain(&wrapper), 0.25);
}

/// The idle flush enters the processing state for its one call and leaves it
/// again, so the first real block starts processing normally rather than
/// asking a plugin already in that state to enter it twice.
#[test]
fn an_idle_flush_leaves_the_processing_state_it_entered() {
    let plugin = InstalledPlugin::create("vst3-idle-flush-stops");
    let (mut wrapper, _requests) = wrapper_recording_requests(&plugin);
    let (left, right) = distinct_pair();

    wrapper.set_parameter(LEVEL_PARAM_ID, 0.5);

    let halved: Vec<f32> = left.iter().map(|sample| sample * 0.5).collect();
    assert_eq!(
        process(&mut wrapper, &left, &right),
        (halved.clone(), halved),
        "the first block is processed, at the level the flush delivered"
    );
}

/// A plugin that declines to enter the processing state for the flush is not
/// handed the flush's `process` call.
#[test]
fn an_idle_flush_the_plugin_declines_to_start_calls_no_process() {
    let plugin = InstalledPlugin::create("vst3-idle-flush-declined");
    let mut wrapper = plugin.vst3_class(&VST3_START_REFUSED_CLASS_ID, ProcessMode::Realtime);

    wrapper.set_parameter(GAIN_PARAM_ID, 0.25);

    let (component, _controller) = decode_vst3_container(&wrapper.get_state().unwrap()).unwrap();
    assert_eq!(decode(&component).unwrap().gain, GAIN_DEFAULT);
}

/// A write whose flush the processor refuses stays queued for the processor's
/// next block, rather than being dropped with the failed call.
#[test]
fn a_write_whose_flush_the_processor_refuses_lands_on_the_next_block() {
    let plugin = InstalledPlugin::create("vst3-processor-truth-refused-flush");
    let mut wrapper = plugin.vst3_class(
        &VST3_PROCESSOR_TRUTH_FAILING_CLASS_ID,
        ProcessMode::Realtime,
    );
    let gain = |wrapper: &Vst3Wrapper| {
        wrapper
            .get_parameters()
            .into_iter()
            .find(|parameter| parameter.id == GAIN_PARAM_ID)
            .expect("the class publishes Gain")
            .value
    };

    // The class fails its third `process` call; each idle write is one flush.
    wrapper.set_parameter(GAIN_PARAM_ID, 0.1);
    wrapper.set_parameter(GAIN_PARAM_ID, 0.2);
    wrapper.set_parameter(GAIN_PARAM_ID, 0.25);
    assert_eq!(gain(&wrapper), 0.2, "the refused flush did not land");

    let silence = vec![0.0f32; BLOCK_FRAMES];
    process(&mut wrapper, &silence, &silence);

    assert_eq!(
        gain(&wrapper),
        0.25,
        "the held write reaches the next block"
    );
}

/// `setProcessing` answering the SDK's default `kNotImplemented` is a plugin
/// that processes, not one that refused: its blocks are rendered.
#[test]
fn a_plugin_whose_set_processing_is_not_implemented_still_processes() {
    let plugin = InstalledPlugin::create("vst3-processing-unimplemented");
    let mut wrapper = plugin.vst3_class(&VST3_PROCESSOR_TRUTH_CLASS_ID, ProcessMode::Realtime);
    let mut impulse = vec![0.0f32; BLOCK_FRAMES];
    impulse[0] = 1.0;
    let silence = vec![0.0f32; BLOCK_FRAMES];

    let (first, _) = process(&mut wrapper, &impulse, &impulse);
    let (second, _) = process(&mut wrapper, &silence, &silence);

    assert!(!wrapper.has_passed_a_block_unprocessed());
    assert_ne!(first, impulse, "a processed block is not the dry input");
    assert_eq!(
        second[LATENCY_FRAMES - BLOCK_FRAMES],
        0.5,
        "the impulse returns at the latency, at the default gain"
    );
}
