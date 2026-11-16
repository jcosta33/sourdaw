//! An offline render's own hosted plugin instances, and the renders in flight.
//!
//! A print contains the hosted effects its strips carry, so an offline render
//! cannot borrow the live instances: those run on the device's clock, at its
//! rate, in real-time mode, inside the live engine. It hosts an independent
//! offline instance of each engine-attached effect a sounding strip names
//! instead, built here for that render alone and released when it ends.
//!
//! The live instance is touched exactly once, by the state read that captures
//! what the user set on it ([`read_live_state`]). The runtime it reads and the
//! load it was vetted from are taken from one engine record under one lock: an
//! instance id is the device's persistent id, so an unload and a reload under
//! it between two lookups would pair one load's state with another load's
//! file. The read does not drain parameter writes still waiting for the live
//! engine to process them: it refuses while any are pending, and so does the
//! render, naming that reason, since a state read past them would print
//! settings the user has already moved. It is never reactivated, re-rated, re-moded or
//! spliced into the render.
//!
//! Each offline instance is built the way a load builds one: on the shell's UI
//! thread, from the very file the live instance's load vetted, re-vetted
//! against the same fingerprint, under `PLUGIN_RUNTIME_GATE` in read mode
//! (`plugins::construct_runtime_on_ui_thread`). The gate is held for that vet
//! and construction alone, one instance at a time, so an unload waits on one
//! construction rather than on a whole export's. It is activated at the export
//! rate in [`ProcessMode::Offline`], and the captured state is restored on the
//! control path, with the gate free, before the render. Every failure refuses the render by device
//! and plugin name: nothing renders dry silently.
//!
//! The render thread is each instance's audio thread. It processes every
//! block, leaves the processing state after the last one, and drops the
//! renderer — which holds the scheduler's clones of every slot — before any
//! instance is released. The final drop of each runtime then runs on the UI
//! thread, or the runtime waits in the retirement vec for the next sweep, on
//! every path out of a render: success, refusal, cancellation, or a panic
//! unwinding through it ([`OfflinePluginInstances`]'s drop).

use crate::commands::graph::BoundHostedInstance;
use crate::commands::plugins::{
    activation_refusal_reason, construct_runtime_on_ui_thread, create_hosted_runtime,
    hold_plugin_runtime_gate, host_backend, HostBackend, VettedRegistryEntry,
};
use crate::host::native_bridge::{HostedPluginSlot, SharedHostedPlugin};
#[cfg(test)]
use crate::host::plugin_folder_grants::ForbiddenRoots;
use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::host::ui_thread::{release_on_ui_thread, UiThread};
use crate::state::AppState;
use daw_engine::midi::note_store::MidiNoteStore;
use daw_engine::offline::{OfflineRenderControl, OfflineRenderer};
use daw_engine::pdc::CompensationDelay;
use daw_engine::scheduler::{GraphCommand, HOSTED_PLUGIN_RESERVE};
use daw_plugin_host::{AudioPlugin, HostedPluginRuntime, HostedRuntime, ProcessMode};
use std::collections::{HashMap, VecDeque};
#[cfg(test)]
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

#[cfg(test)]
mod tests;

/// How long the control path waits for an offline instance's seam. Nothing
/// else holds it — the instance is this render's alone — so the bound only
/// stops a wedged plugin from parking the render forever.
const OFFLINE_CONTROL_TIMEOUT: Duration = Duration::from_secs(2);

/// How many cancels for renders that have not started yet are remembered.
///
/// A cancel can overtake its render — the two travel on separate calls — and
/// must still cancel it, so a cancel for an id no render holds is kept. It is
/// also what a cancel for a finished or unknown id looks like, so the record is
/// bounded and forgets the oldest first: a cancel that waited this long for a
/// render that never came was for nothing.
pub const PENDING_CANCEL_LIMIT: usize = 64;

/// How many finished render ids are remembered, so a cancel that arrives
/// after its render ended is recognised as late rather than kept for the next
/// render to reuse the id. Bounded and oldest-first, like the pending cancels.
pub const FINISHED_RENDER_LIMIT: usize = 64;

/// The longest render id a render or a cancel accepts, in bytes. Every
/// pending cancel and finished id is kept as a copy of one, so the bound is
/// what keeps those records small.
pub const RENDER_ID_MAX_BYTES: usize = 128;

/// The text every refused render id's error starts with.
pub const OFFLINE_RENDER_ID_INVALID: &str = "offline-render-id-invalid";

