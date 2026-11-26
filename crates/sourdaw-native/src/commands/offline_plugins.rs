//! An offline render's own hosted plugin instances, and the renders in flight.
//!
//! A print contains the hosted effects and instruments its strips carry, so an
//! offline render cannot borrow the live instances: those run on the device's
//! clock, at its rate, in real-time mode, inside the live engine. It hosts an
//! independent offline instance of each engine-attached effect or instrument a
//! sounding strip names instead, built here for that render alone and released
//! when it ends. An instrument sounds the notes the batch schedules on it,
//! through the note store its slot is registered with.
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
    hold_plugin_runtime_gate, host_backend, HostBackend, PluginCommandError, PreOpenChecks,
    VettedRegistryEntry,
};
use crate::host::native_bridge::{HostedPluginSlot, PluginControlRefusal, SharedHostedPlugin};
#[cfg(test)]
use crate::host::plugin_folder_grants::ForbiddenRoots;
use crate::host::plugin_scan_policy::PluginScanPolicy;
use crate::host::ui_thread::{release_on_ui_thread, UiThread};
use crate::state::AppState;
use daw_engine::midi::note_store::{MidiNoteStore, MIDI_NOTE_STORE_CAPACITY};
use daw_engine::offline::{OfflineCommandError, OfflineRenderControl, OfflineRenderer};
use daw_engine::pdc::CompensationDelay;
use daw_engine::scheduler::{GraphCommand, HOSTED_PLUGIN_RESERVE};
use daw_plugin_host::{AudioPlugin, HostedPluginRuntime, HostedRuntime, PluginError, ProcessMode};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fmt;
#[cfg(test)]
use std::path::Path;
use std::sync::{Arc, PoisonError};
use std::time::Duration;

#[cfg(test)]
mod tests;

/// The most note events one instrument may be scheduled across an offline
/// render, which bounds the memory its note store reserves.
///
/// An offline render holds the whole arrangement at once where live playback
/// streams a few seconds of it, so the live store's reserve
/// ([`MIDI_NOTE_STORE_CAPACITY`]) is no song-length limit there and the store
/// is sized from what the batch sends instead. A store reserves two buffers
/// (entries and the merge's scratch) of 64-byte `TimedMidiNote`s, so at this
/// ceiling one instrument costs 2 * 2^18 * 64 B = 32 MiB, reserved on the
/// control thread before the first block. 2^18 events is 131,072 notes, a
/// dense part many hours long.
pub(crate) const OFFLINE_NOTE_EVENT_CEILING: usize = 1 << 18;

/// Note events an offline render schedules, by the engine plugin id they are
/// scheduled at.
pub(crate) type ScheduledNoteEvents = BTreeMap<usize, usize>;

/// The note store an offline instrument is registered with for `events`
/// scheduled events: the live reserve, or more when the batch needs it.
///
/// Built on the control thread, ahead of the first block (ADR 0020).
pub(crate) fn offline_note_store(events: usize) -> Box<MidiNoteStore> {
    MidiNoteStore::with_capacity(events.max(MIDI_NOTE_STORE_CAPACITY))
}

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
fn check_render_id(render_id: &str) -> Result<(), OfflineRenderError> {
    if render_id.is_empty() {
        return Err(OfflineRenderError::RenderIdEmpty);
    }
    if render_id.len() > RENDER_ID_MAX_BYTES {
        return Err(OfflineRenderError::RenderIdTooLong {
            length: render_id.len(),
        });
    }
    Ok(())
}

/// The text every cancelled render's error starts with — a contract the
/// renderer side matches on.
pub const OFFLINE_RENDER_CANCELLED: &str = "offline-render-cancelled";

/// How many offline renders may be in flight at once, named or not.
///
/// One export plus one agent render are the most the renderer's render lock
/// lets run together, and each may hold a full-length output buffer.
pub const MAX_OFFLINE_RENDERS_IN_FLIGHT: usize = 2;

/// The text a render refused for want of a slot starts with.
pub const OFFLINE_RENDER_LIMIT_REACHED: &str = "offline-render-limit-reached";

/// The text a render refused once quit has cancelled every render starts with.
pub const OFFLINE_RENDER_CLOSED: &str = "offline-render-closed";

