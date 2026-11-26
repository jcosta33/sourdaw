pub(crate) mod dormant_attach_wake;
pub mod latency_watcher;
pub mod native_bridge;
pub mod plugin_editor_asks;
pub mod plugin_folder_grants;
pub mod plugin_host_requests;
pub mod plugin_parameter_events;
pub mod plugin_registry_store;
pub mod plugin_scan_policy;
pub mod plugin_scan_worker;
pub mod plugin_window;
pub mod process_refusal_reporter;
pub mod runtime_scope;
pub mod service_watcher;
pub mod tail_watcher;
pub mod ui_thread;

use crate::host::dormant_attach_wake::DormantRuntimeRelease;
use crate::host::native_bridge::SharedHostedPlugin;
use crate::state::{EnginePluginInstanceData, PluginInstanceData};
use std::collections::HashMap;
use std::ops::Deref;
use std::sync::{Arc, Mutex, TryLockError};

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

/// The command-owned store: instances loaded before the engine ran, dormant
/// until its first graph batch attaches them.
pub(crate) type CommandPlugins = Arc<Mutex<HashMap<String, PluginInstanceData>>>;

/// Every runtime an editor can be open on, engine-owned or dormant, for an
/// editor drain whose wake names no instance.
///
/// The dormant clones are watched by the release they carry, which is dropped
/// after them: the engine attach refuses an instance any clone is still inside,
/// and only the drop of the last one tells it the instance is free.
pub(crate) struct EditorRuntimes {
    runtimes: Vec<(String, Arc<SharedHostedPlugin>)>,
    _dormant_release: DormantRuntimeRelease,
}

impl Deref for EditorRuntimes {
    type Target = [(String, Arc<SharedHostedPlugin>)];

    fn deref(&self) -> &Self::Target {
        &self.runtimes
    }
}

