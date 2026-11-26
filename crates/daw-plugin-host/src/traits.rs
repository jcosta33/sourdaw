//! The format-neutral seam every hosted plugin format implements.
//!
//! `AudioPlugin` is what the application asks of *any* loaded plugin;
//! `HostedPluginRuntime` is the extra surface the shared RT/control runtime
//! owner (`SharedHostedPlugin` in `sourdaw-native`) drives. CLAP and VST3 both
//! implement them today. A new format implements these two traits and plugs
//! into the runtime owner without either of them changing.
//!
//! The value types below live here rather than in `clap_wrapper` because they
//! are the seam's own vocabulary: none of them names anything CLAP-specific,
//! and a second format's backend has to speak them without depending on the
//! CLAP backend module.

use crate::clap_wrapper::ClapError;
use crate::parameter_events::PluginParameterEventQueue;
use crate::params::PluginParameter;
use crate::vst3_wrapper::Vst3Error;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// Why a loaded plugin refused a seam operation: its state, its editor, or a
/// latency re-query.
///
/// The seam's own refusal is [`PluginError::GuiUnsupported`], the answer of a
/// backend with no editor. Every other variant carries the backend's own
/// error, so a caller can tell which format refused and why without reading
/// text. Every variant is built on the control path.
#[derive(Debug)]
pub enum PluginError {
    /// The backend has no editor to open, resize or re-scale.
    GuiUnsupported,
    /// The CLAP backend refused.
    Clap(ClapError),
    /// The VST3 backend refused.
    Vst3(Vst3Error),
    /// The host withdrew the construction before the plugin was opened.
    ConstructionWithdrawn,
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::GuiUnsupported => f.write_str("Plugin does not support GUI"),
            Self::Clap(error) => write!(f, "{error}"),
            Self::Vst3(error) => write!(f, "{error}"),
            Self::ConstructionWithdrawn => {
                f.write_str("the host withdrew the construction before the plugin was opened")
            }
        }
    }
}

impl std::error::Error for PluginError {}

impl From<ClapError> for PluginError {
    fn from(error: ClapError) -> Self {
        Self::Clap(error)
    }
}

impl From<Vst3Error> for PluginError {
    fn from(error: Vst3Error) -> Self {
        Self::Vst3(error)
    }
}

/// Host-supplied wake invoked whenever a plugin flags a latency change.
///
/// Runs on whatever thread the plugin called the host callback from, so it must
/// not block, allocate unboundedly, or re-enter the wrapper. The host
/// application installs it to wake its own control path; keeping it an opaque
/// closure is what lets this crate stay free of any transport dependency.
///
/// Seam vocabulary rather than a CLAP one: every format has a plugin-initiated
/// latency change, and each backend's host callbacks install one of these.
pub type LatencyChangeNotifier = Box<dyn Fn() + Send + Sync>;

/// Something a plugin asked its host for from inside its own callback.
///
/// These arrivals share one shape, which is why they share one wake: the plugin
/// calls a host callback on a thread that may do no real work, the backend
/// records the fact lock-free, and the wake carries the follow-up onto the
/// host's control path. What the follow-up is differs; where it may run does not.
///
/// Every variant here is raised from a callback its format marks `[main-thread]`,
/// and the wake behind them allocates. An ask a plugin may raise from the audio
/// thread therefore has no variant here at all: `clap_host.request_callback`,
/// `clap_host_params.request_flush` and `clap_host_gui.request_resize`, which
/// CLAP marks `[thread-safe]`, are recorded as a flag or a size slot plus a
/// process-wide hint and answered by the request watcher's sweep or the
/// parameter drain, because a channel send on the render thread is a missed
/// device period.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PluginHostRequest {
    /// The plugin's own state changed — a knob moved in its editor, a preset
    /// loaded inside it — so the project holding it has unsaved changes.
    StateDirty,
    /// The plugin's parameter list changed and the host's copy of it describes a
    /// plugin that no longer exists. Re-enumerating means calling the plugin
    /// back, which the callback's own thread may not do.
    ParametersRescan,
    /// The plugin changed what its component is — its buses, or the whole
    /// component — and asked to be deactivated and activated again so the host
    /// re-reads it. The cycle calls the plugin's own lifecycle, which both its
    /// format and this host bind to the host's UI thread, so the follow-up is
    /// carried there under the runtime owner's exclusive claim.
    ComponentRestart,
}