/// Why an offline render, or a cancel of one, refused.
///
/// `Display` is the text the renderer receives, byte-identical to the text it
/// replaced (ADR 0059); `isNativeOfflineRenderCancelled.ts` matches the
/// [`OFFLINE_RENDER_CANCELLED`] prefix of [`Self::Cancelled`].
#[derive(Debug)]
pub(crate) enum OfflineRenderError {
    RenderIdEmpty,
    RenderIdTooLong {
        length: usize,
    },
    /// Every slot is held ([`MAX_OFFLINE_RENDERS_IN_FLIGHT`]).
    LimitReached,
    /// Quit has cancelled every render and refuses every later one.
    Closed,
    RenderIdInUse {
        render_id: String,
    },
    /// A state store's mutex was poisoned.
    Lock {
        store: &'static str,
        cause: String,
    },
    Cancelled {
        render_id: Option<String>,
        frames: usize,
    },
    /// The offline renderer refused a command.
    Command(OfflineCommandError),
    TooManyPlugins {
        count: usize,
    },
    /// One instance refused, named by device and plugin. Boxed so the refusal's
    /// own sources do not size every render result.
    Plugin {
        device_id: String,
        plugin_name: String,
        refusal: Box<OfflinePluginRefusal>,
    },
}

impl OfflineRenderError {
    fn lock<Guard>(store: &'static str) -> impl FnOnce(PoisonError<Guard>) -> Self {
        move |error| Self::Lock {
            store,
            cause: error.to_string(),
        }
    }
}

impl fmt::Display for OfflineRenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::RenderIdEmpty => write!(
                f,
                "{OFFLINE_RENDER_ID_INVALID}: a render id must not be empty"
            ),
            Self::RenderIdTooLong { length } => write!(
                f,
                "{OFFLINE_RENDER_ID_INVALID}: a render id must be at most {RENDER_ID_MAX_BYTES} \
                 bytes; this one is {length}"
            ),
            Self::LimitReached => write!(
                f,
                "{OFFLINE_RENDER_LIMIT_REACHED}: {MAX_OFFLINE_RENDERS_IN_FLIGHT} offline renders \
                 are already in flight; this one was refused before anything was mapped or \
                 built for it"
            ),
            Self::Closed => write!(
                f,
                "{OFFLINE_RENDER_CLOSED}: the application is quitting, so no offline render starts"
            ),
            Self::RenderIdInUse { render_id } => write!(
                f,
                "offline-render-id-in-use: a render under id '{render_id}' is already in flight"
            ),
            Self::Lock { store, cause } => write!(f, "Failed to lock {store}: {cause}"),
            Self::Cancelled { render_id, frames } => {
                write!(f, "{OFFLINE_RENDER_CANCELLED}: render")?;
                if let Some(render_id) = render_id {
                    write!(f, " '{render_id}'")?;
                }
                write!(
                    f,
                    " was cancelled after {frames} frames; nothing was returned"
                )
            }
            Self::Command(error) => write!(f, "{error}"),
            Self::TooManyPlugins { count } => write!(
                f,
                "offline-render-plugin: the render binds {count} hosted effects, past the {} \
                 the offline effect table reserves for hosted plugins",
                HOSTED_PLUGIN_RESERVE
            ),
            Self::Plugin {
                device_id,
                plugin_name,
                refusal,
            } => write!(
                f,
                "offline-render-plugin: device '{device_id}' (plugin '{plugin_name}') cannot \
                 render offline: {refusal}"
            ),
        }
    }
}

impl std::error::Error for OfflineRenderError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Command(error) => Some(error),
            Self::Plugin { refusal, .. } => Some(refusal.as_ref()),
            _ => None,
        }
    }
}

/// Why one offline instance refused the render.
#[derive(Debug)]
pub(crate) enum OfflinePluginRefusal {
    Unserved {
        missed: u64,
    },
    /// The control path could not read the wrapper's failure latch.
    ProcessingUnreadable(PluginControlRefusal),
    FailedABlock,
    NeverStartedProcessing,
    Unloaded,
    Replaced,
    PendingParameterWrites,
    StateUnreadable(PluginCommandError),
    /// Resolving the backend, constructing or activating the instance.
    Load(PluginCommandError),
    StateNotRestored(PluginError),
    /// The control path's own refusal while restoring the state.
    Control(PluginControlRefusal),
}

