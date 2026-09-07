//! Emptying the engine slot when the output stream behind it is gone.
//!
//! An `EngineHandle` outlives its output stream. A renegotiated Bluetooth
//! headset or a device change leaves the slot holding a handle whose render
//! callback has stopped, and `apply_graph_commands` then refuses every batch
//! with `engine-not-rendering:` — correctly, because nothing pushed onto that
//! engine's ring will ever be heard. Nothing used to empty the slot again:
//! `start_into_empty_slot` fills it once and no path took a handle back out,
//! so the session stayed deaf until the app was relaunched.
//!
//! ## Why the rebuild is not inside the engine
//!
//! The scheduler lives inside the render closure the stream owns, and the
//! whole graph — buffer sizes, delay lines, every plugin's activation — is
//! built for the rate the device opened at. A renegotiated headset commonly
//! comes back at another rate, so restarting the stream under a graph built
//! for the old one would desynchronise the tap, the render pass and every
//! take stamped against it. Retiring the handle and letting the next batch
//! boot a fresh engine on the current default device is the only route that
//! rebuilds all three together, and it is where every rate-dependent
//! decision is made from scratch anyway.
//!
//! ## What a retire costs
//!
//! Hosted plugin instances do not survive it. A record in `engine_plugins`
//! holds its runtime as an `Arc<SharedHostedPlugin>` shared with a scheduler
//! that is going away, activated at the dead device's rate, and the dormant
//! record `attach_dormant_plugins` re-attaches from
//! (`state::PluginInstanceData`) carries an owned `HostedRuntime` and nothing
//! naming the plugin binary. So there is no dormant record to write here: the
//! runtimes are retired for reclamation the way the exit cascade retires
//! them, and re-instantiating an instance is the load path's business, not
//! this command's. Crumbs instances do survive, because their engine side is
//! rebuilt from command-side state (`crumbs::detach_from_retired_engine`).
//! What the reply carries instead is which engine-owned records were
//! drained — `retiredInstanceIds`, the UI instance ids, ascending — so the
//! renderer knows exactly which plugins it must reload itself.

use serde::{Deserialize, Serialize};

use crate::state::{locked_or_poisoned, AppState, EnginePluginInstanceData};

use super::crumbs::{self, CrumbsState};

/// What the retire found, and did.
///
/// Kebab-case on the wire because these are read as tokens by
/// `src/modules/AudioEngine/repositories/engineLifecycle/retireNativeEngine.ts`,
/// which is hand-maintained against this enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RetireOutcome {
    /// The slot held an engine that was not rendering. It is empty now, and
    /// the next `apply_graph_commands` boots a fresh one.
    Retired,
    /// The slot was already empty. Nothing to do — the next batch was going
    /// to boot an engine anyway.
    NoEngine,
    /// The engine is still rendering, so the slot is untouched. A caller that
    /// misread a transient fault as a lost stream gets its session back
    /// rather than a needless restart.
    Rendering,
}

/// The reply `retire_native_engine` answers with. Never an error: every state
/// the slot can be in has an outcome, and a caller deciding whether to re-arm
/// must not have to tell a refusal apart from a transport failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetireNativeEngineResult {
    pub outcome: RetireOutcome,
    /// UI instance ids of every engine-owned plugin record the retire
    /// drained, ascending for determinism. There is no dormant record left
    /// behind for these (see the module doc), so this is how the renderer
    /// knows which plugins it must reload itself. Empty for `no-engine` and
    /// `rendering`, since neither one drains anything.
    pub retired_instance_ids: Vec<String>,
}

impl RetireNativeEngineResult {
    fn of(outcome: RetireOutcome, retired_instance_ids: Vec<String>) -> Self {
        Self {
            outcome,
            retired_instance_ids,
        }
    }
}