/// Host-supplied wake fired when a plugin raises a [`PluginHostRequest`].
///
/// Runs on whatever thread the plugin called the host callback from, so it must
/// not block, allocate unboundedly, or re-enter the wrapper. Seam vocabulary
/// rather than a CLAP one: every format has plugin-initiated asks that the host
/// may only answer off the calling thread.
pub type PluginHostRequestNotifier = Box<dyn Fn(PluginHostRequest) + Send + Sync>;

/// Host-supplied resize of the native window one plugin's editor is drawn into.
///
/// Every format lets a plugin ask its host for a different editor size —
/// VST3 through `IPlugFrame::resizeView`, CLAP through
/// `clap_host_gui::request_resize` — and none of them can be answered by
/// returning a value, because the ask arrives from inside the plugin rather than
/// from a host call. So the host installs the one thing the backend cannot do
/// for itself: change the size of the window it was handed a handle to.
///
/// Seam vocabulary rather than a VST3 one, and shared rather than owned, because
/// the backend hands a clone to whichever host object the format routes the
/// request through. Called on the control path only.
pub type EditorWindowResizer = Arc<dyn Fn(u32, u32) + Send + Sync>;

/// The host window an open editor is drawn into, as the control path
/// addresses it when it answers what the plugin asked of that window.
///
/// The asks arrive from inside the plugin — CLAP's `gui.request_show`,
/// `request_hide`, `closed` and `resize_hints_changed` are all
/// `[thread-safe]` — so the backend only records them, and the host carries
/// them out later. Answering takes both halves of this seam: plugin calls
/// that belong to the thread owning the window, and window operations.
pub trait EditorWindowHost: Send + Sync {
    /// Make the window visible without taking focus from the DAW.
    fn show(&self);

    /// Hide the window, leaving the editor parented into it.
    fn hide(&self);

    /// Whether the user may drag this window's edges.
    fn set_resizable(&self, resizable: bool);

    /// End the window. Only after the editor has left it.
    fn destroy(&self);

    /// Run `work` on the thread that owns this window, and return once it has
    /// run. `Err` means it did not run and never will.
    fn run_on_window_thread(&self, work: Box<dyn FnOnce() + Send>) -> Result<(), String>;

    /// [`Self::run_on_window_thread`], giving up with `Err` once `deadline` has
    /// passed with `work` not yet started. Work already started is waited out.
    /// For a caller on a timer, whose next tick retries work withdrawn unrun.
    /// The default waits as long as [`Self::run_on_window_thread`] does.
    fn run_on_window_thread_within(
        &self,
        work: Box<dyn FnOnce() + Send>,
        _deadline: Duration,
    ) -> Result<(), String> {
        self.run_on_window_thread(work)
    }
}

/// Shared because the backend keeps it for the editor's life and hands a clone
/// to whoever answers the plugin's asks.
pub type SharedEditorWindow = Arc<dyn EditorWindowHost>;

/// What the plugin asked of its editor's window since the host last looked.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EditorWindowAsks {
    /// The newest show or hide request; an older one it overrides is moot.
    pub visibility: Option<EditorVisibility>,
    /// The plugin reported that its editor is gone.
    pub closed: Option<EditorClosed>,
    /// The plugin's resize constraints changed and must be read again.
    pub resize_hints_changed: bool,
}

impl EditorWindowAsks {
    pub fn is_empty(&self) -> bool {
        self.visibility.is_none() && self.closed.is_none() && !self.resize_hints_changed
    }
}

/// Which way a plugin asked its editor window to go.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorVisibility {
    Show,
    Hide,
}

/// A plugin's report that its editor ended on its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorClosed {
    /// Whether the plugin already released its editor resources. When it has,
    /// the host acknowledges with `destroy` and must not call into the view.
    pub was_destroyed: bool,
}

/// The display scale a backend assumes until the host states one.
///
/// One converts nothing, which is the right answer wherever a format's editor
/// rect is already in the units the host's window seam speaks — and the only
/// answer that cannot be wrong when nothing has been measured.
pub const DEFAULT_EDITOR_CONTENT_SCALE: f64 = 1.0;

