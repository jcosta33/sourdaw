//! Push path for CLAP runtime latency changes (PH-4).
//!
//! A hosted plugin announces a latency change by calling
//! `clap_host_latency.changed()` or `clap_host.request_restart()`. Those
//! callbacks run on the plugin's own thread and must not deactivate the plugin
//! re-entrantly, so they cannot do the work themselves — they only wake this
//! watcher.
//!
//! The two asks wake it differently, because CLAP annotates their threads
//! differently. `changed()` is `[main-thread]`, so its callback fires the
//! channel wake, which allocates. `request_restart()` is `[thread-safe]` — a
//! plugin may call it from inside `process()` — so its callback raises a
//! wait-free hint and records only the instance's own dirty flag; sending on
//! the channel from there was the #3745 allocation. This thread services both:
//! the channel through `recv`, and the hint by an idle-interval sweep that
//! visits every engine-owned instance and lets each answer whether it was the
//! one that flagged.
//!
//! The watcher is a dedicated non-RT thread that claims the instance through the
//! `SharedHostedPlugin` control seam and lends the deactivate / reactivate /
//! re-query to the shell's UI thread, emits `plugin-latency-changed` to the
//! webview and aims the graph's compensation at the new figure. The restart
//! crosses because both formats bind it there: CLAP marks `activate` and
//! `deactivate` `[main-thread]`, and VST3 binds `setActive` to the UI thread.
//! The claim stays on the watcher, the rule `host/ui_thread.rs` keeps the carry
//! acyclic by. With no UI thread registered the restart is refused and reported,
//! never run here and never parked.

use crate::events::{EventSink, EventSinkExt};
use crate::host::native_bridge::{LatencyChange, PluginControlError, SharedHostedPlugin};
use crate::host::plugin_host_requests::registered_ui_thread;
use crate::host::ui_thread::{lend_on_ui_thread, UiThread, UiThreadError};
use crate::host::{all_engine_runtimes, retry_unreached_instance, runtime_for_instance};
use crate::state::EnginePluginInstanceData;
use daw_engine::EngineHandle;
use daw_plugin_host::HostedRuntime;
use daw_plugin_host::{take_pending_latency_requery_signal, PluginError};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Wire event name. The TS listener mirrors this string verbatim — never rename.
pub const PLUGIN_LATENCY_CHANGED_EVENT: &str = "plugin-latency-changed";

/// How long a latency re-query may wait for the RT path to release the plugin.
/// The visit first waits up to the control gate deadline
/// (`CONTROL_GATE_DEADLINE` in `native_bridge`), then up to this long for the
/// RT seam.
const CONTROL_TIMEOUT: Duration = Duration::from_secs(2);

/// How long a hint-driven sweep's visit may hold one instance. Sized for the
/// audio thread holding the seam for the length of a block, not for a plugin
/// command of unbounded duration — the same reasoning as the editor-resize and
/// flush legs of the drain tick: the sweep walks every instance, so one
/// instance mid-`open_gui` must not hold it. An instance this could not get
/// into raises the hint again for the next sweep instead.
const SWEEP_CONTROL_TIMEOUT: Duration = Duration::from_millis(50);

/// How long the watcher waits on its channel before checking the restart hint.
/// The channel wake answers instantly whatever this is, so the interval bounds
/// only how long a `[thread-safe]` restart may wait for its re-query — a
/// plugin that asked to restart is owed a latency correction, not a deadline.
const IDLE_HINT_POLL: Duration = Duration::from_millis(100);

/// Why a latency restart lent to the UI thread did not answer with a latency.
#[derive(Debug)]
enum UiRequeryError {
    /// No UI thread is registered, so the restart was not run anywhere.
    NoUiThread,
    /// The UI thread hop did not run the restart or did not answer.
    UiThread(UiThreadError),
    /// The plugin's own restart or re-query failed.
    Plugin(PluginError),
}

