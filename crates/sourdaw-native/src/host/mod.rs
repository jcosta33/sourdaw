pub mod latency_watcher;
pub mod native_bridge;
pub mod plugin_host_requests;
pub mod plugin_parameter_events;
pub mod plugin_registry_store;
pub mod plugin_scan_policy;
pub mod plugin_scan_worker;
pub mod plugin_window;
pub mod process_refusal_reporter;
pub mod tail_watcher;
pub mod ui_thread;

use crate::host::native_bridge::SharedHostedPlugin;
use crate::state::EnginePluginInstanceData;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Look one engine-owned runtime up for a watcher thread woken by that instance.
///
/// Shared by every push path because the failure it reports is shared: a
/// poisoned `engine_plugins` lock is terminal for a watcher and invisible
/// without this line — the thread keeps recv-looping so it still looks alive,
/// while every lookup misses forever and nothing that instance reports reaches
/// the frontend again. `context` names the push path so one message identifies
/// which watcher went deaf.
///
/// A miss is ordinary: an instance unloaded between the plugin's callback and
/// the wake it fired has no runtime left to address.
pub(crate) fn runtime_for_instance(
    engine_plugins: &Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>,
    instance_id: &str,
    context: &str,
) -> Option<Arc<SharedHostedPlugin>> {
    let guard = match engine_plugins.lock() {
        Ok(guard) => guard,
        Err(error) => {
            eprintln!(
                "[Plugin] {} watcher failed to lock engine_plugins for instance {}: {}",
                context, instance_id, error
            );
            return None;
        }
    };
    guard
        .get(instance_id)
        .map(|instance| Arc::clone(&instance.runtime))
}

/// Every engine-owned runtime, for a push path whose wake names no instance.
///
/// A hint raised from the audio thread cannot carry an id — copying one would
/// allocate — so the thread that answers it visits every instance and lets each
/// backend say whether it was the one that spoke.
///
/// The handles are cloned out and the map lock released before the caller uses
/// them: taking a plugin's control seam while still holding the instance map
/// would block every plugin command in the process behind one busy instance.
pub(crate) fn all_engine_runtimes(
    engine_plugins: &Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>,
    context: &str,
) -> Vec<(String, Arc<SharedHostedPlugin>)> {
    let Ok(guard) = engine_plugins.lock() else {
        eprintln!("[Plugin] {} failed to lock engine_plugins", context);
        return Vec::new();
    };

    guard
        .iter()
        .map(|(instance_id, instance)| (instance_id.clone(), Arc::clone(&instance.runtime)))
        .collect()
}

/// Raise a hint again for an instance a visit could not get into.
///
/// Only for one still accepting public control. That is the difference between a
/// control path busy right now — the audio thread is inside a block, and the next
/// tick finds it free — and an instance unloading or retired, which would refuse
/// every retry and turn the hint into a tick that never sleeps.
///
/// `context` names the visit, and `reraise` is that visit's own hint, because
/// the retry rule is shared while the hint is not.
pub(crate) fn retry_unreached_instance(
    runtime: &SharedHostedPlugin,
    instance_id: &str,
    context: &str,
    error: &str,
    reraise: fn(),
) {
    if runtime.ensure_public_control_allowed().is_err() {
        return;
    }

    eprintln!(
        "[Plugin] {} could not reach instance {}, retrying: {}",
        context, instance_id, error
    );
    reraise();
}