impl fmt::Display for OfflinePluginRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unserved { missed } => write!(
                f,
                "it was not served {missed} block(s) of the render, which would pass through dry"
            ),
            Self::ProcessingUnreadable(reason) => write!(
                f,
                "whether it processed every block could not be read: {reason}"
            ),
            Self::FailedABlock => f.write_str(
                "it failed to process a block of the render, which its host passed through \
                 unprocessed",
            ),
            Self::NeverStartedProcessing => f.write_str(
                "it refused to start processing, so its host passed blocks of the render \
                 through unprocessed",
            ),
            Self::Unloaded => {
                f.write_str("its live instance was unloaded while the render started")
            }
            Self::Replaced => {
                f.write_str("its live instance was replaced while the render started")
            }
            Self::PendingParameterWrites => f.write_str(
                "its live state could not be read: the plugin has parameter writes pending that \
                 the live engine has not processed yet",
            ),
            Self::StateUnreadable(reason) => {
                write!(f, "its live state could not be read: {reason}")
            }
            Self::Load(reason) => write!(f, "{reason}"),
            Self::StateNotRestored(reason) => {
                write!(f, "its live state could not be restored: {reason}")
            }
            Self::Control(refusal) => write!(f, "{refusal}"),
        }
    }
}

impl std::error::Error for OfflinePluginRefusal {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::StateUnreadable(error) | Self::Load(error) => Some(error),
            Self::StateNotRestored(error) => Some(error),
            Self::ProcessingUnreadable(refusal) | Self::Control(refusal) => Some(refusal),
            _ => None,
        }
    }
}

/// The offline renders in flight — every admitted one, and by the id their
/// caller named the ones that have one — the cancels that arrived before their
/// render did, and the ids that recently finished.
#[derive(Debug, Default)]
pub struct OfflineRenders {
    admitted: Vec<Arc<OfflineRenderControl>>,
    /// Set once quit has cancelled every render: nothing is admitted after.
    closed: bool,
    in_flight: HashMap<String, Arc<OfflineRenderControl>>,
    pending_cancels: VecDeque<String>,
    recently_finished: VecDeque<String>,
}

impl OfflineRenders {
    /// Take one of the [`MAX_OFFLINE_RENDERS_IN_FLIGHT`] slots for a render,
    /// registering it under `render_id` when it has one. Refused by name, with
    /// nothing taken, when every slot is held or the id is in use.
    fn admit(
        &mut self,
        render_id: Option<&str>,
    ) -> Result<Arc<OfflineRenderControl>, OfflineRenderError> {
        if self.closed {
            return Err(OfflineRenderError::Closed);
        }
        if self.admitted.len() >= MAX_OFFLINE_RENDERS_IN_FLIGHT {
            return Err(OfflineRenderError::LimitReached);
        }
        let control = match render_id {
            Some(render_id) => self.begin(render_id)?,
            None => Arc::new(OfflineRenderControl::default()),
        };
        self.admitted.push(Arc::clone(&control));
        Ok(control)
    }

    /// Cancel every admitted render, named or not, and admit none after: what
    /// quit does, so nothing renders on past the plugin drain.
    fn cancel_all(&mut self) {
        self.closed = true;
        for control in &self.admitted {
            control.cancel();
        }
    }

    /// How many renders hold a slot.
    fn admitted_count(&self) -> usize {
        self.admitted.len()
    }

    /// Give back the slot [`Self::admit`] handed `control`, and finish its id.
    fn release(&mut self, control: &Arc<OfflineRenderControl>, render_id: Option<&str>) {
        self.admitted
            .retain(|admitted| !Arc::ptr_eq(admitted, control));
        if let Some(render_id) = render_id {
            self.finish(render_id);
        }
    }