/// Take a lost engine out of its slot, leaving the control side ready for the
/// one the next batch boots.
///
/// The order matters and is stated rather than implied:
///
/// 1. the handle leaves the slot, and the slot lock is released — every step
///    below takes its own locks, and none of them is held across the handle's
///    drop;
/// 2. the engine-owned runtimes are retired for reclamation;
/// 3. every attached crumbs instance goes back to dormant, so the next batch
///    re-registers it;
/// 4. the graph registry drops the ledger it kept against the dead engine's
///    ring;
/// 5. the handle drops last, because that drop waits on the audio-owner
///    thread and a lock held across it would park every other claim for the
///    shutdown timeout;
/// 6. one sweep, after that drop, because the scheduler releasing its `Arc` is
///    what makes a retired runtime free-able.
///
/// No two of the stores are ever held at once, so this path establishes no
/// lock order and can invert none: the crate's existing orders (`crumbs`
/// takes instances then engine, `graph` takes registry then engine) are
/// untouched. Nothing here runs on the audio thread.
pub async fn retire_native_engine(
    state: &AppState,
    crumbs: &CrumbsState,
) -> RetireNativeEngineResult {
    let retired_engine = {
        let mut slot = locked_or_poisoned(&state.engine);
        let Some(engine) = slot.as_ref() else {
            return RetireNativeEngineResult::of(RetireOutcome::NoEngine, Vec::new());
        };
        // The watchdog's own verdict, the same one `apply_graph_commands`
        // admits a batch on: a `DeviceChanged` reroute the callback survived
        // leaves this true, and retiring on the *kind* of the last fault
        // would tear down a session that never stopped sounding.
        if engine.is_rendering() {
            return RetireNativeEngineResult::of(RetireOutcome::Rendering, Vec::new());
        }
        slot.take()
    };

    let retired_instance_ids = retire_engine_owned_plugins(state);
    crumbs::detach_from_retired_engine(crumbs);
    locked_or_poisoned(&state.graph).reset_for_engine_restart();

    drop(retired_engine);

    // The dead scheduler releases its own `Arc` when the owner thread drops
    // it behind the handle above, which may or may not have happened by now.
    // A runtime still held simply survives this sweep and is freed by the
    // next one, exactly as `sweep_retired_engine_plugins` intends.
    state.sweep_retired_engine_plugins();

    RetireNativeEngineResult::of(RetireOutcome::Retired, retired_instance_ids)
}