/// Refuse a render id that is empty or longer than [`RENDER_ID_MAX_BYTES`].
fn check_render_id(render_id: &str) -> Result<(), String> {
    if render_id.is_empty() {
        return Err(format!(
            "{OFFLINE_RENDER_ID_INVALID}: a render id must not be empty"
        ));
    }
    if render_id.len() > RENDER_ID_MAX_BYTES {
        return Err(format!(
            "{OFFLINE_RENDER_ID_INVALID}: a render id must be at most {RENDER_ID_MAX_BYTES} \
             bytes; this one is {}",
            render_id.len()
        ));
    }
    Ok(())
}

/// The text every cancelled render's error starts with — a contract the
/// renderer side matches on.
pub const OFFLINE_RENDER_CANCELLED: &str = "offline-render-cancelled";

/// The offline renders in flight, by the id their caller named, the cancels
/// that arrived before their render did, and the ids that recently finished.
#[derive(Debug, Default)]
pub struct OfflineRenders {
    in_flight: HashMap<String, Arc<OfflineRenderControl>>,
    pending_cancels: VecDeque<String>,
    recently_finished: VecDeque<String>,
}

impl OfflineRenders {
    /// Register a render under `render_id`, cancelled already if its cancel
    /// arrived first. Refused when a render under that id is still in flight:
    /// a cancel could not say which of the two it meant.
    fn begin(&mut self, render_id: &str) -> Result<Arc<OfflineRenderControl>, String> {
        if self.in_flight.contains_key(render_id) {
            return Err(format!(
                "offline-render-id-in-use: a render under id '{render_id}' is already in flight"
            ));
        }
        self.recently_finished
            .retain(|finished| finished != render_id);
        let control = Arc::new(OfflineRenderControl::default());
        if let Some(position) = self
            .pending_cancels
            .iter()
            .position(|pending| pending == render_id)
        {
            self.pending_cancels.remove(position);
            control.cancel();
        }
        self.in_flight
            .insert(render_id.to_string(), Arc::clone(&control));
        Ok(control)
    }

    /// Cancel the render under `render_id`, or remember the cancel for a
    /// render that has not started. Never an error: a render that already
    /// finished has nothing left to stop, so its late cancel is dropped rather
    /// than kept to cancel the next render that reuses the id.
    fn cancel(&mut self, render_id: &str) {
        if let Some(control) = self.in_flight.get(render_id) {
            control.cancel();
            return;
        }
        if self
            .recently_finished
            .iter()
            .any(|finished| finished == render_id)
        {
            return;
        }
        if self
            .pending_cancels
            .iter()
            .any(|pending| pending == render_id)
        {
            return;
        }
        if self.pending_cancels.len() == PENDING_CANCEL_LIMIT {
            self.pending_cancels.pop_front();
        }
        self.pending_cancels.push_back(render_id.to_string());
    }

    fn finish(&mut self, render_id: &str) {
        self.in_flight.remove(render_id);
        if self.recently_finished.len() == FINISHED_RENDER_LIMIT {
            self.recently_finished.pop_front();
        }
        self.recently_finished.push_back(render_id.to_string());
    }

    #[cfg(test)]
    pub(crate) fn pending_cancel_count(&self) -> usize {
        self.pending_cancels.len()
    }

    #[cfg(test)]
    pub(crate) fn in_flight(&self, render_id: &str) -> Option<Arc<OfflineRenderControl>> {
        self.in_flight.get(render_id).map(Arc::clone)
    }
}

/// One render's hold on its control: registered under its id while it runs,
/// and taken out of the registry however the render ends.
pub(crate) struct InFlightRender<'a> {
    control: Arc<OfflineRenderControl>,
    registration: Option<(&'a AppState, String)>,
}

impl<'a> InFlightRender<'a> {
    /// A render the caller named, so it can be cancelled; or, with no id, one
    /// nothing can cancel.
    pub(crate) fn begin(state: &'a AppState, render_id: Option<String>) -> Result<Self, String> {
        let Some(render_id) = render_id else {
            return Ok(Self::uncancellable());
        };
        check_render_id(&render_id)?;
        let control = state
            .offline_renders
            .lock()
            .map_err(|error| format!("Failed to lock offline renders: {error}"))?
            .begin(&render_id)?;
        Ok(Self {
            control,
            registration: Some((state, render_id)),
        })
    }