/// The most note events one process call hands a plugin.
///
/// Lockstep restatement of `daw_engine::midi_fx::MIDI_EVENT_BUFFER_CAPACITY`,
/// the engine's per-block event buffer: this crate has no edge to the engine, so
/// the figure is restated here and `sourdaw-native`'s `host/native_bridge.rs`
/// welds the pair with a compile-time equality assert, where both are visible.
/// Every backend sizes its plugin-facing event list from this one number. A
/// list sized under it drops the tail of a full block — the latest notes, the
/// note-offs among them — after the slot has already counted them delivered.
pub const MAX_MIDI_EVENTS_PER_BLOCK: usize = 128;

/// How a hosted plugin's audio will be consumed: as it plays, or rendered
/// faster or slower than real time for an export.
///
/// Fixed when a wrapper is constructed and never changed on a live instance:
/// VST3 states the mode through `setupProcessing`, which may not be re-entered
/// under the audio thread, and an export builds an independent instance rather
/// than re-moding the one the engine plays through.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProcessMode {
    Realtime,
    Offline,
}

/// One host-side parameter write waiting to reach a plugin.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HostParameterUpdate {
    pub param_id: u32,
    pub value: f64,
}

/// One MIDI note event handed to a plugin with a block.
///
/// Its own type rather than the engine's, for the reason [`HostTransport`]
/// gives: this crate stays loadable without the engine. `frame_offset` is the
/// sample inside the block the event applies at — every format this host
/// speaks carries such an offset, so delivering everything at the head of a
/// block threw away timing the plugin was built to honour.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HostMidiEvent {
    pub note: u8,
    pub velocity: u8,
    pub channel: i16,
    pub is_note_on: bool,
    pub frame_offset: u32,
}

/// Host timeline handed to a plugin each block.
///
/// Deliberately its own type rather than the engine's transport struct: this
/// crate must stay loadable without the engine, and the engine must be free to
/// grow fields a hosted plugin has no slot for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HostTransport {
    pub tempo: f64,
    pub time_sig_num: u16,
    pub time_sig_denom: u16,
    pub is_playing: bool,
    pub song_pos_beats: f64,
    pub song_pos_seconds: f64,
}

/// Ownership of a plugin's processing state, split by thread the way CLAP
/// splits it.
///
/// CLAP annotates `start_processing` and `stop_processing` `[audio-thread]`, so
/// neither may be called from the loader, the unload command, or a `Drop`. This
/// gate lets a control thread state an *intent* — "this plugin should (not) be
/// processing" — which the audio thread carries out on its next block, and lets
/// the control thread observe when that has happened.
///
/// Exclusive access to the wrapper does not substitute for thread affinity: a
/// plugin that gates real-time state on these callbacks cares which thread ran
/// them, not who else was excluded at the time.
///
/// One case cannot be served on the audio thread: a slot that has already left
/// the graph will never be handed another block, so nothing there can perform
/// the stop that must precede `deactivate`. That path calls
/// `force_stop_processing_off_audio_thread`, which counts itself so the
/// deviation is measurable rather than assumed rare.
///
/// The rule is a hosting rule, not a CLAP one — VST3 splits
/// `setActive`/`setProcessing` the same way — so the gate belongs to the seam.
#[derive(Debug, Default)]
pub struct ProcessingGate {
    /// Control-thread intent. Read by the audio thread each block.
    requested: AtomicBool,
    /// Audio-thread truth: `start_processing` returned true and has not been undone.
    active: AtomicBool,
    /// Stops performed off the audio thread because no further block was coming.
    off_audio_thread_stops: AtomicU32,
}

impl ProcessingGate {
    /// Intent set by the loader once activation succeeds: the plugin should be
    /// processing as soon as the audio thread next runs it.
    pub fn request_start(&self) {
        self.requested.store(true, Ordering::Release);
    }

    /// Intent set before deactivate/destroy. Callable from any thread; performs
    /// no plugin call itself.
    pub fn request_stop(&self) {
        self.requested.store(false, Ordering::Release);
    }

    /// Whether the plugin is currently in the processing state.
    pub fn is_processing(&self) -> bool {
        self.active.load(Ordering::Acquire)
    }

    /// Whether a requested stop has been carried out. A control thread waits on
    /// this after `request_stop` before it deactivates.
    pub fn has_stopped(&self) -> bool {
        !self.is_processing()
    }

    /// How many stops had to be performed off the audio thread.
    pub fn off_audio_thread_stops(&self) -> u32 {
        self.off_audio_thread_stops.load(Ordering::Acquire)
    }