impl std::fmt::Display for UiRequeryError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoUiThread => {
                formatter.write_str("no UI thread is registered to run its latency restart on")
            }
            Self::UiThread(error) => error.fmt(formatter),
            Self::Plugin(error) => error.fmt(formatter),
        }
    }
}

/// Payload of `plugin-latency-changed`. snake_case on the wire, matching the
/// other plugin DTOs (`PluginInstance`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginLatencyChanged {
    pub instance_id: String,
    /// Latency in milliseconds, converted host-side at the sample rate the plugin
    /// was activated with. The webview runs its `AudioContext` on a different
    /// clock and cannot convert a sample count correctly, so samples never cross
    /// this boundary.
    pub latency_ms: f64,
}

/// Set once, when the watcher thread starts. `None` until then.
static LATENCY_CHANGE_SENDER: OnceLock<Sender<String>> = OnceLock::new();

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;
type Engine = Arc<Mutex<Option<EngineHandle>>>;

/// What one wake owes the graph: the effect whose delay compensation is now
/// wrong, and the latency to aim it at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LatencyCompensation {
    pub effect_id: usize,
    pub latency_frames: usize,
}

/// Wake the watcher for `instance_id`.
///
/// Called from the CLAP host callback thread. Never blocks (the channel is
/// unbounded) and is a no-op before the watcher starts, so a plugin loaded in a
/// headless/test build simply flags its dirty bit and nothing else happens.
pub fn notify_latency_change(instance_id: &str) {
    if let Some(sender) = LATENCY_CHANGE_SENDER.get() {
        let _ = sender.send(instance_id.to_string());
    }
}

/// Decide what one wake should emit.
///
/// Split out from the thread body so the emit rule is testable without a live
/// plugin or an event sink: only a real change emits; an unchanged poll and a
/// failed re-query emit nothing (a failure must not publish a fabricated
/// latency, which would corrupt compensation on every track using the plugin).
pub fn latency_change_payload<E: std::fmt::Display>(
    instance_id: &str,
    refreshed: &Result<Option<LatencyChange>, E>,
) -> Option<PluginLatencyChanged> {
    match refreshed {
        Ok(Some(change)) => Some(PluginLatencyChanged {
            instance_id: instance_id.to_string(),
            latency_ms: change.latency_ms,
        }),
        Ok(None) => None,
        Err(error) => {
            eprintln!(
                "[Plugin] latency re-query failed for instance {}: {}",
                instance_id, error
            );
            None
        }
    }
}

/// Decide what one wake should compensate.
///
/// The same three-way rule the event follows, plus the engine's own condition:
/// an instance the graph does not hold has no effect to aim, so it compensates
/// nothing rather than addressing an id the effect table never took. Silent on
/// failure because [`latency_change_payload`] already reported that poll —
/// one failed re-query is one diagnostic.
pub fn latency_compensation<E>(
    engine_plugin_id: Option<usize>,
    refreshed: &Result<Option<LatencyChange>, E>,
) -> Option<LatencyCompensation> {
    let Ok(Some(change)) = refreshed else {
        return None;
    };
    Some(LatencyCompensation {
        effect_id: engine_plugin_id?,
        latency_frames: change.latency_frames,
    })
}

/// The instance's effect id, re-read after the poll rather than carried across
/// it: the control visit waits up to [`CONTROL_TIMEOUT`], and an instance
/// unloaded inside that window must not have a retired effect compensated.
fn engine_plugin_id(engine_plugins: &EnginePlugins, instance_id: &str) -> Option<usize> {
    let guard = engine_plugins.lock().ok()?;
    guard
        .get(instance_id)
        .map(|instance| instance.engine_plugin_id)
}

/// Aim the graph's dry-delay line for one effect at its new latency.
///
/// Failures are reported and not retried: the instance stays registered and
/// sounding, mixed at its old compensation until its next latency change. A
/// worse mix rather than a broken one.
fn publish_compensation(engine: &Engine, instance_id: &str, compensation: LatencyCompensation) {
    let mut guard = match engine.lock() {
        Ok(guard) => guard,
        Err(error) => {
            eprintln!("[Plugin] latency watcher failed to lock the engine: {error}");
            return;
        }
    };
    // No engine yet means no graph holds this effect: the activation path
    // publishes the latency when one is built.
    let Some(engine) = guard.as_mut() else {
        return;
    };
    if let Err(error) =
        engine.set_effect_latency(compensation.effect_id, compensation.latency_frames)
    {
        eprintln!("[Plugin] failed to compensate instance {instance_id}: {error}");
    }
}