/// Empty `engine_plugins` and hand every runtime to the retirement vec.
///
/// `begin_unload` then `retire` then retain, the order `shutdown.rs` keeps
/// (`take_live_plugin_instances`, `retire_for_reclamation`): the withdrawal
/// of the intent to process comes first so the stop is never missed, and the
/// retention comes before this pass lets go of its own reference, so a
/// scheduler or watcher thread can never become the final owner and run CLAP
/// `destroy` on itself.
///
/// No `engine.remove_plugin`: the removal is a command onto a ring nothing
/// drains, so it would pop nothing. The scheduler's own `Arc` is released
/// when the owner thread drops the scheduler behind the handle instead.
///
/// The plugin calls happen outside the store's critical section, because both
/// of them reach into third-party code and a store held across one parks
/// every other plugin command for its duration.
///
/// Returns the drained records' UI instance ids, sorted ascending: the
/// renderer has no other way to learn which plugins it must reload.
fn retire_engine_owned_plugins(state: &AppState) -> Vec<String> {
    let instances: Vec<(String, EnginePluginInstanceData)> = {
        let mut engine_plugins = locked_or_poisoned(&state.engine_plugins);
        std::mem::take(&mut *engine_plugins).into_iter().collect()
    };

    let mut retired_instance_ids = Vec::with_capacity(instances.len());
    for (instance_id, instance) in instances {
        instance.runtime.begin_unload();
        instance.runtime.retire();
        state.retain_retired_engine_plugin(instance.runtime);
        retired_instance_ids.push(instance_id);
    }
    retired_instance_ids.sort();
    retired_instance_ids
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use daw_engine::engine_events::StreamErrorKind;
    use daw_engine::scheduler::GraphCommand;
    use daw_plugin_host::ClapWrapper;
    use serde_json::{json, Value};

    use crate::block_on_test;
    use crate::commands::graph::apply_graph_commands;
    use crate::host::native_bridge::SharedHostedPlugin;
    use crate::state::{EnginePluginInstanceData, PluginInstanceData};

    use super::*;

    /// A batch that carries no commands at all: enough to fence, attach every
    /// dormant instance and report a number, and nothing else. What these
    /// tests are about is the state a retire left behind, never the mapping.
    fn empty_batch() -> Value {
        json!({ "schemaVersion": 1, "commands": [] })
    }

    /// A batch that builds one strip, so the registry ends up holding
    /// topology for the retire to clear.
    fn one_strip_batch() -> Value {
        json!({
            "schemaVersion": 1,
            "commands": [{
                "kind": "create-track-strip",
                "trackId": "t1",
                "name": "T",
                "state": {
                    "gain": 1.0,
                    "pan": 0,
                    "muted": false,
                    "soloGated": false,
                    "vcaMultiplier": 1,
                },
                "devices": [],
                "honorMuted": true,
                "contributesAudio": true,
            }],
        })
    }

    /// Put a capture engine in the slot. Filling it first is what keeps the
    /// lazy bootstrap in `apply_graph_commands` from opening a real device.
    fn fill_slot_with_capture_engine(state: &AppState) -> rtrb::Consumer<GraphCommand> {
        let (engine, commands, _retired_adoption_rx) =
            daw_engine::engine_handle_for_command_capture(64);
        *state.engine.lock().expect("the engine slot is free") = Some(engine);
        commands
    }

    /// Tell the engine in the slot its render callback has stopped, the way a
    /// lost headset does.
    fn stall_the_engine_in_the_slot(state: &AppState) {
        state
            .engine
            .lock()
            .expect("the engine slot is readable")
            .as_ref()
            .expect("the slot holds an engine to stall")
            .mark_render_stalled(Some(StreamErrorKind::DeviceChanged));
    }

    fn slot_holds_an_engine(state: &AppState) -> bool {
        state
            .engine
            .lock()
            .expect("the engine slot is readable")
            .is_some()
    }

    fn engine_owned_runtime(name: &str) -> Arc<SharedHostedPlugin> {
        Arc::new(SharedHostedPlugin::new(
            ClapWrapper::new_engine_owned_command_fixture(name, Vec::new(), false).into(),
        ))
    }

    fn insert_engine_owned_plugin(
        state: &AppState,
        instance_id: &str,
        runtime: Arc<SharedHostedPlugin>,
    ) {
        state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .insert(
                instance_id.to_string(),
                EnginePluginInstanceData {
                    engine_plugin_id: 41,
                    runtime,
                    name: "Retire Fixture".to_string(),
                    parameters: Vec::new(),
                    has_gui: false,
                    chain_kind: daw_engine::timeline::DeviceKind::Effect,
                    parameter_events: None,
                },
            );
    }

    fn retired_runtime_count(state: &AppState) -> usize {
        state
            .retired_engine_plugins
            .lock()
            .expect("retirement lock")
            .len()
    }

    fn retire(state: &AppState, crumbs: &CrumbsState) -> RetireNativeEngineResult {
        block_on_test(retire_native_engine(state, crumbs))
    }

    #[test]
    fn an_empty_slot_reports_no_engine() {
        let state = AppState::default();

        let result = retire(&state, &CrumbsState::default());

        assert_eq!(
            serde_json::to_value(result).expect("the reply serializes"),
            json!({ "outcome": "no-engine", "retiredInstanceIds": [] }),
            "an empty slot is an outcome, never an error the caller has to read as one"
        );
        assert!(!slot_holds_an_engine(&state));
        assert!(state.plugins.lock().expect("plugins lock").is_empty());
        assert!(state
            .engine_plugins
            .lock()
            .expect("engine_plugins lock")
            .is_empty());
    }

    #[test]
    fn a_rendering_engine_keeps_its_slot_and_its_plugins() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        insert_engine_owned_plugin(&state, "engine-instance", engine_owned_runtime("Live"));

        let result = retire(&state, &CrumbsState::default());

        assert_eq!(
            serde_json::to_value(result).expect("the reply serializes"),
            json!({ "outcome": "rendering", "retiredInstanceIds": [] }),
            "an engine whose callback still runs is not a lost one, and nothing was drained to report"
        );
        assert!(
            slot_holds_an_engine(&state),
            "a rendering engine must be left exactly where it was"
        );
        assert_eq!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .len(),
            1,
            "nothing may be retired out from under a session that is still sounding"
        );
        assert_eq!(retired_runtime_count(&state), 0);
    }

    #[test]
    fn a_stalled_engine_leaves_the_slot_empty() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        stall_the_engine_in_the_slot(&state);

        let result = retire(&state, &CrumbsState::default());

        assert_eq!(
            serde_json::to_value(result).expect("the reply serializes"),
            json!({ "outcome": "retired", "retiredInstanceIds": [] })
        );
        assert!(
            !slot_holds_an_engine(&state),
            "the empty slot is what lets the next batch boot on the current default device"
        );
    }

    #[test]
    fn the_retired_engines_topology_leaves_the_registry() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        let applied = block_on_test(apply_graph_commands(
            one_strip_batch(),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the setup batch resolves");
        assert_eq!(applied["application"], "applied");
        assert!(
            state
                .graph
                .lock()
                .expect("the registry is readable")
                .holds_strip("t1"),
            "the setup batch must actually leave a strip for the retire to clear"
        );

        stall_the_engine_in_the_slot(&state);
        retire(&state, &CrumbsState::default());

        let registry = state.graph.lock().expect("the registry is readable");
        assert!(
            !registry.holds_strip("t1"),
            "a strip left in the registry would refuse its own id on the next session's batch"
        );
    }

    #[test]
    fn a_retired_engine_plugin_is_freed_only_when_the_scheduler_releases_it() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        let runtime = engine_owned_runtime("Retire Fixture");
        // Standing in for the scheduler's own clone: the audio thread may
        // still be holding the slot that owns it when the retire runs.
        let scheduler_clone = Arc::clone(&runtime);
        insert_engine_owned_plugin(&state, "engine-instance", runtime);
        stall_the_engine_in_the_slot(&state);

        retire(&state, &CrumbsState::default());

        assert!(
            state
                .engine_plugins
                .lock()
                .expect("engine_plugins lock")
                .is_empty(),
            "a record left behind would map a device onto an effect id the next engine never took"
        );
        assert_eq!(
            retired_runtime_count(&state),
            1,
            "a runtime the scheduler still holds must survive the retire's own sweep"
        );

        drop(scheduler_clone);
        state.sweep_retired_engine_plugins();

        assert_eq!(
            retired_runtime_count(&state),
            0,
            "the release is the acknowledgment the reclamation waits for"
        );
    }

    #[test]
    fn a_retire_reports_the_engine_owned_instances_it_drained_in_ascending_order() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        insert_engine_owned_plugin(&state, "b", engine_owned_runtime("Retire Fixture"));
        insert_engine_owned_plugin(&state, "a", engine_owned_runtime("Retire Fixture"));
        stall_the_engine_in_the_slot(&state);

        let result = retire(&state, &CrumbsState::default());

        assert_eq!(
            result.retired_instance_ids,
            vec!["a".to_string(), "b".to_string()],
            "the renderer reloads exactly the engine-owned records the retire drained, sorted for determinism regardless of insertion order"
        );
    }

    #[test]
    fn retiring_leaves_a_dormant_plugin_for_the_next_engine_to_attach() {
        let state = AppState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        state.plugins.lock().expect("plugins lock").insert(
            "dormant-instance".to_string(),
            PluginInstanceData::dormant_fixture(
                ClapWrapper::new_engine_owned_command_fixture("Dormant", Vec::new(), false).into(),
            ),
        );
        stall_the_engine_in_the_slot(&state);

        retire(&state, &CrumbsState::default());

        assert!(
            state
                .plugins
                .lock()
                .expect("plugins lock")
                .contains_key("dormant-instance"),
            "an instance still waiting for an engine is exactly what the next bootstrap attaches"
        );
    }

    #[test]
    fn a_crumbs_instance_reattaches_to_the_engine_that_replaces_the_retired_one() {
        let state = AppState::default();
        let crumbs_state = CrumbsState::default();
        let _lost_engine_commands = fill_slot_with_capture_engine(&state);
        block_on_test(crumbs::create_crumbs(
            "instance-1".to_string(),
            &crumbs_state,
            &state,
        ))
        .expect("the instance registers on the engine in the slot");
        assert!(
            crumbs::instance_is_attached(&crumbs_state, "instance-1"),
            "the setup must leave the instance attached, or the retire proves nothing"
        );
        stall_the_engine_in_the_slot(&state);

        retire(&state, &crumbs_state);

        assert!(
            !crumbs::instance_is_attached(&crumbs_state, "instance-1"),
            "an instance left attached holds rings the retired engine's slot side is gone from"
        );

        let mut replacement_commands = fill_slot_with_capture_engine(&state);
        let applied = block_on_test(apply_graph_commands(empty_batch(), &state, &crumbs_state))
            .expect("the batch on the replacing engine resolves");

        assert_eq!(applied["application"], "applied");
        assert!(
            crumbs::instance_is_attached(&crumbs_state, "instance-1"),
            "the first batch on the new engine is what re-registers the instance"
        );
        let mut added_plugins = 0;
        let mut registered_capture_consumers = 0;
        while let Ok(command) = replacement_commands.pop() {
            match command {
                GraphCommand::AddPlugin(..) => added_plugins += 1,
                GraphCommand::RegisterCaptureConsumer(_) => registered_capture_consumers += 1,
                _ => {}
            }
        }
        assert_eq!(
            (added_plugins, registered_capture_consumers),
            (1, 1),
            "the re-registration is the slot plus its capture tap, on the replacing engine's ring"
        );
    }

    #[test]
    fn the_first_batch_on_the_replacing_engine_is_numbered_from_one() {
        let state = AppState::default();
        let _lost_engine_commands = fill_slot_with_capture_engine(&state);
        for _ in 0..5 {
            block_on_test(apply_graph_commands(
                empty_batch(),
                &state,
                &CrumbsState::default(),
            ))
            .expect("the setup batches resolve");
        }
        assert_eq!(
            state
                .graph
                .lock()
                .expect("the registry is readable")
                .fenced_batches(),
            5,
            "the lost engine's ring really did take five fences"
        );
        stall_the_engine_in_the_slot(&state);

        retire(&state, &CrumbsState::default());
        let _replacement_commands = fill_slot_with_capture_engine(&state);
        let applied = block_on_test(apply_graph_commands(
            empty_batch(),
            &state,
            &CrumbsState::default(),
        ))
        .expect("the batch on the replacing engine resolves");

        assert_eq!(applied["application"], "applied");
        assert_eq!(
            applied["admittedBatch"].as_u64(),
            Some(1),
            "the fence count numbers this engine's ring, and this engine has drained none"
        );
    }

    /// The handle's own drop, on a real engine, waits on the audio-owner
    /// thread. This is the fixture handle, so the wait returns at once — what
    /// the assertion is about is that nothing here holds a store across it.
    #[test]
    fn a_retire_leaves_every_store_unlocked() {
        let state = AppState::default();
        let crumbs_state = CrumbsState::default();
        let _commands = fill_slot_with_capture_engine(&state);
        stall_the_engine_in_the_slot(&state);

        retire(&state, &crumbs_state);

        assert!(state.engine.try_lock().is_ok());
        assert!(state.engine_plugins.try_lock().is_ok());
        assert!(state.plugins.try_lock().is_ok());
        assert!(state.graph.try_lock().is_ok());
        assert!(crumbs_state.instances.try_lock().is_ok());
        assert!(state.retired_engine_plugins.try_lock().is_ok());
    }
}