    /// Whether the control thread currently wants this plugin processing.
    pub fn wants_processing(&self) -> bool {
        self.requested.load(Ordering::Acquire)
    }

    /// Whether a stop has been asked for but not yet carried out. The audio
    /// thread uses this to decide whether a block is worth a visit.
    pub fn has_pending_stop(&self) -> bool {
        !self.wants_processing() && self.is_processing()
    }

    /// A gate in the state a freshly loaded plugin reaches after its first
    /// audio block: wanted, and processing.
    ///
    /// Fixture-only. In production `active` is written by the audio thread and
    /// nothing else, which is the whole point of the split — so the setter that
    /// short-circuits that is not compiled into a normal build.
    #[cfg(feature = "engine-owned-command-fixture")]
    pub fn fixture_already_processing() -> Self {
        let gate = Self::default();
        gate.request_start();
        gate.mark_started();
        gate
    }

    /// Audio-thread truth, written by a format backend's process path and by
    /// nothing else. `pub(crate)` rather than private only because the backend
    /// now lives in a sibling module; it is not part of this crate's public
    /// surface and no control-path caller may reach it.
    pub(crate) fn mark_started(&self) {
        self.active.store(true, Ordering::Release);
    }

    pub(crate) fn mark_stopped(&self) {
        self.active.store(false, Ordering::Release);
    }

    pub(crate) fn count_off_audio_thread_stop(&self) {
        self.off_audio_thread_stops.fetch_add(1, Ordering::AcqRel);
    }
}