/// Run the latency restart and re-query of `plugin` on `ui`, and report what it
/// answered. The caller holds the instance's control claim on its own thread;
/// only the plugin call crosses, so the UI thread never waits on a gate.
fn requery_on_ui_thread(
    ui: &dyn UiThread,
    plugin: &mut HostedRuntime,
) -> Result<Option<LatencyChange>, UiRequeryError> {
    lend_on_ui_thread(ui, plugin, SharedHostedPlugin::refresh_latency_change)
        .map_err(UiRequeryError::UiThread)?
        .map_err(UiRequeryError::Plugin)
}

/// Re-query one woken instance, and report what it answered.
///
/// The channel wake's body: the poll deactivates and reactivates on the UI
/// thread under the watcher's control claim, a real change becomes the `plugin-latency-changed` event, and
/// the graph's compensation is aimed at the fresh figure. The event precedes
/// the compensation because the frontend's own latency read is what a user
/// waits on, and the graph command is a push onto a ring the audio thread
/// drains on its own schedule anyway.
///
/// With no UI thread the restart is refused rather than run on this thread: the
/// refusal is reported like any failed re-query, the instance's flag stays
/// standing, and nothing is queued to try again.
fn serve_channel_wake(
    instance_id: &str,
    runtime: &SharedHostedPlugin,
    ui: Option<&dyn UiThread>,
    engine_plugins: &EnginePlugins,
    engine: &Engine,
    events: &dyn EventSink,
) {
    let refreshed = match ui {
        Some(ui) => {
            runtime.with_control(CONTROL_TIMEOUT, |plugin| requery_on_ui_thread(ui, plugin))
        }
        None => Err(PluginControlError::Operation(UiRequeryError::NoUiThread)),
    };
    if let Some(payload) = latency_change_payload(instance_id, &refreshed) {
        events.emit(PLUGIN_LATENCY_CHANGED_EVENT, payload);
    }
    let compensation =
        latency_compensation(engine_plugin_id(engine_plugins, instance_id), &refreshed);
    if let Some(compensation) = compensation {
        publish_compensation(engine, instance_id, compensation);
    }
}

/// Sweep every engine-owned instance for a restart a `[thread-safe]` callback
/// recorded.
///
/// The hint names no instance — it cannot, because `request_restart` may be
/// raised from the audio thread where copying an id would allocate — so this
/// visits every engine-owned instance and lets each answer for itself: each
/// visit polls that instance through its bounded slice of the seam, the flag
/// is read-and-clear, and an instance with nothing flagged answers `None` and
/// costs one short try. A visit that could not get into raises the hint again
/// for the next sweep, only while the instance still accepts public control —
/// the same retry rule the drain tick's own hint legs follow. The event and
/// the compensation are the channel wake's own, through the same payload and
/// compensation rules, so one ask cannot be answered two ways.
///
/// With no UI thread the sweep is refused and reported once, and the hint is
/// not raised again: no later sweep could do better, and re-raising would spin
/// the watcher on an ask it can never carry.
fn service_pending_restarts(
    ui: Option<&dyn UiThread>,
    engine_plugins: &EnginePlugins,
    engine: &Engine,
    events: &dyn EventSink,
) {
    let Some(ui) = ui else {
        eprintln!(
            "[Plugin] a plugin asked for a latency restart, but {}; \
             it is not carried until the plugin asks again",
            UiRequeryError::NoUiThread
        );
        return;
    };
    for (instance_id, runtime) in all_engine_runtimes(engine_plugins, "latency requery") {
        // The hint names no instance, so most visits find nothing flagged; only
        // a flagged one is worth holding its claim across a UI-thread hop.
        let refreshed = runtime.try_with_control(SWEEP_CONTROL_TIMEOUT, |plugin| {
            if !plugin.has_pending_latency_change() {
                return Ok(None);
            }
            requery_on_ui_thread(ui, plugin)
        });

        match &refreshed {
            Ok(_) => {
                if let Some(payload) = latency_change_payload(&instance_id, &refreshed) {
                    events.emit(PLUGIN_LATENCY_CHANGED_EVENT, payload);
                }
                let compensation = latency_compensation(
                    engine_plugin_id(engine_plugins, &instance_id),
                    &refreshed,
                );
                if let Some(compensation) = compensation {
                    publish_compensation(engine, &instance_id, compensation);
                }
            }
            Err(error) => retry_unreached_instance(
                &runtime,
                &instance_id,
                "latency requery",
                error,
                daw_plugin_host::signal_pending_latency_requery,
            ),
        }
    }
}

