//! Control-path visit that says out loud what the audio thread recorded.
//!
//! A hosted plugin that fails a process call takes its slot out of service for
//! as long as it keeps failing — a CLAP effect passes dry, an instrument falls
//! silent — and the audio thread that saw it may not print, allocate, or take
//! the I/O lock. So each backend latches the failure and this visit reports it.
//!
//! Without it the latch has no reader on any recurring path: a plugin failing
//! every block would take a track down for a whole session and leave nothing in
//! the log to say which plugin, or that anything failed at all.
//!
//! The wake is the same shape as the tail's, and for the same reason: the
//! failure is recorded on the audio thread, which cannot name the instance
//! without allocating, so the backend raises one process-wide hint and the
//! parameter-event drain — already awake on a timer for hints of exactly that
//! kind — hands it here. A raised hint visits every engine-owned instance and
//! lets each backend answer for itself; the report is latched, so an instance
//! that has already spoken says nothing on a later visit.

use crate::host::{all_engine_runtimes, retry_unreached_instance};
use crate::state::EnginePluginInstanceData;
use daw_plugin_host::{signal_pending_process_refusal, HostedPluginRuntime};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// How long one report may wait for the audio thread to release an instance.
///
/// Sized for the audio thread holding the seam for the length of a block, like
/// the other legs of this tick. An instance that could not be reached raises the
/// hint again rather than holding up the visit to the others.
const CONTROL_TIMEOUT: Duration = Duration::from_millis(50);

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;

/// Report the process failures the audio thread latched.
///
/// Called from the parameter-event drain's tick, once it has taken the hint.
pub fn report_pending_process_refusals(engine_plugins: &EnginePlugins) {
    for (instance_id, runtime) in all_engine_runtimes(engine_plugins, "process-failure report") {
        let reached = runtime.try_with_control(CONTROL_TIMEOUT, |plugin| {
            plugin.report_plugin_observations();
            Ok(())
        });

        if let Err(error) = reached {
            retry_unreached_instance(
                &runtime,
                &instance_id,
                "process-failure report",
                &error,
                signal_pending_process_refusal,
            );
        }
    }
}