/// What the application asks of any loaded plugin, whatever format it is.
///
/// The GUI four carry honest defaults rather than being absent: a format
/// backend that has no editor answers "no editor" instead of leaving the caller
/// to discover the type it is really holding. Nothing downcasts through this
/// trait — that escape hatch is what let the CLAP-only assumption leak into
/// `sourdaw-native`'s state layer in the first place.
pub trait AudioPlugin: Send + Sync {
    /// Process a block of audio.
    /// `inputs`: slice of channel buffers (e.g., [left_in, right_in])
    /// `outputs`: slice of mutable channel buffers (e.g., [left_out, right_out])
    /// `num_samples`: number of samples per channel to process
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize);

    /// Set a parameter value (typically 0.0 to 1.0 normalized)
    fn set_parameter(&mut self, param_id: u32, value: f64);

    /// Get all parameters exposed by the plugin
    fn get_parameters(&self) -> Vec<PluginParameter>;

    /// The opaque binary state of the plugin, or why the plugin would not give
    /// it.
    ///
    /// Fallible because a refusal and an empty state are different answers, and
    /// only the first one must never be written over a project's last good save.
    fn get_state(&self) -> Result<Vec<u8>, PluginError>;

    /// Set the opaque binary state of the plugin.
    fn set_state(&mut self, state: &[u8]) -> Result<(), PluginError>;

    /// The plugin's display name.
    ///
    /// The default is what a caller can truthfully say about a plugin whose
    /// backend does not report a name.
    fn get_name(&self) -> &str {
        "Plugin"
    }

    /// Whether the plugin provides an editor of its own.
    ///
    /// Defaults to `false`: a backend that cannot host an editor has none, and
    /// that is an answer rather than a gap.
    fn has_gui(&self) -> bool {
        false
    }

    /// Open the plugin's editor, parenting it into the given native handle.
    fn open_gui(&mut self, _handle_ptr: *mut c_void) -> Result<(u32, u32), PluginError> {
        Err(PluginError::GuiUnsupported)
    }

    /// Close the plugin's editor. A plugin with no editor has nothing to close.
    fn close_gui(&mut self) {}

    /// Install the host's editor-window resizer, before the editor is opened.
    ///
    /// Installed rather than passed to `open_gui` because the request it answers
    /// arrives after the open has returned, from inside the plugin. The default
    /// is empty for the same reason the rest of the GUI four carry defaults: a
    /// backend with no editor has no resize to answer.
    fn set_editor_window_resizer(&mut self, _resize: EditorWindowResizer) {}

    /// State the display scale the editor's host window runs at, before the
    /// editor is opened.
    ///
    /// Installed rather than passed to `open_gui` for the same reason the
    /// resizer is: it is a property of the window, which exists before the
    /// editor does. A backend that is never told one keeps
    /// [`DEFAULT_EDITOR_CONTENT_SCALE`].
    fn set_editor_content_scale(&mut self, _scale: f64) {}

    /// Whether the plugin's editor accepts a size the *host* chose.
    /// **Control path only.**
    ///
    /// Asked once the editor is open, because it is the open view that answers
    /// it — VST3 through `canResize`, CLAP through `gui.can_resize`. The host
    /// window follows: a fixed-size editor gets a window the user cannot drag,
    /// because a frame that moves around an editor that cannot follow it leaves
    /// the editor drawing outside its window.
    ///
    /// The default is `false`, which is the truthful answer for a backend with
    /// no editor to resize.
    fn editor_can_resize(&self) -> bool {
        false
    }

    /// Resize the editor because the host's window was resized, reporting the
    /// size the plugin constrained the request to. **Control path only.**
    ///
    /// The answer is the size the window must end at, and it is often not the
    /// size that was asked for: every format lets the plugin rewrite a host
    /// request into one its layout will actually run at — VST3 through
    /// `checkSizeConstraint`, CLAP through `gui.adjust_size` — and a host that
    /// kept its own number would leave the editor drawing outside its window.
    ///
    /// The window is resized before the plugin is told to move into it, on
    /// every backend. VST3 states that order outright and CLAP's editors depend
    /// on it just as much: a view told to lay out at a size its window has not
    /// taken yet lays out against the window it is still in.
    ///
    /// Every size crossing this seam — in and out, here and on every editor
    /// method beside it — is in the logical units the host's window seam sizes
    /// in. Both formats state editor sizes in physical pixels on Windows and
    /// X11, and converting to and from that is the backend's own business.
    ///
    /// The default refuses, because a backend with no editor has no size to
    /// negotiate.
    fn request_editor_size(
        &mut self,
        _width: u32,
        _height: u32,
    ) -> Result<(u32, u32), PluginError> {
        Err(PluginError::GuiUnsupported)
    }

    /// Restate the display scale for an editor that is already open, reporting
    /// the size its host window must take now. **Control path only.**
    ///
    /// Distinct from [`Self::set_editor_content_scale`], which states a scale for
    /// an editor that does not exist yet. A window that reaches a display of a
    /// different scale holds an editor laid out for the old one, and both halves
    /// of the answer have to move together: the plugin is told the new scale, and
    /// the size is renegotiated in the units that scale defines. Applying one
    /// without the other leaves the editor drawing at one density inside a window
    /// sized for another.
    ///
    /// The default refuses, for the same reason the resize does.
    fn apply_editor_content_scale(&mut self, _scale: f64) -> Result<(u32, u32), PluginError> {
        Err(PluginError::GuiUnsupported)
    }

    /// Carry out an editor resize the plugin asked for, reporting the size that
    /// was applied. **Control path only.**
    ///
    /// Two steps rather than one because the ask and the answer belong to
    /// different threads: the plugin states the size from inside its own
    /// callback, where the host may not touch a window server, and this reads it
    /// back where it may. `None` means nothing was pending, or the editor has no
    /// host window to resize.
    ///
    /// The default is empty because a format that answers its resize
    /// synchronously — VST3 does, on the frame the plugin calls into — has
    /// nothing left to apply here.
    fn apply_pending_editor_resize(&mut self) -> Option<(u32, u32)> {
        None
    }

    /// The window a pending editor resize is applied in, without taking it.
    /// **Control path only**; it makes no plugin call.
    ///
    /// `None` when nothing is pending or no window is installed. Lets a caller
    /// carry the apply to that window's thread rather than wait for the window
    /// server's answer where it stands.
    fn editor_window_with_pending_resize(&self) -> Option<SharedEditorWindow> {
        None
    }

    /// Install the window the editor is about to open into, so the asks the
    /// plugin makes of it later have somewhere to go. Released when the editor
    /// closes. The default ignores it: a format whose plugin cannot ask
    /// anything of its window has nothing to route.
    fn set_editor_window(&mut self, _window: SharedEditorWindow) {}

    /// The window to answer the plugin's pending editor-window asks through,
    /// without taking them. **Control path only**; it makes no plugin call.
    ///
    /// `None` when nothing is pending or no window is installed. Lets a caller
    /// learn where the asks go before it commits to the hop that takes them, so
    /// a hop that fails leaves them recorded.
    fn editor_window_with_pending_asks(&self) -> Option<SharedEditorWindow> {
        None
    }

    /// Take what the plugin asked of its editor window, with the window to
    /// answer it through. **Control path only**; it makes no plugin call.
    ///
    /// `None` when nothing is pending or no window is installed.
    fn take_editor_window_asks(&mut self) -> Option<(EditorWindowAsks, SharedEditorWindow)> {
        None
    }

    /// Carry out asks taken by [`Self::take_editor_window_asks`]. **On the
    /// thread that owns the editor's window**, because answering them calls
    /// into the editor.
    fn answer_editor_window_asks(&mut self, _asks: EditorWindowAsks) {}

    /// Read and clear the "plugin state changed" signal the plugin raised.
    /// **Control path only.**
    ///
    /// Read-and-clear rather than read, so one edit is reported once: the
    /// consumer turns it into a project-level dirty mark, and a flag left set
    /// would re-mark on every later wake.
    fn take_state_dirty(&mut self) -> bool {
        false
    }

    /// Read and clear the "my parameter list changed" signal the plugin raised.
    /// **Control path only.**
    ///
    /// Read-and-clear for the same reason as `take_state_dirty`: one rescan is
    /// answered once, and a flag left standing re-enumerates on every later wake.
    /// The default is `false` because a format that never raises the ask has
    /// nothing pending, which is an answer rather than a gap.
    fn take_parameters_rescan(&mut self) -> bool {
        false
    }

    /// Read and clear the plugin's request that the host call `flush()`, then
    /// make that call if it is legal right now. **Control path only.**
    ///
    /// One method rather than a take and a call, because whether the call is
    /// legal is a fact only the backend holds: every format forbids the flush
    /// while the plugin is being handed blocks, and a caller outside the backend
    /// would have to reach into the processing state to find out.
    ///
    /// Reports whether the flush actually ran. `false` covers both "nothing was
    /// asked for" and "the plugin is processing, so its output comes back
    /// through `process()` instead" — neither is a failure, and the caller's
    /// next move is the same for both: drain whatever the queue holds.
    fn flush_parameters_off_audio_thread(&mut self) -> bool {
        false
    }

    /// The queue this plugin's own parameter events are captured into, or `None`
    /// for a backend that captures none.
    ///
    /// Handed out rather than drained through this trait because the drain must
    /// never wait on the plugin: a control path held by a long operation would
    /// otherwise stall every event behind it, and the queue exists precisely so
    /// the two are independent.
    fn parameter_event_queue(&self) -> Option<Arc<PluginParameterEventQueue>> {
        None
    }

    /// Whether the plugin accepts note events.
    ///
    /// The default is `true` because that is the answer the engine's plugin slot
    /// has always given for every plugin, and changing it here would change CLAP
    /// routing in a patch about a different format. It is a placeholder, not a
    /// fact: CLAP states this in `clap.note-ports`, and reading it there is
    /// still owed. A backend that can answer truthfully overrides this — the
    /// VST3 backend reads the plugin's own event bus declaration.
    fn accepts_midi(&self) -> bool {
        true
    }
}