    /// A render no caller named, which nothing can cancel.
    pub(crate) fn uncancellable() -> Self {
        Self {
            control: Arc::new(OfflineRenderControl::default()),
            registration: None,
        }
    }

    pub(crate) fn control(&self) -> &OfflineRenderControl {
        &self.control
    }

    /// The refusal a cancelled render answers with, once it has stopped.
    pub(crate) fn cancelled(&self) -> String {
        let id = self
            .registration
            .as_ref()
            .map_or(String::new(), |(_, id)| format!(" '{id}'"));
        format!(
            "{OFFLINE_RENDER_CANCELLED}: render{id} was cancelled after {} frames; nothing was \
             returned",
            self.control.rendered_frames()
        )
    }
}

impl Drop for InFlightRender<'_> {
    fn drop(&mut self) {
        if let Some((state, render_id)) = self.registration.take() {
            match state.offline_renders.lock() {
                Ok(mut renders) => renders.finish(&render_id),
                Err(poisoned) => poisoned.into_inner().finish(&render_id),
            }
        }
    }
}

/// Cancel the offline render under `render_id`. A cancel before its render
/// starts still cancels it; one for a finished id does nothing.
pub fn cancel_graph_offline(render_id: String, state: &AppState) -> Result<(), String> {
    check_render_id(&render_id)?;
    state
        .offline_renders
        .lock()
        .map_err(|error| format!("Failed to lock offline renders: {error}"))?
        .cancel(&render_id);
    Ok(())
}

/// How an offline render reads a live instance's state, from the very runtime
/// whose load the offline instance is built from. The state is the world the
/// read happens in; production reads the runtime alone ([`read_live_state`]).
pub(crate) type CaptureState = fn(&SharedHostedPlugin, &AppState) -> Result<Vec<u8>, String>;

/// Read a live engine instance's state chunk: refused, not drained, while its
/// parameter writes wait for the live engine — what the state save does for
/// the same instance (`plugins::read_plugin_state_chunk`).
pub(crate) fn read_live_state(
    runtime: &SharedHostedPlugin,
    _state: &AppState,
) -> Result<Vec<u8>, String> {
    runtime.get_state_after_pending_parameters_drain(OFFLINE_CONTROL_TIMEOUT)
}

/// A test's look at every built instance just before the render.
#[cfg(test)]
pub(crate) type AfterBuild = Box<dyn Fn(&[Arc<SharedHostedPlugin>]) + Send + Sync>;

/// A test's change to the live records between the mapping and the build.
#[cfg(test)]
pub(crate) type AfterMapping = Box<dyn Fn(&AppState) + Send + Sync>;

/// How an offline render builds a runtime once its file is vetted.
pub(crate) type ConstructRuntime =
    fn(HostBackend, &str, &str, f64, ProcessMode) -> Result<HostedRuntime, String>;

/// What an offline render reaches the plugin world through. Production has
/// exactly one value ([`Self::production`]); a test swaps a seam to drive a
/// refusal no real plugin can be made to give, or vets against its own folder.
pub(crate) struct OfflinePluginSeams {
    pub(crate) scan_policy: PluginScanPolicy,
    pub(crate) capture_state: CaptureState,
    pub(crate) construct: ConstructRuntime,
    /// Run over every built instance just before the render, so a test can
    /// put one in a state no real plugin can be made to reach on cue.
    #[cfg(test)]
    pub(crate) after_build: Option<AfterBuild>,
    /// Run once the batch is mapped against the hosted instances and before
    /// any is built, so a test can change the live records in between.
    #[cfg(test)]
    pub(crate) after_mapping: Option<AfterMapping>,
    /// Run for each instance once it is constructed and the runtime gate is
    /// free again, just before its live state is restored into it.
    #[cfg(test)]
    pub(crate) before_restore: Option<Box<dyn Fn() + Send + Sync>>,
}

impl OfflinePluginSeams {
    /// The seams every export uses, built per render so the grant store is
    /// read fresh: a folder granted or revoked since the last export is what
    /// this one's re-vet enforces. The re-vet authorizes exactly what a live
    /// load does — the platform folders plus the user's granted folders — so a
    /// plugin loaded live from a granted folder is not refused at export.
    pub(crate) fn production() -> Self {
        Self::authorizing_by(PluginScanPolicy::production())
    }

    /// The production seams over the grant store at `store`, for tests that
    /// grant a folder of their own.
    #[cfg(test)]
    pub(crate) fn over_grant_store(store: Option<&Path>, forbidden: &ForbiddenRoots) -> Self {
        Self::authorizing_by(PluginScanPolicy::over_grant_store(
            crate::host::plugin_scan_policy::default_plugin_scan_roots(),
            store,
            forbidden,
        ))
    }

