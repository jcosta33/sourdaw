//! An offline render's own hosted plugin instances, and the renders in flight.
//!
//! A print contains the hosted effects its strips carry, so an offline render
//! cannot borrow the live instances: those run on the device's clock, at its
//! rate, in real-time mode, inside the live engine. It hosts an independent
//! offline instance of each engine-attached effect a sounding strip names
//! instead, built here for that render alone and released when it ends.
//!
//! The live instance is touched exactly once, by the state read that captures
//! what the user set on it (`plugins::read_plugin_state_chunk`, which drains
//! the parameter writes still pending first). It is never reactivated,
//! re-rated, re-moded or spliced into the render.
//!
//! Each offline instance is built the way a load builds one: on the shell's UI
//! thread, from the very file the live instance's load vetted, re-vetted
//! against the same fingerprint, under `PLUGIN_RUNTIME_GATE` in read mode
//! (`plugins::construct_runtime_on_ui_thread`). It is activated at the export
//! rate in [`ProcessMode::Offline`], and the captured state is restored on the
//! control path before the render. Every failure refuses the render by device
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
    hold_plugin_runtime_gate, host_backend, read_plugin_state_chunk, HostBackend,
};
use crate::host::native_bridge::{HostedPluginSlot, SharedHostedPlugin};
use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::host::ui_thread::{release_on_ui_thread, UiThread};
use crate::state::AppState;
use daw_engine::midi::note_store::MidiNoteStore;
use daw_engine::offline::{OfflineRenderControl, OfflineRenderer};
use daw_engine::pdc::CompensationDelay;
use daw_engine::scheduler::{GraphCommand, HOSTED_PLUGIN_RESERVE};
use daw_plugin_host::{AudioPlugin, HostedPluginRuntime, HostedRuntime, ProcessMode};
use std::collections::{HashMap, VecDeque};
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

/// The text every cancelled render's error starts with — a contract the
/// renderer side matches on.
pub const OFFLINE_RENDER_CANCELLED: &str = "offline-render-cancelled";

/// The offline renders in flight, by the id their caller named, and the
/// cancels that arrived before their render did.
#[derive(Debug, Default)]
pub struct OfflineRenders {
    in_flight: HashMap<String, Arc<OfflineRenderControl>>,
    pending_cancels: VecDeque<String>,
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
    /// finished has nothing left to stop.
    fn cancel(&mut self, render_id: &str) {
        if let Some(control) = self.in_flight.get(render_id) {
            control.cancel();
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
/// starts still cancels it; one for an unknown or finished id does nothing.
pub fn cancel_graph_offline(render_id: String, state: &AppState) -> Result<(), String> {
    state
        .offline_renders
        .lock()
        .map_err(|error| format!("Failed to lock offline renders: {error}"))?
        .cancel(&render_id);
    Ok(())
}

/// How an offline render reads a live instance's state.
pub(crate) type CaptureState = fn(&str, &AppState) -> Result<Vec<u8>, String>;

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
    pub(crate) after_build: Option<fn(&[Arc<SharedHostedPlugin>])>,
}

impl OfflinePluginSeams {
    pub(crate) fn production() -> Self {
        Self {
            scan_policy: PluginScanPolicy::platform_defaults(),
            capture_state: read_plugin_state_chunk,
            construct: create_hosted_runtime,
            #[cfg(test)]
            after_build: None,
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
    /// after the render's last block, cancelled or not.
    pub(crate) fn leave_processing(&self) {
        for instance in &self.instances {
            instance.runtime.leave_processing_after_last_block();
        }
    }

    /// Refuse a print in which any instance missed a block: that block passed
    /// through dry, and a print with a dry hole in it is not the project.
    pub(crate) fn ensure_every_block_served(&self) -> Result<(), String> {
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

    let mut captured = Vec::with_capacity(bound.len());
    for instance in bound {
        let chunk = (seams.capture_state)(&instance.instance_id, state).map_err(|reason| {
            refusal(
                instance,
                &format!("its live state could not be read: {reason}"),
            )
        })?;
        captured.push(chunk);
    }

    let load_resolutions = {
        let engine_plugins = state
            .engine_plugins
            .lock()
            .map_err(|error| format!("Failed to lock engine plugins: {error}"))?;
        bound
            .iter()
            .map(|instance| {
                engine_plugins
                    .get(&instance.instance_id)
                    .map(|record| record.load_resolution.clone())
                    .ok_or_else(|| {
                        refusal(
                            instance,
                            "its live instance was unloaded while the render started",
                        )
                    })
            })
            .collect::<Result<Vec<_>, String>>()?
    };

    // Declared after `built`, so a refusal releases the gate before the
    // instances already built are torn down — the order a load's refusal keeps.
    let _runtime_gate = hold_plugin_runtime_gate().await;
    for ((instance, chunk), vetted) in bound.iter().zip(captured).zip(load_resolutions) {
        let backend =
            host_backend(&vetted.entry.format).map_err(|reason| refusal(instance, &reason))?;
        let runtime = construct_runtime_on_ui_thread(
            ui,
            backend,
            seams.scan_policy.clone(),
            vetted,
            sample_rate,
            ProcessMode::Offline,
            seams.construct,
        )
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
    if let Some(after_build) = seams.after_build {
        after_build(&built.runtimes());
    }
    Ok(built)
}