/// What the shared runtime owner requires of a hosted plugin backend.
///
/// Split from [`AudioPlugin`] because these are the operations the RT/control
/// access seam serialises: the process entries it calls under the audio-thread
/// claim, the processing-state transition only the audio thread may perform,
/// and the latency re-query that runs under the control claim. A plugin that is
/// merely loaded (`AudioPlugin`) is not necessarily wired into the engine.
///
/// `SharedHostedPlugin` is generic over this trait rather than holding
/// `dyn HostedPluginRuntime`, so every call on the audio path monomorphises to
/// a direct call.
pub trait HostedPluginRuntime: AudioPlugin {
    /// Whether activation succeeded. An unactivated runtime is never processed.
    fn is_activated(&self) -> bool;

    /// The processing-state gate shared with the runtime owner.
    fn processing_gate(&self) -> Arc<ProcessingGate>;

    /// Carry out a pending processing-state transition. **Audio thread only.**
    fn sync_processing_state(&mut self);

    /// Stage the transport handed to the plugin with the next block.
    fn set_transport(&mut self, transport: HostTransport);

    /// Process a block with pending host-side parameter writes applied.
    fn process_with_parameter_updates(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        parameter_updates: &[HostParameterUpdate],
    );

    /// Process a block with MIDI and pending host-side parameter writes.
    ///
    /// The caller hands at most [`MAX_MIDI_EVENTS_PER_BLOCK`] note events, and
    /// every one of them reaches the plugin with this block.
    fn process_with_midi_and_parameters(
        &mut self,
        inputs: &[&[f32]],
        outputs: &mut [&mut [f32]],
        num_samples: usize,
        midi_events: &[HostMidiEvent],
        parameter_updates: &[HostParameterUpdate],
    );