    fn authorizing_by(scan_policy: PluginScanPolicy) -> Self {
        Self {
            scan_policy,
            capture_state: read_live_state,
            construct: create_hosted_runtime,
            #[cfg(test)]
            after_build: None,
            #[cfg(test)]
            after_mapping: None,
            #[cfg(test)]
            before_restore: None,
        }
    }
}

/// One offline instance: the runtime owner the render's slot shares, under the
/// live instance's engine plugin id.
struct OfflinePluginInstance {
    bound: BoundHostedInstance,
    runtime: Arc<SharedHostedPlugin>,
    latency_frames: usize,
}

/// Every offline instance one render built, released on drop.
///
/// The renderer that processed them must already be gone when this drops —
/// [`super::graph`]'s render builds and drops it inside a call this value
/// outlives — so the reference held here is the last one, and its drop is the
/// plugin's teardown. That drop runs on the UI thread, or the runtime goes to
/// the retirement vec for the next sweep, exactly as
/// `plugins::tear_down_runtime_on_ui_thread` hands a runtime over: never here.
pub(crate) struct OfflinePluginInstances<'a> {
    instances: Vec<OfflinePluginInstance>,
    state: &'a AppState,
    ui: &'a dyn UiThread,
}

impl OfflinePluginInstances<'_> {
    /// Register every instance in `renderer` ahead of the mapped batch: the
    /// slot, then the instance's own latency, so the graph compensates every
    /// route it sits on from the first block.
    pub(crate) fn register(&self, renderer: &mut OfflineRenderer) -> Result<(), String> {
        for instance in &self.instances {
            let id = instance.bound.engine_plugin_id;
            renderer.push(GraphCommand::AddHostedPlugin(
                id,
                Box::new(HostedPluginSlot::new(Arc::clone(&instance.runtime))),
                MidiNoteStore::new(),
            ))?;
            renderer.push(GraphCommand::SetEffectLatency {
                effect_id: id,
                latency_frames: instance.latency_frames,
                dry_delay: CompensationDelay::for_latency(instance.latency_frames),
            })?;
        }
        Ok(())
    }

    /// Commands [`Self::register`] pushes, for sizing the renderer's ring.
    pub(crate) fn command_count(&self) -> usize {
        self.instances.len() * 2
    }

    /// Leave every instance's processing state. Called by the render thread
    /// after the render's last block, cancelled or not — through
    /// [`leaves_processing_on_drop`], so no way out of the block loop skips it.
    fn leave_processing(&self) {
        for instance in &self.instances {
            instance.runtime.leave_processing_after_last_block();
        }
    }

    /// Refuse a print in which any instance missed a block or failed one.
    ///
    /// A block the slot could not serve passed through dry; a block the plugin
    /// was served but answered with a process failure (CLAP's
    /// `CLAP_PROCESS_ERROR`, a VST3 `process` that did not return `kResultOk`)
    /// was passed through dry or silenced by its wrapper; and a block handed to
    /// a plugin that refused to start processing (CLAP `start_processing`, VST3
    /// `setProcessing(true)`) was passed through untouched. Either way the print
    /// has a hole in it and is not the project. Called after the last block,
    /// once the render thread has left every instance's processing state, so
    /// the control-path read of the wrapper's failure latch sees every block.
    pub(crate) fn ensure_every_block_processed(&self) -> Result<(), String> {
        for instance in &self.instances {
            let missed = instance.runtime.unserved_blocks();
            if missed > 0 {
                return Err(refusal(
                    &instance.bound,
                    &format!(
                        "it was not served {missed} block(s) of the render, which would pass \
                         through dry"
                    ),
                ));
            }
            let (failed, never_processing) = instance
                .runtime
                .with_control(OFFLINE_CONTROL_TIMEOUT, |plugin| {
                    Ok((
                        plugin.has_failed_a_process_call(),
                        plugin.has_passed_a_block_unprocessed(),
                    ))
                })
                .map_err(|reason| {
                    refusal(
                        &instance.bound,
                        &format!("whether it processed every block could not be read: {reason}"),
                    )
                })?;
            if failed {
                return Err(refusal(
                    &instance.bound,
                    "it failed to process a block of the render, which its host passed through \
                     unprocessed",
                ));
            }
            if never_processing {
                return Err(refusal(
                    &instance.bound,
                    "it refused to start processing, so its host passed blocks of the render \
                     through unprocessed",
                ));
            }
        }
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn runtimes(&self) -> Vec<Arc<SharedHostedPlugin>> {
        self.instances
            .iter()
            .map(|instance| Arc::clone(&instance.runtime))
            .collect()
    }
}