/// Start the watcher thread. Idempotent: a second call is ignored, so the sender
/// installed by the first `start` stays the one the host callbacks reach.
pub fn start(events: Arc<dyn EventSink>, engine_plugins: EnginePlugins, engine: Engine) {
    let (sender, receiver) = channel::<String>();
    if LATENCY_CHANGE_SENDER.set(sender).is_err() {
        return;
    }

    let spawned = std::thread::Builder::new()
        .name("clap-latency-watcher".to_string())
        .spawn(move || {
            serve_wakes_and_hints(receiver, &engine_plugins, &engine, &*events);
        });

    if let Err(error) = spawned {
        eprintln!(
            "[Plugin] failed to start the CLAP latency watcher: {}",
            error
        );
    }
}

/// The watcher thread's whole loop, split out so the wake rule is testable
/// without a live watcher thread.
///
/// A channel wake names its instance and is served directly. An idle interval
/// is the one chance the `[thread-safe]` restart path gets to be heard: its
/// hint carries no id, so the sweep visits every engine-owned instance. The
/// static sender is never dropped, so the disconnected arm never runs and the
/// loop lives for the process.
fn serve_wakes_and_hints(
    receiver: Receiver<String>,
    engine_plugins: &EnginePlugins,
    engine: &Engine,
    events: &dyn EventSink,
) {
    loop {
        match receiver.recv_timeout(IDLE_HINT_POLL) {
            Ok(instance_id) => {
                let Some(runtime) = runtime_for_instance(engine_plugins, &instance_id, "latency")
                else {
                    // Unloaded between the plugin's callback and this wake.
                    continue;
                };
                let ui = registered_ui_thread();
                serve_channel_wake(
                    &instance_id,
                    &runtime,
                    ui.as_deref(),
                    engine_plugins,
                    engine,
                    events,
                );
            }
            Err(RecvTimeoutError::Timeout) => {
                if take_pending_latency_requery_signal() {
                    let ui = registered_ui_thread();
                    service_pending_restarts(ui.as_deref(), engine_plugins, engine, events);
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn changed(
        latency_ms: f64,
        latency_frames: usize,
    ) -> Result<Option<LatencyChange>, PluginControlError<PluginError>> {
        Ok(Some(LatencyChange {
            latency_ms,
            latency_frames,
        }))
    }

    fn unchanged() -> Result<Option<LatencyChange>, PluginControlError<PluginError>> {
        Ok(None)
    }

    fn timed_out() -> Result<Option<LatencyChange>, PluginControlError<PluginError>> {
        Err(PluginControlError::Refused(
            crate::host::native_bridge::PluginControlRefusal::TimedOut {
                plugin: "fixture".to_string(),
            },
        ))
    }

    #[test]
    fn a_changed_latency_becomes_an_event_payload_carrying_milliseconds() {
        let payload = latency_change_payload("inst-1", &changed(10.0, 441));

        assert_eq!(
            payload,
            Some(PluginLatencyChanged {
                instance_id: "inst-1".to_string(),
                latency_ms: 10.0,
            })
        );
    }

    #[test]
    fn an_unchanged_poll_emits_nothing() {
        assert_eq!(latency_change_payload("inst-1", &unchanged()), None);
    }

    #[test]
    fn a_failed_requery_emits_nothing_rather_than_a_fabricated_latency() {
        assert_eq!(
            latency_change_payload("inst-1", &timed_out()),
            None,
            "a failed re-query must not publish a latency the plugin never reported"
        );
    }

    #[test]
    fn a_changed_latency_compensates_the_instances_effect_with_the_new_frame_count() {
        assert_eq!(
            latency_compensation(Some(7), &changed(10.0, 441)),
            Some(LatencyCompensation {
                effect_id: 7,
                latency_frames: 441,
            })
        );
    }

    #[test]
    fn an_unchanged_poll_compensates_nothing() {
        assert_eq!(latency_compensation(Some(7), &unchanged()), None);
    }

    #[test]
    fn a_failed_requery_compensates_nothing_rather_than_a_fabricated_latency() {
        assert_eq!(
            latency_compensation(Some(7), &timed_out()),
            None,
            "a failed re-query must not aim a delay line at a latency the plugin never reported"
        );
    }

    #[test]
    fn one_polled_change_both_emits_the_event_and_compensates_the_effect() {
        let refreshed = changed(14.5, 640);

        assert_eq!(
            latency_change_payload("inst-9", &refreshed),
            Some(PluginLatencyChanged {
                instance_id: "inst-9".to_string(),
                latency_ms: 14.5,
            })
        );
        assert_eq!(
            latency_compensation(Some(3), &refreshed),
            Some(LatencyCompensation {
                effect_id: 3,
                latency_frames: 640,
            })
        );
    }

    #[test]
    fn a_change_on_an_instance_the_graph_does_not_hold_emits_the_event_and_compensates_nothing() {
        let refreshed = changed(14.5, 640);

        assert!(
            latency_change_payload("inst-9", &refreshed).is_some(),
            "the panel still shows the plugin's own reported latency"
        );
        assert_eq!(
            latency_compensation(None, &refreshed),
            None,
            "an instance the graph does not hold has no effect id to address"
        );
    }

    #[test]
    fn the_payload_serialises_with_the_snake_case_wire_names_the_frontend_reads() {
        let json = serde_json::to_string(&PluginLatencyChanged {
            instance_id: "inst-7".to_string(),
            latency_ms: 2.5,
        })
        .expect("payload serialises");

        assert_eq!(json, r#"{"instance_id":"inst-7","latency_ms":2.5}"#);
    }

    /// The two figures a compensation carries are both `usize`, so nothing but
    /// a test that reads the command back proves the effect is addressed by the
    /// id and aimed at the frame count rather than the other way round.
    #[test]
    fn publishing_a_compensation_aims_the_named_effect_at_the_declared_frame_count() {
        let (handle, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8).unwrap();
        let engine: Engine = Arc::new(Mutex::new(Some(handle)));

        publish_compensation(
            &engine,
            "inst-1",
            LatencyCompensation {
                effect_id: 7,
                latency_frames: 441,
            },
        );

        let mut published = Vec::new();
        while let Ok(command) = command_rx.pop() {
            if let daw_engine::scheduler::GraphCommand::SetEffectLatency {
                effect_id,
                latency_frames,
                dry_delay,
            } = command
            {
                published.push((effect_id, latency_frames, dry_delay.is_some()));
            }
        }

        assert_eq!(
            published,
            vec![(7, 441, true)],
            "the command names the instance's effect, the latency the plugin reported, and \
             the dry line a bypassed pass runs at it"
        );
    }

    #[test]
    fn notifying_before_the_watcher_starts_is_a_no_op() {
        // The sender is only installed by `start`, which no unit test runs; this
        // asserts a plugin loaded in a headless build cannot panic on its wake.
        notify_latency_change("never-started");
    }

    // ── Servicing the wait-free restart hint (#3745) ───────────────────────
    //
    // A `request_restart` raised from the audio thread costs no channel send,
    // so something on the control path must eventually act on the flag it
    // leaves behind. The sweep is that something; these tests fail if the
    // hint is raised and nothing services it.

    #[derive(Default)]
    struct RecordingEventSink {
        events: Mutex<Vec<(String, serde_json::Value)>>,
    }

    impl EventSink for RecordingEventSink {
        fn emit_json(&self, event: &str, payload: serde_json::Value) {
            self.events
                .lock()
                .expect("event log")
                .push((event.to_string(), payload));
        }
    }

    /// One engine-owned instance holding a fixture that declares
    /// `staged_latency` frames and has flagged a restart if `flagged`.
    fn sweep_fixture(
        staged_latency: u32,
        flagged: bool,
    ) -> (
        EnginePlugins,
        Arc<crate::host::native_bridge::SharedHostedPlugin>,
    ) {
        use crate::state::EnginePluginInstanceData;
        use daw_engine::timeline::DeviceKind;
        use daw_plugin_host::ClapWrapper;
        use std::collections::HashMap;

        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Sweep Fixture", vec![], false);
        wrapper.set_engine_owned_command_fixture_latency_samples(staged_latency);
        if flagged {
            // The flag the [thread-safe] callback leaves, without the
            // process-wide hint: the sweep is called directly here, the way
            // the watcher's loop calls it after taking the hint itself.
            wrapper
                .engine_owned_command_fixture_host_state()
                .mark_latency_dirty();
        }

        let runtime: Arc<crate::host::native_bridge::SharedHostedPlugin> = Arc::new(
            crate::host::native_bridge::SharedHostedPlugin::new(wrapper.into()),
        );
        let mut map = HashMap::new();
        map.insert(
            "inst-1".to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 11,
                runtime: Arc::clone(&runtime),
                name: "Sweep Fixture".to_string(),
                parameters: Vec::new(),
                has_gui: false,
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
                load_resolution: crate::commands::plugins::VettedRegistryEntry::fixture(),
            },
        );

        (Arc::new(Mutex::new(map)), runtime)
    }

    /// The flagged instance is re-queried: the change becomes the event, the
    /// flag is consumed, and the graph is told where to aim compensation. The
    /// figures travel together exactly as a channel wake's do — the fixture
    /// activates at 48 kHz, the engine's own rate, so 441 frames is 9.1875 ms
    /// and the frames are what the fixture declared.
    #[test]
    fn a_sweep_services_a_flagged_instance_and_aims_the_compensation() {
        let _hint_guard = crate::host::hint_test_support::guard();
        let (engine_plugins, _runtime) = sweep_fixture(441, true);
        let sink = RecordingEventSink::default();
        let (handle, mut command_rx, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(8).unwrap();
        let engine: Engine = Arc::new(Mutex::new(Some(handle)));

        service_pending_restarts(
            Some(&InlineUiThread::default()),
            &engine_plugins,
            &engine,
            &sink,
        );

        assert_eq!(
            sink.events.lock().expect("event log").as_slice(),
            [(
                PLUGIN_LATENCY_CHANGED_EVENT.to_string(),
                serde_json::json!({ "instance_id": "inst-1", "latency_ms": 9.1875 }),
            )],
            "the sweep publishes the change the restart flag recorded"
        );

        let mut published = Vec::new();
        while let Ok(command) = command_rx.pop() {
            if let daw_engine::scheduler::GraphCommand::SetEffectLatency {
                effect_id,
                latency_frames,
                dry_delay,
            } = command
            {
                published.push((effect_id, latency_frames, dry_delay.is_some()));
            }
        }
        assert_eq!(
            published,
            vec![(11, 441, true)],
            "the sweep compensates the instance's effect at the frames the plugin declared"
        );
    }

    /// The sweep is hint-driven, and its per-instance poll is read-and-clear:
    /// a second sweep over a serviced instance finds nothing and publishes
    /// nothing, so one restart cannot loop.
    #[test]
    fn a_second_sweep_over_a_serviced_instance_publishes_nothing() {
        let _hint_guard = crate::host::hint_test_support::guard();
        let (engine_plugins, _runtime) = sweep_fixture(441, true);
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));

        service_pending_restarts(
            Some(&InlineUiThread::default()),
            &engine_plugins,
            &engine,
            &sink,
        );
        assert_eq!(sink.events.lock().expect("event log").len(), 1);

        service_pending_restarts(
            Some(&InlineUiThread::default()),
            &engine_plugins,
            &engine,
            &sink,
        );
        assert_eq!(
            sink.events.lock().expect("event log").len(),
            1,
            "the flag was consumed by the first sweep"
        );
    }

    /// An instance with nothing flagged costs one visit and answers nothing:
    /// the sweep over an idle session must not fabricate a change.
    #[test]
    fn a_sweep_over_an_unflagged_instance_publishes_nothing() {
        let (engine_plugins, _runtime) = sweep_fixture(441, false);
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));

        service_pending_restarts(
            Some(&InlineUiThread::default()),
            &engine_plugins,
            &engine,
            &sink,
        );

        assert!(sink.events.lock().expect("event log").is_empty());
    }

    /// The retry rule: an instance the sweep could not get into raises the
    /// hint again only while it still accepts control. An unloading instance
    /// refuses every future attempt, so re-raising for it would spin the sweep
    /// forever — the flag dies with the instance instead.
    #[test]
    fn a_sweep_does_not_reraise_the_hint_for_an_instance_that_refuses_control() {
        let _hint_guard = crate::host::hint_test_support::guard();
        let (engine_plugins, runtime) = sweep_fixture(441, true);
        runtime.begin_unload();
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));
        take_pending_latency_requery_signal();

        service_pending_restarts(
            Some(&InlineUiThread::default()),
            &engine_plugins,
            &engine,
            &sink,
        );

        assert!(
            !take_pending_latency_requery_signal(),
            "an unloading instance must not keep the hint alive"
        );
    }

    /// An instance that is merely busy right now — the audio thread inside a
    /// block — keeps the hint alive for the next sweep, because its flag is
    /// still standing and nothing else will read it.
    #[test]
    fn a_sweep_reraises_the_hint_for_a_live_instance_it_could_not_reach() {
        let _hint_guard = crate::host::hint_test_support::guard();
        let (engine_plugins, runtime) = sweep_fixture(441, true);
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));
        take_pending_latency_requery_signal();

        // Non-RT control holds the instance's gate for the whole visit.
        let _control_guard = runtime.try_claim_control().expect("a free control gate");
        service_pending_restarts(
            Some(&InlineUiThread::default()),
            &engine_plugins,
            &engine,
            &sink,
        );

        assert!(
            take_pending_latency_requery_signal(),
            "a live instance whose flag is still standing re-raises the hint"
        );
    }

    // ── The restart runs on the UI thread (#6640) ──────────────────────────

    /// A UI thread that is never the caller's, and runs what it is handed
    /// inline while counting it.
    #[derive(Default)]
    struct InlineUiThread {
        lent: std::sync::atomic::AtomicUsize,
    }

    impl InlineUiThread {
        fn lent(&self) -> usize {
            self.lent.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    impl UiThread for InlineUiThread {
        fn is_ui_thread(&self) -> bool {
            false
        }

        fn run_on_ui_thread(
            &self,
            task: &Arc<crate::host::ui_thread::UiThreadTask>,
        ) -> Result<(), UiThreadError> {
            self.lent.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            task.run();
            Ok(())
        }
    }

    fn latency_events(sink: &RecordingEventSink) -> usize {
        sink.events
            .lock()
            .expect("event log")
            .iter()
            .filter(|(event, _)| event == PLUGIN_LATENCY_CHANGED_EVENT)
            .count()
    }

    #[test]
    fn a_channel_wake_runs_the_latency_restart_on_the_registered_ui_thread() {
        let (engine_plugins, runtime) = sweep_fixture(441, true);
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));
        let ui = InlineUiThread::default();

        serve_channel_wake(
            "inst-1",
            &runtime,
            Some(&ui),
            &engine_plugins,
            &engine,
            &sink,
        );

        assert_eq!(ui.lent(), 1, "the restart is lent to the UI thread");
        assert_eq!(latency_events(&sink), 1, "the restart ran and was reported");
    }

    #[test]
    fn a_sweep_runs_the_latency_restart_on_the_registered_ui_thread() {
        let _hint_guard = crate::host::hint_test_support::guard();
        let (engine_plugins, _runtime) = sweep_fixture(441, true);
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));
        let ui = InlineUiThread::default();

        service_pending_restarts(Some(&ui), &engine_plugins, &engine, &sink);

        assert_eq!(ui.lent(), 1, "the restart is lent to the UI thread");
        assert_eq!(latency_events(&sink), 1, "the restart ran and was reported");
    }

    /// An instance with nothing flagged is not lent: holding its claim across a
    /// UI-thread hop would keep the audio thread off it for nothing.
    #[test]
    fn a_sweep_lends_only_the_flagged_instance_to_the_ui_thread() {
        let _hint_guard = crate::host::hint_test_support::guard();
        let (engine_plugins, _flagged) = sweep_fixture(441, true);
        let (unflagged_plugins, _unflagged) = sweep_fixture(0, false);
        let mut unflagged = unflagged_plugins
            .lock()
            .expect("engine_plugins lock")
            .remove("inst-1")
            .expect("the fixture holds its instance");
        unflagged.engine_plugin_id = 12;
        engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .insert("inst-2".to_string(), unflagged);
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));
        let ui = InlineUiThread::default();

        service_pending_restarts(Some(&ui), &engine_plugins, &engine, &sink);

        assert_eq!(ui.lent(), 1, "only the flagged instance crosses");
        assert_eq!(latency_events(&sink), 1, "and its change is reported");
    }

    /// With no UI thread the restart is refused, not run on the watcher: the
    /// flag the plugin raised is still standing for a later wake to carry.
    #[test]
    fn a_channel_wake_with_no_ui_thread_runs_nothing_and_keeps_the_flag() {
        let (engine_plugins, runtime) = sweep_fixture(441, true);
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));

        serve_channel_wake("inst-1", &runtime, None, &engine_plugins, &engine, &sink);
        assert_eq!(
            latency_events(&sink),
            0,
            "nothing ran, so nothing is reported"
        );

        let ui = InlineUiThread::default();
        serve_channel_wake(
            "inst-1",
            &runtime,
            Some(&ui),
            &engine_plugins,
            &engine,
            &sink,
        );
        assert_eq!(
            latency_events(&sink),
            1,
            "the refused restart's flag was left for the next wake"
        );
    }

    /// The sweep refuses the same way, and does not raise the hint again: no
    /// later sweep has a thread to run it on either, so re-raising would spin.
    #[test]
    fn a_sweep_with_no_ui_thread_runs_nothing_and_does_not_reraise_the_hint() {
        let _hint_guard = crate::host::hint_test_support::guard();
        let (engine_plugins, _runtime) = sweep_fixture(441, true);
        let sink = RecordingEventSink::default();
        let engine: Engine = Arc::new(Mutex::new(None));
        take_pending_latency_requery_signal();

        service_pending_restarts(None, &engine_plugins, &engine, &sink);

        assert_eq!(
            latency_events(&sink),
            0,
            "nothing ran, so nothing is reported"
        );
        assert!(
            !take_pending_latency_requery_signal(),
            "an ask no thread can carry must not keep the watcher spinning"
        );

        let ui = InlineUiThread::default();
        service_pending_restarts(Some(&ui), &engine_plugins, &engine, &sink);
        assert_eq!(ui.lent(), 1, "a later sweep lends the restart");
        assert_eq!(
            latency_events(&sink),
            1,
            "the refused sweep ran nothing and left the flag for the next one"
        );
    }
}