    /// Tell the plugin's editor about a parameter the host wrote. Control path
    /// only, and never the audio thread.
    ///
    /// A host-side write reaches the processor through the audio thread's own
    /// queue, which the editor never sees. A format that keeps its editor in a
    /// separate object therefore has to be told a second time, or its knob keeps
    /// showing the value the user moved away from. The default is empty because a
    /// format whose editor reads the same object the processor writes has already
    /// been told.
    fn apply_host_parameter_write_to_editor(&mut self, _param_id: u32, _value: f64) {}

    /// Apply a latency change the plugin flagged, returning the new latency in
    /// frames, or `None` when nothing was pending. Control path only.
    fn poll_latency_change(&mut self) -> Result<Option<u32>, PluginError>;

    /// Run the deactivate/re-read/reactivate cycle the plugin asked for when it
    /// changed its buses or its whole component, and report whether one ran.
    /// **Control path, on the host's UI thread**, under the runtime owner's
    /// exclusive claim: the cycle is the plugin's own lifecycle, which its
    /// format binds to the UI thread.
    ///
    /// A layout the host cannot route is an `Err`, and the instance is left
    /// out of service on its slot rather than processed with the geometry it
    /// had before. The default answers that nothing was asked for, for a
    /// format whose restart requests arrive some other way.
    fn apply_component_restart(&mut self) -> Result<bool, PluginError> {
        Ok(false)
    }

    /// Answer the plugin's request that the host call `on_main_thread` on it,
    /// making that call if one is pending. Control path only.
    ///
    /// One method rather than a take and a call, because the ask and the call
    /// belong together: the plugin raised the request precisely so this call
    /// would happen, and a flag drained without the call is the no-op #3746
    /// describes wearing a flag's clothes. The default is empty because a
    /// format with no such ask has nothing pending, which is an answer rather
    /// than a gap.
    fn service_main_thread_callback(&mut self) {}

    /// Reported latency in milliseconds, at the rate the plugin was activated
    /// with. Milliseconds because that rate is known here and nowhere upstream.
    fn latency_ms(&self) -> f64;

    /// Reported latency in frames of the plugin's own activation rate.
    fn latency_samples(&self) -> u32;

    /// Reported processing tail in frames of the plugin's own activation rate —
    /// how long the plugin keeps sounding after its input goes quiet.
    ///
    /// Frames rather than the milliseconds latency is reported in, because both
    /// formats define a sentinel at the top of the range for an infinite tail —
    /// CLAP's "any value greater or equal to `INT32_MAX`", VST3's
    /// `kInfiniteTail` — and a sentinel does not survive a conversion.
    ///
    /// Zero means no tail, which is also what a plugin that declares nothing
    /// reports. Control path only.
    fn tail_samples(&self) -> u32;

    /// Take a tail change the plugin flagged, answering the tail it reports now,
    /// or `None` when nothing was pending. Control path only.
    ///
    /// Defaults to `None` for a format that has no way for a plugin to announce
    /// one: VST3 defines `getTailSamples` as a question the host asks and
    /// carries no tail-changed callback, so nothing there is ever pending.
    fn take_tail_change(&mut self) -> Option<u32> {
        None
    }

    /// Whether the plugin is actively draining a tail it declared right now.
    /// Control path only.
    ///
    /// The signal comes from a format's own process result — CLAP answers
    /// `CLAP_PROCESS_TAIL` and leaves the question to `clap.tail` — so a backend
    /// whose process call carries no status has no moment it could ever observe.
    /// The default is `false` for that reason: VST3's processor call answers
    /// nothing about its state, and a format that gains an equivalent overrides
    /// this.
    fn is_tail_active(&self) -> bool {
        false
    }