impl Drop for OfflinePluginInstances<'_> {
    fn drop(&mut self) {
        for instance in self.instances.drain(..) {
            if let Err((runtime, reason)) = release_on_ui_thread(self.ui, instance.runtime) {
                eprintln!(
                    "[Plugin] offline instance of '{}' teardown deferred to the next sweep: \
                     {reason}",
                    instance.bound.plugin_name
                );
                self.state.retain_retired_engine_plugin(runtime);
            }
        }
    }
}

/// One live engine record as the render read it: the runtime and the load it
/// was vetted from, taken together under one `engine_plugins` lock.
struct LiveRecord {
    instance_id: String,
    runtime: Arc<SharedHostedPlugin>,
    load_resolution: VettedRegistryEntry,
}

/// Take every bound instance's live record under one lock, refusing by name an
/// instance whose record is gone, or is no longer the plugin the batch was
/// mapped against — an unload and a reload under the same id can land between
/// the mapping and this read, and could be another plugin or an instrument.
fn live_records(
    bound: &[BoundHostedInstance],
    state: &AppState,
) -> Result<Vec<LiveRecord>, String> {
    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(|error| format!("Failed to lock engine plugins: {error}"))?;
    bound
        .iter()
        .map(|instance| {
            let Some(record) = engine_plugins.get(&instance.instance_id) else {
                return Err(refusal(
                    instance,
                    "its live instance was unloaded while the render started",
                ));
            };
            let mapped_under = record.engine_plugin_id == instance.engine_plugin_id
                && record.chain_kind == instance.chain_kind
                && record.name == instance.plugin_name;
            if !mapped_under {
                return Err(refusal(
                    instance,
                    "its live instance was replaced while the render started",
                ));
            }
            Ok(LiveRecord {
                instance_id: instance.instance_id.clone(),
                runtime: Arc::clone(&record.runtime),
                load_resolution: record.load_resolution.clone(),
            })
        })
        .collect()
}

/// Give back the render's reference to a live runtime once its state is read.
///
/// The reference is dropped under the `engine_plugins` lock while the record
/// still holds the same runtime, so it cannot be the final one. A runtime its
/// record no longer holds may be the last reference, and a plugin's teardown
/// must not run on this worker: it goes to the retirement vec for the sweep.
fn return_live_runtime(instance_id: &str, runtime: Arc<SharedHostedPlugin>, state: &AppState) {
    let engine_plugins = match state.engine_plugins.lock() {
        Ok(engine_plugins) => engine_plugins,
        Err(poisoned) => poisoned.into_inner(),
    };
    let still_recorded = engine_plugins
        .get(instance_id)
        .is_some_and(|record| Arc::ptr_eq(&record.runtime, &runtime));
    if still_recorded {
        drop(runtime);
        return;
    }
    drop(engine_plugins);
    state.retain_retired_engine_plugin(runtime);
}

/// Read one live runtime's state for `instance`, refusing by name.
fn capture_live_state(
    instance: &BoundHostedInstance,
    runtime: &SharedHostedPlugin,
    state: &AppState,
    seams: &OfflinePluginSeams,
) -> Result<Vec<u8>, String> {
    if runtime.has_pending_parameter_writes() {
        return Err(refusal(
            instance,
            "its live state could not be read: the plugin has parameter writes pending that the \
             live engine has not processed yet",
        ));
    }
    (seams.capture_state)(runtime, state).map_err(|reason| {
        refusal(
            instance,
            &format!("its live state could not be read: {reason}"),
        )
    })
}

/// Leaves every offline instance's processing state when dropped; see
/// [`leaves_processing_on_drop`]. A drop runs once, so
/// the state is left exactly once.
pub(crate) struct LeavesProcessing<'plugins, 'state>(
    Option<&'plugins OfflinePluginInstances<'state>>,
);

/// Taken by the render thread before the first block: its drop leaves every
/// instance's processing state on that thread, however the render ends — the
/// last block, a cancel, a `?` or a panic unwinding through it.
pub(crate) fn leaves_processing_on_drop<'plugins, 'state>(
    plugins: Option<&'plugins OfflinePluginInstances<'state>>,
) -> LeavesProcessing<'plugins, 'state> {
    LeavesProcessing(plugins)
}

