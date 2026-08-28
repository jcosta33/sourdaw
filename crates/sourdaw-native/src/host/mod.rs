pub mod latency_watcher;
pub mod native_bridge;
pub mod plugin_host_requests;
pub mod plugin_registry_store;
pub mod plugin_scan_policy;
pub mod plugin_scan_worker;
pub mod plugin_window;

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