    /// Register a render under `render_id`, cancelled already if its cancel
    /// arrived first. Refused when a render under that id is still in flight:
    /// a cancel could not say which of the two it meant.
    fn begin(&mut self, render_id: &str) -> Result<Arc<OfflineRenderControl>, OfflineRenderError> {
        if self.in_flight.contains_key(render_id) {
            return Err(OfflineRenderError::RenderIdInUse {
                render_id: render_id.to_string(),
            });
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

/// One render's hold on its slot and its control: admitted, and registered
/// under its id when it has one, while it runs, and given back however the
/// render ends.
pub(crate) struct InFlightRender<'a> {
    control: Arc<OfflineRenderControl>,
    admission: Option<Admission<'a>>,
}

/// The registry a render was admitted to, and the id it was registered under.
struct Admission<'a> {
    state: &'a AppState,
    render_id: Option<String>,
}

impl<'a> InFlightRender<'a> {
    /// Admit a render, refused by name past [`MAX_OFFLINE_RENDERS_IN_FLIGHT`].
    /// One the caller named can be cancelled by that id.
    pub(crate) fn begin(
        state: &'a AppState,
        render_id: Option<String>,
    ) -> Result<Self, OfflineRenderError> {
        if let Some(render_id) = &render_id {
            check_render_id(render_id)?;
        }
        let control = state
            .offline_renders
            .lock()
            .map_err(OfflineRenderError::lock("offline renders"))?
            .admit(render_id.as_deref())?;
        Ok(Self {
            control,
            admission: Some(Admission { state, render_id }),
        })
    }

    /// A render outside the registry, which takes no slot and nothing can
    /// cancel.
    #[cfg(test)]
    pub(crate) fn uncancellable() -> Self {
        Self {
            control: Arc::new(OfflineRenderControl::default()),
            admission: None,
        }
    }

    pub(crate) fn control(&self) -> &OfflineRenderControl {
        &self.control
    }

    /// The control a closure that outlives this borrow reads the cancel from.
    fn shared_control(&self) -> Arc<OfflineRenderControl> {
        Arc::clone(&self.control)
    }

    /// The refusal a cancelled render answers with, once it has stopped.
    pub(crate) fn cancelled(&self) -> OfflineRenderError {
        OfflineRenderError::Cancelled {
            render_id: self
                .admission
                .as_ref()
                .and_then(|admission| admission.render_id.clone()),
            frames: self.control.rendered_frames(),
        }
    }
}

impl Drop for InFlightRender<'_> {
    fn drop(&mut self) {
        let Some(admission) = self.admission.take() else {
            return;
        };
        let render_id = admission.render_id.as_deref();
        match admission.state.offline_renders.lock() {
            Ok(mut renders) => renders.release(&self.control, render_id),
            Err(poisoned) => poisoned.into_inner().release(&self.control, render_id),
        }
    }
}

/// Cancel the offline render under `render_id`. A cancel before its render
/// starts still cancels it; one for a finished id does nothing.
pub fn cancel_graph_offline(render_id: String, state: &AppState) -> Result<(), String> {
    cancel_render(&render_id, state).map_err(|error| error.to_string())
}

fn cancel_render(render_id: &str, state: &AppState) -> Result<(), OfflineRenderError> {
    check_render_id(render_id)?;
    state
        .offline_renders
        .lock()
        .map_err(OfflineRenderError::lock("offline renders"))?
        .cancel(render_id);
    Ok(())
}

/// Cancel every offline render in flight and refuse every later one: the first
/// step of the quit cascade (`shutdown::shutdown`). A poisoned registry is
/// still cancelled: quit must not leave a render running because another
/// panicked.
pub(crate) fn cancel_every_offline_render(state: &AppState) {
    match state.offline_renders.lock() {
        Ok(mut renders) => renders.cancel_all(),
        Err(poisoned) => poisoned.into_inner().cancel_all(),
    }
}

/// How many offline renders still hold a slot, or `None` while a render holds
/// the registry: the quit cascade polls this rather than wait on a lock a
/// render needs to give its slot back.
pub(crate) fn offline_renders_in_flight(state: &AppState) -> Option<usize> {
    match state.offline_renders.try_lock() {
        Ok(renders) => Some(renders.admitted_count()),
        Err(std::sync::TryLockError::Poisoned(poisoned)) => {
            Some(poisoned.into_inner().admitted_count())
        }
        Err(std::sync::TryLockError::WouldBlock) => None,
    }
}

/// How an offline render reads a live instance's state, from the very runtime
/// whose load the offline instance is built from. The state is the world the
/// read happens in; production reads the runtime alone ([`read_live_state`]).
pub(crate) type CaptureState = fn(
    &SharedHostedPlugin,
    &AppState,
    &OfflineRenderControl,
) -> Result<Vec<u8>, PluginCommandError>;