/// Collect [`EditorRuntimes`].
///
/// The command-owned store is only tried. A worker may hold it while it waits
/// for the shell's UI thread, and the tick this serves also carries every
/// plugin's knob edits, so a busy store raises `reraise` — the visit's own hint
/// — and is visited on the next tick instead of being waited on.
pub(crate) fn all_editor_runtimes(
    engine_plugins: &Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>,
    command_plugins: &CommandPlugins,
    context: &str,
    reraise: fn(),
) -> EditorRuntimes {
    let mut runtimes = all_engine_runtimes(engine_plugins, context);
    let mut dormant_runtimes = Vec::new();
    match command_plugins.try_lock() {
        Ok(dormant) => dormant_runtimes.extend(
            dormant
                .iter()
                .map(|(instance_id, instance)| (instance_id.clone(), Arc::clone(&instance.plugin))),
        ),
        Err(TryLockError::WouldBlock) => reraise(),
        Err(TryLockError::Poisoned(_)) => {
            eprintln!("[Plugin] {} failed to lock plugins", context);
        }
    }
    let dormant_release =
        DormantRuntimeRelease::watching(dormant_runtimes.iter().map(|(_, runtime)| runtime));
    runtimes.extend(dormant_runtimes);
    EditorRuntimes {
        runtimes,
        _dormant_release: dormant_release,
    }
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
    error: &dyn std::fmt::Display,
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

/// The most drain visits an instance that keeps failing sits out between two
/// attempts: about half a second of the parameter drain's 16 ms tick.
const MAX_SKIPPED_EDITOR_DRAIN_VISITS: u32 = 31;

/// One instance's current run of failed editor-drain attempts.
#[derive(Debug)]
struct UnreachedEpisode {
    instance_id: String,
    failures: u32,
    visits_to_skip: u32,
    #[cfg(test)]
    logged_lines: u32,
}

/// The retry rule of one editor drain: an instance the drain could not reach is
/// tried again at doubling intervals, and the run of failures is logged once.
///
/// Each failed attempt costs the drain tick that also carries every plugin's
/// knob edits — a whole hop deadline when the shell's thread has stopped taking
/// work — and a window thread that refuses at once fails on every tick. Retrying
/// every tick spends that cost, and a line of log, sixty times a second for as
/// long as the shell stays that way. The interval doubles from the next visit
/// up to [`MAX_SKIPPED_EDITOR_DRAIN_VISITS`], and resets on the first success.
///
/// Counted in drain visits rather than time, because a visit is what an attempt
/// costs: an instance sat out raises the drain's hint again so the drain keeps
/// coming back for it.
pub(crate) struct EditorDrainRetry {
    context: &'static str,
    episodes: Mutex<Vec<UnreachedEpisode>>,
}

impl EditorDrainRetry {
    pub(crate) const fn new(context: &'static str) -> Self {
        Self {
            context,
            episodes: Mutex::new(Vec::new()),
        }
    }

    fn episodes(&self) -> std::sync::MutexGuard<'_, Vec<UnreachedEpisode>> {
        self.episodes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Forget every episode whose instance this visit no longer finds.
    pub(crate) fn forget_absent(&self, runtimes: &[(String, Arc<SharedHostedPlugin>)]) {
        self.episodes().retain(|episode| {
            runtimes
                .iter()
                .any(|(instance_id, _)| *instance_id == episode.instance_id)
        });
    }

    /// Whether this visit attempts `instance_id`. One sat out raises `reraise`,
    /// so a later visit comes back for it.
    pub(crate) fn admits(&self, instance_id: &str, reraise: fn()) -> bool {
        let mut episodes = self.episodes();
        let Some(episode) = episodes
            .iter_mut()
            .find(|episode| episode.instance_id == instance_id)
        else {
            return true;
        };
        if episode.visits_to_skip == 0 {
            return true;
        }
        episode.visits_to_skip -= 1;
        reraise();
        false
    }

    /// The attempt reached the instance: its episode, if any, is over.
    pub(crate) fn reached(&self, instance_id: &str) {
        self.episodes()
            .retain(|episode| episode.instance_id != instance_id);
    }

    /// The attempt did not reach the instance.
    ///
    /// An instance still accepting public control is retried, which is the
    /// difference between a control path or shell busy right now and an
    /// instance unloading or retired, which would refuse every retry. The first
    /// failure of an episode is logged; the rest are counted.
    pub(crate) fn unreached(
        &self,
        runtime: &SharedHostedPlugin,
        instance_id: &str,
        error: &dyn std::fmt::Display,
        reraise: fn(),
    ) {
        if runtime.ensure_public_control_allowed().is_err() {
            self.reached(instance_id);
            return;
        }

        let mut episodes = self.episodes();
        let index = match episodes
            .iter()
            .position(|episode| episode.instance_id == instance_id)
        {
            Some(index) => index,
            None => {
                episodes.push(UnreachedEpisode {
                    instance_id: instance_id.to_string(),
                    failures: 0,
                    visits_to_skip: 0,
                    #[cfg(test)]
                    logged_lines: 0,
                });
                let index = episodes.len() - 1;
                self.log_episode_start(&mut episodes[index], error);
                index
            }
        };
        let episode = &mut episodes[index];
        episode.failures = episode.failures.saturating_add(1);
        episode.visits_to_skip = skipped_visits_after(episode.failures);
        drop(episodes);
        reraise();
    }

    /// The one line a run of failures logs, counted where it is written so a
    /// second line anywhere in the episode shows in [`Self::logged_lines`].
    fn log_episode_start(&self, episode: &mut UnreachedEpisode, error: &dyn std::fmt::Display) {
        eprintln!(
            "[Plugin] {} could not reach instance {}, retrying at longer intervals \
             until it answers: {}",
            self.context, episode.instance_id, error
        );
        #[cfg(test)]
        {
            episode.logged_lines += 1;
        }
    }

    /// How many lines the current episode of `instance_id` has logged.
    #[cfg(test)]
    pub(crate) fn logged_lines(&self, instance_id: &str) -> u32 {
        self.episodes()
            .iter()
            .find(|episode| episode.instance_id == instance_id)
            .map_or(0, |episode| episode.logged_lines)
    }
}

/// Visits sat out after `failures` consecutive failures: none after the first,
/// so a one-off refusal is retried on the very next tick, then 1, 3, 7, … up to
/// the ceiling — attempts on visits 1, 2, 4, 8, 16, ….
fn skipped_visits_after(failures: u32) -> u32 {
    let doubled = 1u32
        .checked_shl(failures.saturating_sub(1))
        .unwrap_or(u32::MAX);
    (doubled - 1).min(MAX_SKIPPED_EDITOR_DRAIN_VISITS)
}

/// The process-wide hints every watcher reads are shared by every test in the
/// binary, so a test that raises one, sweeps on one, or asserts one is
/// absent takes this first, and starts from a slate with none raised.
#[cfg(test)]
pub(crate) mod hint_test_support {
    use daw_plugin_host::{
        take_pending_editor_resize_signal, take_pending_latency_requery_signal,
        take_pending_main_thread_callback_signal, take_pending_parameter_events_signal,
        take_pending_parameter_flush_signal, take_pending_process_refusal_signal,
        take_pending_service_change_signal, take_pending_tail_change_signal,
    };
    use std::sync::{Mutex, MutexGuard};

    static HINT_TEST_LOCK: Mutex<()> = Mutex::new(());

    pub(crate) fn guard() -> MutexGuard<'static, ()> {
        let guard = HINT_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        take_pending_main_thread_callback_signal();
        take_pending_parameter_events_signal();
        take_pending_parameter_flush_signal();
        take_pending_tail_change_signal();
        take_pending_service_change_signal();
        take_pending_process_refusal_signal();
        take_pending_editor_resize_signal();
        take_pending_latency_requery_signal();
        guard
    }
}