    /// Say out loud what the audio thread recorded about this plugin.
    ///
    /// The audio thread may not allocate or take the I/O lock, so a plugin that
    /// failed a process call is latched as a flag and reported from here.
    /// Latched, so a plugin failing every block still produces one line. Control
    /// path only, and cheap for a plugin that recorded nothing: the recurring
    /// visit driven by [`take_pending_process_refusal_signal`] calls it on every
    /// instance, and only the one that failed has anything to say.
    fn report_plugin_observations(&mut self) {}

    /// Whether the plugin has failed a process call since it was created — the
    /// latch [`Self::report_plugin_observations`] reports from. Control path
    /// only. A block it failed passed through dry or silent, so a caller that
    /// needs every block processed (an offline print) refuses on it. The
    /// default is `false`: a backend with no failure signal has none to latch.
    fn has_failed_a_process_call(&self) -> bool {
        false
    }

    /// Whether a block was passed through untouched because the plugin was not
    /// in the processing state the host asked it into — it refused to start
    /// processing. A block after a requested stop does not count. Control path
    /// only; a realtime host keeps passing such blocks through, and a caller
    /// that needs every block processed refuses on it. The default is `false`,
    /// for a backend with no processing state to refuse.
    fn has_passed_a_block_unprocessed(&self) -> bool {
        false
    }
}

/// Process-wide hint that some plugin latched a process failure.
///
/// The same shape as the parameter-event hint and for the same reason: the
/// failure is recorded on the audio thread, which cannot name the instance
/// without allocating. A coalescing hint, never the record — each wrapper's own
/// latch is the record — so a lost signal costs nothing a later failure does not
/// raise again.
static PROCESS_REFUSAL_PENDING: AtomicBool = AtomicBool::new(false);

/// Raise the failure hint. **Called from the audio thread**, so it is one
/// release store and nothing else — and only on the first block that fails,
/// because the wrapper's own latch is what decides there is news.
pub fn signal_pending_process_refusal() {
    PROCESS_REFUSAL_PENDING.store(true, Ordering::Release);
}

/// Read and clear the failure hint.
pub fn take_pending_process_refusal_signal() -> bool {
    PROCESS_REFUSAL_PENDING.swap(false, Ordering::AcqRel)
}

/// Serialises every test that reads or clears the failure hint.
///
/// The hint is one process-wide flag shared by both backends, so two such tests
/// running side by side in the same binary would each consume the other's
/// signal.
#[cfg(test)]
pub(crate) static PROCESS_REFUSAL_HINT_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod tests {
    use super::*;

    struct EditorlessPlugin;

    impl AudioPlugin for EditorlessPlugin {
        fn process(&mut self, _: &[&[f32]], _: &mut [&mut [f32]], _: usize) {}
        fn set_parameter(&mut self, _: u32, _: f64) {}
        fn get_parameters(&self) -> Vec<PluginParameter> {
            Vec::new()
        }
        fn get_state(&self) -> Result<Vec<u8>, PluginError> {
            Ok(Vec::new())
        }
        fn set_state(&mut self, _: &[u8]) -> Result<(), PluginError> {
            Ok(())
        }
    }

    /// A backend with no editor refuses every editor call with the seam's own
    /// variant, and the renderer receives the text it always has.
    #[test]
    fn a_backend_with_no_editor_refuses_with_the_seams_own_variant() {
        let mut plugin = EditorlessPlugin;

        for refusal in [
            plugin.open_gui(std::ptr::null_mut()),
            plugin.request_editor_size(640, 480),
            plugin.apply_editor_content_scale(2.0),
        ] {
            let refusal = refusal.expect_err("no editor to address");
            assert!(matches!(refusal, PluginError::GuiUnsupported));
            assert_eq!(refusal.to_string(), "Plugin does not support GUI");
        }
    }

    /// A backend's refusal keeps its format and its own text through the seam.
    #[test]
    fn a_backend_refusal_keeps_its_format_and_its_text() {
        let clap = PluginError::from(ClapError::GuiAlreadyOpen);
        let vst3 = PluginError::from(Vst3Error::StateForeign);

        assert!(matches!(clap, PluginError::Clap(ClapError::GuiAlreadyOpen)));
        assert_eq!(clap.to_string(), "GUI is already open");
        assert!(matches!(vst3, PluginError::Vst3(Vst3Error::StateForeign)));
        assert_eq!(vst3.to_string(), "VST3 state was not written by this host");
    }
}