/// Read a live engine instance's state chunk: refused, not drained, while its
/// parameter writes wait for the live engine — what the state save does for
/// the same instance (`plugins::read_plugin_state_chunk`). The wait for the
/// instance's control gate is the state save's own, deadline and verdict
/// included, except that it ends when `render_control` is cancelled.
pub(crate) fn read_live_state(
    runtime: &SharedHostedPlugin,
    _state: &AppState,
    render_control: &OfflineRenderControl,
) -> Result<Vec<u8>, PluginCommandError> {
    runtime
        .get_state_after_pending_parameters_drain_unless(OFFLINE_CONTROL_TIMEOUT, &|| {
            render_control.is_cancelled()
        })
        .map_err(PluginCommandError::StateRead)
}

/// A test's look at every built instance just before the render.
#[cfg(test)]
pub(crate) type AfterBuild = Box<dyn Fn(&[Arc<SharedHostedPlugin>]) + Send + Sync>;

/// A test's change to the live records between the mapping and the build.
#[cfg(test)]
pub(crate) type AfterMapping = Box<dyn Fn(&AppState) + Send + Sync>;

/// How an offline render builds a runtime once its file is vetted.
pub(crate) type ConstructRuntime =
    fn(HostBackend, &str, &str, f64, ProcessMode) -> Result<HostedRuntime, PluginError>;

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
    /// Run once the render holds its slot and before it maps anything, so a
    /// test can hold the slot.
    #[cfg(test)]
    pub(crate) after_admission: Option<Box<dyn Fn() + Send + Sync>>,
    /// Run once the batch is mapped against the hosted instances and before
    /// any is built, so a test can change the live records in between.
    #[cfg(test)]
    pub(crate) after_mapping: Option<AfterMapping>,
    /// Run for each instance once it is constructed and the runtime gate is
    /// free again, just before its live state is restored into it.
    #[cfg(test)]
    pub(crate) before_restore: Option<Box<dyn Fn() + Send + Sync>>,
    /// Run for each instance just before its build waits on the runtime gate,
    /// so a test can cancel the render while it waits there.
    #[cfg(test)]
    pub(crate) before_runtime_gate: Option<Box<dyn Fn() + Send + Sync>>,
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
            after_admission: None,
            #[cfg(test)]
            after_mapping: None,
            #[cfg(test)]
            before_restore: None,
            #[cfg(test)]
            before_runtime_gate: None,
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
    ///
    /// Each instance's note store is sized from the events the batch schedules
    /// at it (`scheduled`), so a part longer than the live reserve prints whole.
    pub(crate) fn register(
        &self,
        renderer: &mut OfflineRenderer,
        scheduled: &ScheduledNoteEvents,
    ) -> Result<(), OfflineRenderError> {
        for instance in &self.instances {
            let id = instance.bound.engine_plugin_id;
            let events = scheduled.get(&id).copied().unwrap_or(0);
            renderer
                .push(GraphCommand::AddHostedPlugin(
                    id,
                    Box::new(HostedPluginSlot::new(Arc::clone(&instance.runtime))),
                    offline_note_store(events),
                ))
                .map_err(OfflineRenderError::Command)?;
            renderer
                .push(GraphCommand::SetEffectLatency {
                    effect_id: id,
                    latency_frames: instance.latency_frames,
                    dry_delay: CompensationDelay::for_latency(instance.latency_frames),
                })
                .map_err(OfflineRenderError::Command)?;
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
    pub(crate) fn ensure_every_block_processed(&self) -> Result<(), OfflineRenderError> {
        for instance in &self.instances {
            let missed = instance.runtime.unserved_blocks();
            if missed > 0 {
                return Err(refusal(
                    &instance.bound,
                    OfflinePluginRefusal::Unserved { missed },
                ));
            }
            let (failed, never_processing) = instance
                .runtime
                .with_control(OFFLINE_CONTROL_TIMEOUT, |plugin| {
                    Ok::<_, std::convert::Infallible>((
                        plugin.has_failed_a_process_call(),
                        plugin.has_passed_a_block_unprocessed(),
                    ))
                })
                .map_err(|reason| {
                    refusal(
                        &instance.bound,
                        OfflinePluginRefusal::ProcessingUnreadable(reason.into_refusal()),
                    )
                })?;
            if failed {
                return Err(refusal(&instance.bound, OfflinePluginRefusal::FailedABlock));
            }
            if never_processing {
                return Err(refusal(
                    &instance.bound,
                    OfflinePluginRefusal::NeverStartedProcessing,
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
/// instance whose record is gone, or no longer holds the very runtime the batch
/// was mapped against — an unload and a reload under the same id can land
/// between the mapping and this read, and could be another plugin, another
/// file under the same plugin name, or an instrument. The runtime is the load's
/// identity: an engine plugin id restarts with the engine, so a replacement can
/// reuse the mapped one, and the same runtime re-attached under a new id is
/// still the plugin the batch was mapped against. The render registers its
/// offline instance under the mapped id either way.
fn live_records(
    bound: &[BoundHostedInstance],
    state: &AppState,
) -> Result<Vec<LiveRecord>, OfflineRenderError> {
    let engine_plugins = state
        .engine_plugins
        .lock()
        .map_err(OfflineRenderError::lock("engine plugins"))?;
    bound
        .iter()
        .map(|instance| {
            let Some(record) = engine_plugins.get(&instance.instance_id) else {
                return Err(refusal(instance, OfflinePluginRefusal::Unloaded));
            };
            let mapped_against =
                std::ptr::eq(Arc::as_ptr(&record.runtime), instance.live_runtime.as_ptr());
            if !mapped_against {
                return Err(refusal(instance, OfflinePluginRefusal::Replaced));
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
    render: &InFlightRender<'_>,
) -> Result<Vec<u8>, OfflineRenderError> {
    if runtime.has_pending_parameter_writes() {
        return Err(refusal_unless_cancelled(
            render,
            instance,
            OfflinePluginRefusal::PendingParameterWrites,
        ));
    }
    (seams.capture_state)(runtime, state, render.control()).map_err(|reason| {
        refusal_unless_cancelled(
            render,
            instance,
            OfflinePluginRefusal::StateUnreadable(reason),
        )
    })
}

/// The refusal for one instance, or the cancelled refusal when the render was
/// cancelled: a cancel is never reported as a plugin's failure.
fn refusal_unless_cancelled(
    render: &InFlightRender<'_>,
    bound: &BoundHostedInstance,
    reason: OfflinePluginRefusal,
) -> OfflineRenderError {
    if render.control().is_cancelled() {
        return render.cancelled();
    }
    refusal(bound, reason)
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
fn refusal(bound: &BoundHostedInstance, refusal: OfflinePluginRefusal) -> OfflineRenderError {
    OfflineRenderError::Plugin {
        device_id: bound.device_id.clone(),
        plugin_name: bound.plugin_name.clone(),
        refusal: Box::new(refusal),
    }
}

/// The constructor a render's construction hop runs: `construct`, unless the
/// render is cancelled by the time the UI thread reaches it. The hop's deadline
/// bounds only the wait for the UI thread to start it, so a construction posted
/// before a quit's cancel can run after it; this read is what stops it opening
/// a plugin's module then. The refusal is never shown: the caller answers a
/// cancelled render with its cancelled refusal.
fn construct_unless_cancelled(
    construct: ConstructRuntime,
    render_control: Arc<OfflineRenderControl>,
) -> impl FnOnce(HostBackend, &str, &str, f64, ProcessMode) -> Result<HostedRuntime, PluginError>
       + Send
       + 'static {
    move |backend, path, descriptor_id, sample_rate, mode| {
        if render_control.is_cancelled() {
            return Err(PluginError::ConstructionWithdrawn);
        }
        construct(backend, path, descriptor_id, sample_rate, mode)
    }
}

/// Build an offline instance of every bound effect or instrument, at `sample_rate`, with the
/// live instance's state restored on it.
///
/// Every live state is captured first, at render start, so the print is one
/// moment of the session rather than a smear across the constructions. A
/// refusal partway releases whatever was already built. So does a cancel of
/// `render`, read before each state read, before each construction and again
/// once the runtime gate is taken, and before each restore: a render cancelled
/// at quit reads and builds nothing more on the thread waiting for it to end.
/// A cancel also ends a state read waiting on a held control gate — which, left
/// uncancelled, waits the live instance's own gate deadline and gives the same
/// unresponsive verdict as a state save — and is read
/// again on the UI thread, immediately before the plugin's code is opened: a
/// construction posted before the cancel and run after it opens nothing. The
/// restore into the fresh instance waits on no gate — nothing else holds it —
/// so it has no wait to cut short.
pub(crate) async fn build_offline_instances<'a>(
    bound: &[BoundHostedInstance],
    sample_rate: f64,
    state: &'a AppState,
    ui: &'a dyn UiThread,
    seams: &OfflinePluginSeams,
    render: &InFlightRender<'_>,
) -> Result<OfflinePluginInstances<'a>, OfflineRenderError> {
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
        return Err(OfflineRenderError::TooManyPlugins { count: bound.len() });
    }

    // Every state is captured before anything is constructed, each from the
    // runtime its load came with. Every live reference is given back, the ones
    // after a refusal included.
    let mut records = live_records(bound, state)?.into_iter();
    let mut captured = Vec::with_capacity(bound.len());
    let mut refused = None;
    for (instance, record) in bound.iter().zip(records.by_ref()) {
        if render.control().is_cancelled() {
            return_live_runtime(&record.instance_id, record.runtime, state);
            refused = Some(render.cancelled());
            break;
        }
        let chunk = capture_live_state(instance, &record.runtime, state, seams, render);
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
        if render.control().is_cancelled() {
            return Err(render.cancelled());
        }
        let backend = host_backend(&vetted.entry.format)
            .map_err(|reason| refusal(instance, OfflinePluginRefusal::Load(reason)))?;
        // The gate spans this instance's vet and construction only: released
        // here, before the state restore and before any refusal tears down the
        // instances already built — the order a load's refusal keeps.
        #[cfg(test)]
        if let Some(before_runtime_gate) = &seams.before_runtime_gate {
            before_runtime_gate();
        }
        let runtime = {
            let _runtime_gate = hold_plugin_runtime_gate().await;
            // A cancel can land while the build waits its turn at the gate.
            if render.control().is_cancelled() {
                return Err(render.cancelled());
            }
            construct_runtime_on_ui_thread(
                ui,
                backend,
                PreOpenChecks {
                    scan_policy: seams.scan_policy.clone(),
                    registry_store: Arc::clone(&state.plugin_registry_store),
                },
                vetted,
                sample_rate,
                ProcessMode::Offline,
                construct_unless_cancelled(seams.construct, render.shared_control()),
            )
        };
        let runtime = match runtime {
            Err(_) if render.control().is_cancelled() => return Err(render.cancelled()),
            runtime => {
                runtime.map_err(|reason| refusal(instance, OfflinePluginRefusal::Load(reason)))?
            }
        };
        let activated = runtime.is_activated();
        let shared = Arc::new(SharedHostedPlugin::new(runtime));
        built.instances.push(OfflinePluginInstance {
            bound: instance.clone(),
            runtime: Arc::clone(&shared),
            latency_frames: 0,
        });
        // A runtime built just before the cancel is in `built` already, so
        // this refusal releases it on the UI thread like any other.
        if render.control().is_cancelled() {
            return Err(render.cancelled());
        }
        if !activated {
            return Err(refusal(
                instance,
                OfflinePluginRefusal::Load(activation_refusal_reason(&instance.plugin_name)),
            ));
        }
        #[cfg(test)]
        if let Some(before_restore) = &seams.before_restore {
            before_restore();
        }
        if render.control().is_cancelled() {
            return Err(render.cancelled());
        }
        let latency_frames = shared
            .with_control(OFFLINE_CONTROL_TIMEOUT, |plugin| {
                Ok::<_, std::convert::Infallible>(AudioPlugin::set_state(plugin, &chunk).map(
                    |()| <HostedRuntime as HostedPluginRuntime>::latency_samples(plugin) as usize,
                ))
            })
            .map_err(|reason| {
                refusal_unless_cancelled(
                    render,
                    instance,
                    OfflinePluginRefusal::Control(reason.into_refusal()),
                )
            })?
            .map_err(|reason| {
                refusal_unless_cancelled(
                    render,
                    instance,
                    OfflinePluginRefusal::StateNotRestored(reason),
                )
            })?;
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