impl Drop for LeavesProcessing<'_, '_> {
    fn drop(&mut self) {
        if let Some(plugins) = self.0 {
            plugins.leave_processing();
        }
    }
}

/// The refusal for one instance, by device and plugin.
fn refusal(bound: &BoundHostedInstance, reason: &str) -> String {
    format!(
        "offline-render-plugin: device '{}' (plugin '{}') cannot render offline: {reason}",
        bound.device_id, bound.plugin_name
    )
}

/// Build an offline instance of every bound effect, at `sample_rate`, with the
/// live instance's state restored on it.
///
/// Every live state is captured first, at render start, so the print is one
/// moment of the session rather than a smear across the constructions. A
/// refusal partway releases whatever was already built.
pub(crate) async fn build_offline_instances<'a>(
    bound: &[BoundHostedInstance],
    sample_rate: f64,
    state: &'a AppState,
    ui: &'a dyn UiThread,
    seams: &OfflinePluginSeams,
) -> Result<OfflinePluginInstances<'a>, String> {
    let mut built = OfflinePluginInstances {
        instances: Vec::with_capacity(bound.len()),
        state,
        ui,
    };
    if bound.is_empty() {
        return Ok(built);
    }
    // The offline effect table reserves the hosted instances a session may
    // hold; a render binding more than that would be refused by the table.
    if bound.len() > HOSTED_PLUGIN_RESERVE {
        return Err(format!(
            "offline-render-plugin: the render binds {} hosted effects, past the {} the offline \
             effect table reserves for hosted plugins",
            bound.len(),
            HOSTED_PLUGIN_RESERVE
        ));
    }

    // Every state is captured before anything is constructed, each from the
    // runtime its load came with. Every live reference is given back, the ones
    // after a refusal included.
    let mut records = live_records(bound, state)?.into_iter();
    let mut captured = Vec::with_capacity(bound.len());
    let mut refused = None;
    for (instance, record) in bound.iter().zip(records.by_ref()) {
        let chunk = capture_live_state(instance, &record.runtime, state, seams);
        return_live_runtime(&record.instance_id, record.runtime, state);
        match chunk {
            Ok(chunk) => captured.push((chunk, record.load_resolution)),
            Err(reason) => {
                refused = Some(reason);
                break;
            }
        }
    }
    for record in records {
        return_live_runtime(&record.instance_id, record.runtime, state);
    }
    if let Some(reason) = refused {
        return Err(reason);
    }

    for (instance, (chunk, vetted)) in bound.iter().zip(captured) {
        let backend =
            host_backend(&vetted.entry.format).map_err(|reason| refusal(instance, &reason))?;
        // The gate spans this instance's vet and construction only: released
        // here, before the state restore and before any refusal tears down the
        // instances already built — the order a load's refusal keeps.
        let runtime = {
            let _runtime_gate = hold_plugin_runtime_gate().await;
            construct_runtime_on_ui_thread(
                ui,
                backend,
                seams.scan_policy.clone(),
                vetted,
                sample_rate,
                ProcessMode::Offline,
                seams.construct,
            )
        }
        .map_err(|reason| refusal(instance, &reason))?;
        let activated = runtime.is_activated();
        let shared = Arc::new(SharedHostedPlugin::new(runtime));
        built.instances.push(OfflinePluginInstance {
            bound: instance.clone(),
            runtime: Arc::clone(&shared),
            latency_frames: 0,
        });
        if !activated {
            return Err(refusal(
                instance,
                &activation_refusal_reason(&instance.plugin_name),
            ));
        }
        #[cfg(test)]
        if let Some(before_restore) = &seams.before_restore {
            before_restore();
        }
        let latency_frames = shared
            .with_control(OFFLINE_CONTROL_TIMEOUT, |plugin| {
                AudioPlugin::set_state(plugin, &chunk)
                    .map_err(|reason| format!("its live state could not be restored: {reason}"))?;
                Ok(<HostedRuntime as HostedPluginRuntime>::latency_samples(plugin) as usize)
            })
            .map_err(|reason| refusal(instance, &reason))?;
        if let Some(last) = built.instances.last_mut() {
            last.latency_frames = latency_frames;
        }
    }
    #[cfg(test)]
    if let Some(after_build) = &seams.after_build {
        after_build(&built.runtimes());
    }
    Ok(built)
}
