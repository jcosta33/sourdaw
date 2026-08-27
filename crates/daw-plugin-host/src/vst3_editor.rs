//! Hosting one VST3 plugin's editor.
//!
//! The plugin owns the view (`IPlugView`); the host owns the window it is drawn
//! into and the frame (`IPlugFrame`) the view talks back through. The order the
//! two are joined in is a contract, not a preference: `setFrame` comes before
//! `attached`, because a view that is attached with no frame has nowhere to send
//! the resize it performs while laying itself out, and `removed` comes before
//! the view is released, because releasing an attached view leaves the plugin's
//! child window parented to a window the host is about to destroy.
//!
//! That detach-before-release order is the host's own close path, where the
//! native window is still alive when the editor is torn down. It does not hold
//! when the OS ends the window instead: the shell reports that close only after
//! the platform has already destroyed the window, so `removed` runs against a
//! parent that is gone. The gap is known, is shared with the CLAP editor path,
//! and is tracked separately — nothing in this module can close it, because by
//! the time the report arrives there is nothing left to detach from.
//!
//! None of this is reachable from the audio thread, and none of it takes a lock
//! the audio thread holds. What it does run on is a blocking worker of the
//! host application's executor: an editor command reaches this module through
//! the runtime owner's control claim, and that claim is what serialises view
//! lifecycle against every other control call. It is not the platform's UI
//! thread. `IPlugView` is specified to be driven from the thread that owns the
//! parent window, and this host does not do that today — a known deviation,
//! shared with the CLAP editor path, and tracked separately.
//!
//! `ViewRect` is not one unit on every platform. macOS states it in logical
//! points and the window server applies the backing scale, while Windows and
//! X11 state it in physical pixels and expect the host to have told the plugin
//! what scale it is running at. That is why
//! [`IPlugViewContentScaleSupport`](vst3::Steinberg::IPlugViewContentScaleSupport)
//! is set on those two platforms and not on macOS, and why every size crossing
//! between a view and the host's window seam is converted at that boundary.

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vst3::Steinberg::Vst::{IEditController, IEditControllerTrait, ViewType};
use vst3::Steinberg::{
    kInvalidArgument, kResultFalse, kResultOk, kResultTrue, tresult, FIDString, FUnknown,
    IPlugFrame, IPlugFrameTrait, IPlugView, IPlugViewContentScaleSupport,
    IPlugViewContentScaleSupportTrait, IPlugViewTrait, ViewRect,
};
use vst3::{Class, ComPtr, ComRef, ComWrapper};

use crate::traits::EditorWindowResizer;

#[cfg(target_os = "linux")]
use crate::vst3_run_loop::{HostRunLoop, RunLoopService};
#[cfg(target_os = "linux")]
use vst3::Steinberg::Linux::{
    FileDescriptor, IEventHandler, IRunLoop, IRunLoopTrait, ITimerHandler, TimerInterval,
};

/// How long teardown waits for a resize handshake already in flight.
///
/// The guarded section is one window resize and one `onSize`, so a handshake
/// that has not finished inside this is one the editor is not going to finish;
/// waiting longer would hang the close instead of ending it.
const RESIZE_GUARD_TEARDOWN_WAIT: Duration = Duration::from_millis(250);

/// The scale a host states when the shell could not measure a usable one.
///
/// A VST3 editor that is never told a scale on Windows or X11 lays itself out
/// against whatever it last assumed, so the host states something; one is the
/// only value that is never wrong by construction, because it converts nothing.
const FALLBACK_CONTENT_SCALE: f64 = 1.0;

/// The `FUnknown` pointer that *is* a COM object's identity.
///
/// COM defines identity on `FUnknown` and nowhere else. An object assembled by
/// multiple inheritance presents a different address for each interface it
/// implements, so two pointers to one object can compare unequal — which is why
/// no identity question in this backend compares interface pointers directly.
///
/// # Safety
/// `pointer` is null, or a live interface of the named type.
pub(crate) unsafe fn com_identity<I: vst3::Interface>(pointer: *mut I) -> Option<*mut FUnknown> {
    ComRef::from_raw(pointer)?
        .cast::<FUnknown>()
        .map(|identity| identity.as_ptr())
}

/// Why a Wayland session cannot host a VST3 editor here.
///
/// Named interfaces rather than a shrug: the format has a Wayland embedding path
/// and it runs entirely through host objects this host does not implement, so a
/// reader can tell what would have to be built.
const WAYLAND_REFUSAL: &str = "[VST3] this is a Wayland session with no X server behind it, and \
                               Sourdaw's editor host implements neither IWaylandHost nor \
                               IWaylandFrame, so a VST3 editor cannot be embedded";

/// One editor's size, in whatever unit this platform's `ViewRect` speaks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EditorSize {
    pub width: u32,
    pub height: u32,
}

impl EditorSize {
    /// The size a `ViewRect` describes, or `None` when it describes no area at
    /// all. A zero or inverted rect is a plugin answer the host cannot size a
    /// window from, and guessing one would put an editor behind a window of the
    /// wrong shape.
    fn from_rect(rect: &ViewRect) -> Option<Self> {
        let width = rect.right.checked_sub(rect.left)?;
        let height = rect.bottom.checked_sub(rect.top)?;
        if width <= 0 || height <= 0 {
            return None;
        }
        Some(Self {
            width: width as u32,
            height: height as u32,
        })
    }

    fn to_rect(self) -> ViewRect {
        ViewRect {
            left: 0,
            top: 0,
            right: i32::try_from(self.width).unwrap_or(i32::MAX),
            bottom: i32::try_from(self.height).unwrap_or(i32::MAX),
        }
    }

    fn has_area(self) -> bool {
        self.width > 0 && self.height > 0
    }

    /// This size scaled by `factor`, rounded, and never scaled away to nothing:
    /// a window of zero extent is not a smaller editor, it is no editor.
    fn scaled(self, factor: f64) -> Self {
        let convert = |value: u32| {
            (f64::from(value) * factor)
                .round()
                .clamp(1.0, f64::from(u32::MAX)) as u32
        };
        Self {
            width: convert(self.width),
            height: convert(self.height),
        }
    }

    /// A size a view stated, in the logical units the window seam sizes in.
    fn to_logical(self, view_units_per_logical: f64) -> Self {
        self.scaled(1.0 / view_units_per_logical)
    }

    /// A size the host holds, in the units this platform's `ViewRect` speaks.
    fn to_view_units(self, view_units_per_logical: f64) -> Self {
        self.scaled(view_units_per_logical)
    }
}

/// How many `ViewRect` units one logical window unit is worth on this platform.
///
/// One on macOS whatever the display reports: `ViewRect` there is already in the
/// logical points the window seam sizes in, and dividing by the backing scale
/// would halve every editor on a Retina display. On Windows and X11 the rect is
/// physical pixels, so the display's own scale is the conversion — and the same
/// number is what the view is told through
/// [`IPlugViewContentScaleSupport`](vst3::Steinberg::IPlugViewContentScaleSupport).
///
/// A scale the shell could not measure — zero, negative, or not finite — falls
/// back to converting nothing rather than destroying every size that crosses.
fn view_units_per_logical_unit(scale_factor: f64) -> f64 {
    if !platform_states_content_scale() {
        return 1.0;
    }
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        FALLBACK_CONTENT_SCALE
    }
}

/// The windowing session the DAW is running under, as far as embedding an editor
/// is concerned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditorSession {
    /// A session whose native window handle names something this host can
    /// embed a view into: an `NSView`, an `HWND`, or an X11 window id.
    Embeddable,
    /// A Wayland session with no X server behind it, so there is no X11 window
    /// id to embed into and no `IWaylandHost` to embed the other way.
    WaylandWithoutXServer,
}

impl EditorSession {
    /// What the environment says this session is.
    ///
    /// `XDG_SESSION_TYPE` alone is not the answer: a Wayland session that runs
    /// XWayland still exports a working `DISPLAY`, the shell still creates an
    /// X11 window, and the X11 embedding path works exactly as it does under a
    /// bare X server. Refusing on the session type alone would turn every
    /// XWayland session into a DAW with no plugin editors.
    pub fn current() -> Self {
        Self::of(
            std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
            std::env::var("DISPLAY").ok().as_deref(),
        )
    }

    fn of(session_type: Option<&str>, x_display: Option<&str>) -> Self {
        let wayland = session_type.is_some_and(|value| value.eq_ignore_ascii_case("wayland"));
        let x_server = x_display.is_some_and(|value| !value.is_empty());
        if wayland && !x_server {
            return Self::WaylandWithoutXServer;
        }
        Self::Embeddable
    }

    fn refusal(self) -> Option<&'static str> {
        match self {
            Self::Embeddable => None,
            Self::WaylandWithoutXServer => Some(WAYLAND_REFUSAL),
        }
    }
}

/// The platform string a view is asked about and attached with.
///
/// One per windowing system, and the set is closed: a platform not named here
/// has no embedding path at all, and refusing is better than attaching a view
/// with a type string that names somebody else's window kind.
fn platform_view_type() -> Option<FIDString> {
    #[cfg(target_os = "macos")]
    {
        Some(vst3::Steinberg::kPlatformTypeNSView)
    }
    #[cfg(target_os = "windows")]
    {
        Some(vst3::Steinberg::kPlatformTypeHWND)
    }
    #[cfg(target_os = "linux")]
    {
        Some(vst3::Steinberg::kPlatformTypeX11EmbedWindowID)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

/// Whether this platform states `ViewRect` in physical pixels, and therefore
/// needs to be told the scale it is running at.
fn platform_states_content_scale() -> bool {
    cfg!(any(target_os = "windows", target_os = "linux"))
}

/// Everything the frame owns on behalf of one open editor.
///
/// Held behind an `Arc` because the frame object the plugin calls into and the
/// [`Vst3Editor`] the host drives are two views onto the same state.
pub struct EditorFrameState {
    /// The view this frame belongs to, as the `FUnknown` that is its COM
    /// identity. Held as a bare pointer for identity only: the view holds the
    /// frame for its whole attached life, and retaining it back would be a cycle
    /// neither side ever breaks. Cleared before teardown, so a call arriving
    /// from another thread is refused rather than answered through a vtable the
    /// close is about to release.
    view: AtomicPtr<FUnknown>,
    /// How the host resizes the native window the view is drawn into.
    window: Mutex<Option<EditorWindowResizer>>,
    /// How many `ViewRect` units one logical window unit is worth here. Fixed
    /// at open: an editor that moves to a display of a different scale is not
    /// re-scaled, which is tracked separately.
    view_units_per_logical: f64,
    /// The size the host window is at, in logical units.
    granted_width: AtomicU32,
    granted_height: AtomicU32,
    /// Whether a resize handshake is running. See [`Self::begin_resize`].
    resizing: AtomicBool,
    /// Nested `resizeView` calls this frame has refused. Read by tests; the
    /// count is what distinguishes "the guard held" from "the plugin never
    /// asked".
    refused_nested_resizes: AtomicU32,
    #[cfg(target_os = "linux")]
    run_loop: Arc<HostRunLoop>,
}

impl EditorFrameState {
    fn new(window: Option<EditorWindowResizer>, scale_factor: f64) -> Self {
        Self {
            view: AtomicPtr::new(ptr::null_mut()),
            window: Mutex::new(window),
            view_units_per_logical: view_units_per_logical_unit(scale_factor),
            granted_width: AtomicU32::new(0),
            granted_height: AtomicU32::new(0),
            resizing: AtomicBool::new(false),
            refused_nested_resizes: AtomicU32::new(0),
            #[cfg(target_os = "linux")]
            run_loop: Arc::new(HostRunLoop::new()),
        }
    }

    /// Record which view this frame answers for, or report that the view will
    /// not state its own identity.
    fn adopt(&self, view: &ComPtr<IPlugView>) -> bool {
        let Some(identity) = view.cast::<FUnknown>() else {
            return false;
        };
        self.view.store(identity.as_ptr(), Ordering::Release);
        true
    }

    /// Stop answering for the view. Every later frame call is refused.
    fn disown(&self) {
        self.view.store(ptr::null_mut(), Ordering::Release);
    }

    fn owns(&self, view: *mut IPlugView) -> bool {
        let owned = self.view.load(Ordering::Acquire);
        if owned.is_null() || view.is_null() {
            return false;
        }
        // SAFETY: `view` is the pointer the plugin passed into this frame call,
        // so it is a live interface for the duration of the call.
        let asked = unsafe { com_identity(view) };
        asked.is_some_and(|asked| ptr::eq(owned.cast_const(), asked.cast_const()))
    }

    /// Take the resize guard, or report that a handshake is already running.
    ///
    /// Mutual exclusion for the whole frame, not a marker for one callstack: a
    /// request from another thread is refused exactly as a nested one is. Both
    /// refusals are wanted. A plugin is entitled to ask for another size from
    /// inside `onSize` — setting the content scale is one documented way it
    /// happens — and a host that answered each one would recurse until the stack
    /// ran out; refusing leaves the plugin at the size the outer handshake
    /// granted, which is a size it asked for. Two handshakes at once would
    /// interleave a window resize with somebody else's `onSize` and leave the
    /// window and the view at different sizes.
    ///
    /// Teardown takes the same guard, and a frame call takes it before it tests
    /// whose view it holds, so the guard is the admission point: a close either
    /// gets in first, and every later call finds the frame disowned, or it waits
    /// for the handshake that got in ahead of it.
    fn begin_resize(&self) -> bool {
        !self.resizing.swap(true, Ordering::AcqRel)
    }

    /// Take the resize guard for teardown, waiting out a handshake in flight.
    ///
    /// Reports whether it was taken: past the deadline the close proceeds
    /// anyway, because a teardown that never returns is worse than one that
    /// overlaps a stuck handshake. It can proceed because the handshake retained
    /// the view for its own duration, so what the deadline bounds is how long a
    /// close waits, not whether the view survives the wait.
    fn acquire_resize_guard_for_teardown(&self) -> bool {
        let deadline = Instant::now() + RESIZE_GUARD_TEARDOWN_WAIT;
        loop {
            if self.begin_resize() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn end_resize(&self) {
        self.resizing.store(false, Ordering::Release);
    }

    fn record_granted(&self, size: EditorSize) {
        self.granted_width.store(size.width, Ordering::Release);
        self.granted_height.store(size.height, Ordering::Release);
    }

    /// Put the window and the recorded size back where a refused handshake
    /// found them. A size with no area was never granted, so there is no window
    /// size to restore to.
    fn restore_granted(&self, previous: EditorSize) {
        self.record_granted(previous);
        if previous.has_area() {
            self.resize_host_window(previous);
        }
    }

    fn to_logical(&self, size: EditorSize) -> EditorSize {
        size.to_logical(self.view_units_per_logical)
    }

    fn to_view_units(&self, size: EditorSize) -> EditorSize {
        size.to_view_units(self.view_units_per_logical)
    }

    fn granted(&self) -> EditorSize {
        EditorSize {
            width: self.granted_width.load(Ordering::Acquire),
            height: self.granted_height.load(Ordering::Acquire),
        }
    }

    /// Resize the native window the view lives in, in logical units.
    ///
    /// Absent when the caller opened the editor without a window to resize —
    /// the scan worker and the tests both do — in which case the granted size is
    /// still recorded, because that is what the view is about to be told.
    fn resize_host_window(&self, size: EditorSize) {
        let window = self.window.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(resize) = window.as_ref() {
            resize(size.width, size.height);
        }
    }

    pub fn refused_nested_resizes(&self) -> u32 {
        self.refused_nested_resizes.load(Ordering::Acquire)
    }

    #[cfg(target_os = "linux")]
    pub fn run_loop(&self) -> &Arc<HostRunLoop> {
        &self.run_loop
    }
}

/// The `IPlugFrame` a hosted view is given.
pub struct HostEditorFrame {
    state: Arc<EditorFrameState>,
}

#[cfg(target_os = "linux")]
impl Class for HostEditorFrame {
    /// `IRunLoop` is answered on Linux and nowhere else, because it is the only
    /// platform whose editors have no event loop of their own: a plugin that
    /// cannot get one from the frame there never draws and never responds. On
    /// macOS and Windows the platform's own loop already runs the editor, and
    /// advertising a run loop would invite a plugin onto a path this host does
    /// not need to serve.
    type Interfaces = (IPlugFrame, IRunLoop);
}

#[cfg(not(target_os = "linux"))]
impl Class for HostEditorFrame {
    type Interfaces = (IPlugFrame,);
}

impl IPlugFrameTrait for HostEditorFrame {
    /// The plugin's own resize request, answered on this callstack.
    ///
    /// VST3 requires the whole handshake — host resizes its window, host calls
    /// `onSize` — to complete before this returns. Deferring it to a later turn
    /// of an event loop leaves the plugin drawing at the old size against a
    /// window that has already changed, which is the classic "editor content
    /// clipped after a preset change" symptom.
    ///
    /// The VST3 side of that handshake is synchronous here and the order is the
    /// one the format states. The window itself is a separate matter: the
    /// production window seam crosses to the shell as a non-blocking call, so
    /// the host window is *asked* to resize before `onSize` and applies it a
    /// turn of the shell's loop later. That seam limitation is shared with the
    /// CLAP editor path and tracked separately.
    ///
    /// A view that refuses the size it just asked for leaves the host holding a
    /// window it changed for nothing, so the refusal puts the window and the
    /// recorded size back before it is reported.
    unsafe fn resizeView(&self, view: *mut IPlugView, new_size: *mut ViewRect) -> tresult {
        if new_size.is_null() {
            return kInvalidArgument;
        }
        let Some(requested) = EditorSize::from_rect(&*new_size) else {
            return kInvalidArgument;
        };

        // The guard is taken before the frame is asked whose view this is. The
        // other order is a check followed by an act: a teardown landing between
        // the two would disown the frame and release the view while this call
        // was already past the only test that would have caught it.
        if !self.state.begin_resize() {
            self.state
                .refused_nested_resizes
                .fetch_add(1, Ordering::AcqRel);
            return kResultFalse;
        }

        if !self.state.owns(view) {
            self.state.end_resize();
            return kInvalidArgument;
        }
        // Retained, not borrowed, for as long as the handshake runs. A teardown
        // that gives up waiting for the guard releases its own reference while
        // `onSize` may still be running through this one, so the wait is a bound
        // on how long a close takes rather than on whether the view is alive.
        let Some(view) = ComRef::from_raw(view).map(|borrowed| borrowed.to_com_ptr()) else {
            self.state.end_resize();
            return kInvalidArgument;
        };

        let previous = self.state.granted();
        let granted = self.state.to_logical(requested);
        self.state.resize_host_window(granted);
        self.state.record_granted(granted);

        // The plugin's own rect, origin included: `onSize` is told the rectangle
        // the view asked for, not a copy of its extent moved to the origin.
        let accepted = view.onSize(new_size) == kResultOk;
        if !accepted {
            self.state.restore_granted(previous);
        }

        self.state.end_resize();
        if accepted {
            kResultTrue
        } else {
            kResultFalse
        }
    }
}

#[cfg(target_os = "linux")]
impl IRunLoopTrait for HostEditorFrame {
    unsafe fn registerEventHandler(
        &self,
        handler: *mut IEventHandler,
        fd: FileDescriptor,
    ) -> tresult {
        self.state.run_loop.register_event_handler(handler, fd)
    }

    unsafe fn unregisterEventHandler(&self, handler: *mut IEventHandler) -> tresult {
        self.state.run_loop.unregister_event_handler(handler)
    }

    unsafe fn registerTimer(
        &self,
        handler: *mut ITimerHandler,
        milliseconds: TimerInterval,
    ) -> tresult {
        self.state.run_loop.register_timer(handler, milliseconds)
    }

    unsafe fn unregisterTimer(&self, handler: *mut ITimerHandler) -> tresult {
        self.state.run_loop.unregister_timer(handler)
    }
}

/// One open editor: the plugin's view, the host's frame, and the state they
/// share.
///
/// Field order is drop order and it is load-bearing: the view is released before
/// the frame it holds a pointer to.
pub struct Vst3Editor {
    view: ComPtr<IPlugView>,
    _frame: ComWrapper<HostEditorFrame>,
    state: Arc<EditorFrameState>,
    /// The thread that services the editor's descriptors and timers, for as long
    /// as the editor is open.
    #[cfg(target_os = "linux")]
    run_loop_service: Option<RunLoopService>,
}

impl Vst3Editor {
    /// Create the plugin's editor and attach it to a native window.
    ///
    /// The order is the SDK's own host's: ask whether the platform is supported,
    /// give the view its frame, state the content scale, learn the size, size the
    /// host window to it, attach, and read the size back — because a plugin is
    /// entitled to settle on a different size once it can see its parent.
    ///
    /// `scale_factor` is the display scale the host window was created at, which
    /// is what the view is told on the platforms whose `ViewRect` is physical
    /// pixels, and what every size crossing that boundary is converted by.
    pub fn open(
        controller: &ComPtr<IEditController>,
        parent: *mut c_void,
        plugin_name: &str,
        session: EditorSession,
        window: Option<EditorWindowResizer>,
        scale_factor: f64,
    ) -> Result<Self, String> {
        if let Some(refusal) = session.refusal() {
            return Err(format!("{refusal} ('{plugin_name}')"));
        }
        let Some(view_type) = platform_view_type() else {
            return Err(format!(
                "[VST3] '{plugin_name}': this platform has no VST3 editor embedding path"
            ));
        };

        let view = create_editor_view(controller)
            .ok_or_else(|| format!("[VST3] '{plugin_name}' offers no editor"))?;

        // SAFETY: `view` was just created and is not attached; `parent` is the
        // native handle the window seam produced for this platform.
        unsafe {
            if view.isPlatformTypeSupported(view_type) != kResultTrue {
                return Err(format!(
                    "[VST3] '{plugin_name}' has an editor, but not one this platform can embed"
                ));
            }
        }

        let state = Arc::new(EditorFrameState::new(window, scale_factor));
        if !state.adopt(&view) {
            return Err(format!(
                "[VST3] '{plugin_name}': its editor view does not answer for its own identity"
            ));
        }
        let frame = ComWrapper::new(HostEditorFrame {
            state: Arc::clone(&state),
        });
        let frame_pointer = frame
            .as_com_ref::<IPlugFrame>()
            .map(|borrowed| borrowed.as_ptr())
            .ok_or_else(|| format!("[VST3] '{plugin_name}': the host frame is unavailable"))?;

        // SAFETY: the frame outlives the view — it is released after it in this
        // type's field order — and `parent` is live for the editor's whole life.
        //
        // Before `attached`, always: a view laying itself out against its new
        // parent may resize immediately, and with no frame that request has
        // nowhere to go.
        // Every failure past the adoption disowns the frame, for the reason the
        // drop does: a plugin that holds the frame past the failure would
        // otherwise pass the ownership test against a view this function is
        // about to release.
        if unsafe { view.setFrame(frame_pointer) } != kResultOk {
            state.disown();
            return Err(format!(
                "[VST3] '{plugin_name}' refused the host's plug frame"
            ));
        }

        // Every failure past this point has to take the frame back off the view
        // before releasing it: a view left holding a pointer to a host object
        // whose last reference is about to drop can call into freed memory.
        if let Err(error) = unsafe { attach(&view, &state, parent, view_type, plugin_name) } {
            state.disown();
            // SAFETY: the view is live and, on every path here, not attached.
            unsafe { view.setFrame(ptr::null_mut()) };
            return Err(error);
        }

        // An editor whose descriptors and timers nobody services never draws and
        // never answers a click, so a service thread that will not start is a
        // refusal rather than a degraded editor.
        #[cfg(target_os = "linux")]
        let run_loop_service = match RunLoopService::start(Arc::clone(state.run_loop())) {
            Ok(service) => Some(service),
            Err(error) => {
                state.disown();
                // SAFETY: the view is attached and live; this is the detach the
                // failure path owes before the frame and the view are released.
                unsafe {
                    view.removed();
                    view.setFrame(ptr::null_mut());
                }
                return Err(format!("[VST3] '{plugin_name}': {error}"));
            }
        };

        Ok(Self {
            view,
            _frame: frame,
            #[cfg(target_os = "linux")]
            run_loop_service,
            state,
        })
    }

    /// The size the editor is currently at, as last granted by either side of
    /// the handshake.
    pub fn size(&self) -> EditorSize {
        self.state.granted()
    }

    pub fn frame_state(&self) -> &Arc<EditorFrameState> {
        &self.state
    }

    /// Resize the editor because the *host* wants a different size, stated in
    /// the logical units the window seam speaks.
    ///
    /// The plugin decides what it will accept: `canResize` says whether the
    /// question may be asked at all, and `checkSizeConstraint` rewrites the rect
    /// into one the view will actually run at. Both answers are honoured —
    /// forcing a size past either one is how an editor ends up drawing outside
    /// its window.
    pub fn request_size(&self, requested: EditorSize) -> Result<EditorSize, String> {
        // SAFETY: control path only; the view is attached and live.
        unsafe {
            if self.view.canResize() != kResultTrue {
                return Err("[VST3] this editor is a fixed size".to_string());
            }

            if !self.state.begin_resize() {
                return Err("[VST3] a resize handshake is already running".to_string());
            }
            let granted = self.negotiate_size(requested);
            self.state.end_resize();
            granted
        }
    }

    /// Ask the view for a size, resize the window to what it allowed, and only
    /// then tell the view to move — the same order the plugin's own request
    /// takes, because a view told to move into a window that has not changed yet
    /// lays itself out against the old one.
    ///
    /// # Safety
    /// Called with the resize guard held, on the control path, with the view
    /// attached.
    unsafe fn negotiate_size(&self, requested: EditorSize) -> Result<EditorSize, String> {
        let mut rect = self.state.to_view_units(requested).to_rect();
        if self.view.checkSizeConstraint(&mut rect) != kResultTrue {
            return Err("[VST3] this editor refused the requested size".to_string());
        }
        let constrained = EditorSize::from_rect(&rect)
            .ok_or_else(|| "[VST3] this editor constrained the size to nothing".to_string())?;
        let granted = self.state.to_logical(constrained);

        let previous = self.state.granted();
        self.state.resize_host_window(granted);
        if self.view.onSize(&mut rect) != kResultOk {
            self.state.restore_granted(previous);
            return Err("[VST3] this editor refused to move to the constrained size".to_string());
        }
        self.state.record_granted(granted);
        Ok(granted)
    }
}

impl Drop for Vst3Editor {
    /// Detach before release, and drop the frame last.
    ///
    /// `removed` is what un-parents the plugin's own child window; a view
    /// released while still attached leaves that window pointing at a host window
    /// that is about to go away. Clearing the frame afterwards means the plugin
    /// cannot call back into a host object whose last reference is about to drop.
    ///
    /// Before either of them the frame stops answering for the view and takes
    /// the resize guard. `setFrame(null)` is not on its own enough: a plugin may
    /// hold the frame past it, and a `resizeView` arriving on another thread —
    /// the Linux service thread, or the shell's — would otherwise run a whole
    /// handshake against a view this drop is releasing.
    ///
    /// The guard is what those two halves close between them. A frame call takes
    /// it before it asks whose view it holds, so a call that arrives after the
    /// disown finds the frame disowned, and one that got in first holds the
    /// guard this wait is blocked on. What the wait does not decide is the
    /// view's life: an admitted call has retained the view for its own duration,
    /// so giving up at the deadline costs this close its promptness rather than
    /// that call its vtable.
    fn drop(&mut self) {
        // The service thread calls into handlers the editor registered, so it
        // stops before anything the editor owns is torn down.
        #[cfg(target_os = "linux")]
        drop(self.run_loop_service.take());

        self.state.disown();
        let guarded = self.state.acquire_resize_guard_for_teardown();

        // SAFETY: the view is attached and live until these two calls.
        unsafe {
            self.view.removed();
            self.view.setFrame(ptr::null_mut());
        }

        if guarded {
            self.state.end_resize();
        }
    }
}

/// Whether the plugin actually offers an editor.
///
/// VST3 has no cheaper question than this one: `createView` *is* the query, and a
/// null answer is the format's way of saying there is no editor. The view is
/// released immediately — it was never attached, so there is nothing to undo.
pub fn plugin_offers_an_editor(controller: &ComPtr<IEditController>) -> bool {
    create_editor_view(controller).is_some()
}

/// State the scale, learn the size, size the host window, and attach.
///
/// Split out of [`Vst3Editor::open`] so every way this can fail leaves through
/// one `Err`, which is the caller's single chance to take the frame back off the
/// view before it is released.
///
/// # Safety
/// The view is live, has its frame set, and is not yet attached. `parent` is the
/// native handle the window seam produced for this platform.
unsafe fn attach(
    view: &ComPtr<IPlugView>,
    state: &EditorFrameState,
    parent: *mut c_void,
    view_type: FIDString,
    plugin_name: &str,
) -> Result<(), String> {
    if platform_states_content_scale() {
        apply_content_scale(view, state.view_units_per_logical as f32);
    }

    // A view that states no size yet is not a refusal: plugins exist that only
    // know their size once they can see a parent, so the pre-attach window
    // resize is skipped and the question asked again below.
    let preferred = read_view_size(view).map(|size| state.to_logical(size));
    if let Some(preferred) = preferred {
        state.record_granted(preferred);
        state.resize_host_window(preferred);
    }

    if view.attached(parent, view_type) != kResultOk {
        return Err(format!(
            "[VST3] '{plugin_name}' refused to attach its editor to the host window"
        ));
    }

    // A plugin may settle on a different size once it can see its parent, and the
    // window the host is about to show has to match.
    let settled = read_view_size(view).map(|size| state.to_logical(size));
    let Some(size) = settled.or(preferred) else {
        // The view is attached now, so the caller's `setFrame(null)` is no
        // longer enough on its own: the detach it owes has to run first.
        view.removed();
        return Err(format!(
            "[VST3] '{plugin_name}' would not state a size for its editor"
        ));
    };
    state.record_granted(size);
    Ok(())
}

fn create_editor_view(controller: &ComPtr<IEditController>) -> Option<ComPtr<IPlugView>> {
    // SAFETY: control path only; the controller is live and initialised.
    // `createView` returns an owned reference, which `ComPtr::from_raw` adopts.
    unsafe { ComPtr::from_raw(controller.createView(ViewType::kEditor)) }
}

/// # Safety
/// The view is live.
unsafe fn read_view_size(view: &ComPtr<IPlugView>) -> Option<EditorSize> {
    let mut rect = ViewRect {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    if view.getSize(&mut rect) != kResultOk {
        return None;
    }
    EditorSize::from_rect(&rect)
}

/// # Safety
/// The view is live and not yet attached.
unsafe fn apply_content_scale(view: &ComPtr<IPlugView>, scale: f32) {
    // A plugin that does not implement the interface has nothing to be told, and
    // that is not a failure: the scale is advice, and the editor still attaches.
    if let Some(scaling) = view.cast::<IPlugViewContentScaleSupport>() {
        scaling.setContentScaleFactor(scale);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A bare X server session embeds through `kPlatformTypeX11EmbedWindowID`
    /// like any other X11 host.
    #[test]
    fn an_x11_session_can_host_an_editor() {
        assert_eq!(
            EditorSession::of(Some("x11"), Some(":0")),
            EditorSession::Embeddable
        );
    }

    /// XWayland is the common case, and it is an X server: the shell's window
    /// still has an X11 id and the view still embeds into it. Refusing on the
    /// session type alone would leave every XWayland user with no editors.
    #[test]
    fn a_wayland_session_running_xwayland_can_still_host_an_editor() {
        assert_eq!(
            EditorSession::of(Some("wayland"), Some(":0")),
            EditorSession::Embeddable
        );
    }

    /// Without an X server there is no window id to embed into, and the format's
    /// own Wayland path needs host objects this host does not implement. The
    /// refusal has to say which ones, or nobody can tell what would fix it.
    #[test]
    fn a_wayland_session_with_no_x_server_is_refused_by_naming_the_missing_host_interfaces() {
        let session = EditorSession::of(Some("wayland"), None);

        assert_eq!(session, EditorSession::WaylandWithoutXServer);
        let refusal = session
            .refusal()
            .expect("a Wayland session must be refused");
        assert!(
            refusal.contains("IWaylandHost"),
            "the refusal must name the missing host interface, got: {refusal}"
        );
        assert!(
            refusal.contains("IWaylandFrame"),
            "the refusal must name the missing frame interface, got: {refusal}"
        );
    }

    /// An empty `DISPLAY` is not an X server. Treating it as one would attach a
    /// view to a window id that does not exist.
    #[test]
    fn an_empty_display_is_not_an_x_server() {
        assert_eq!(
            EditorSession::of(Some("wayland"), Some("")),
            EditorSession::WaylandWithoutXServer
        );
    }

    /// A rect with no area cannot size a window, and the host must say so rather
    /// than invent one.
    #[test]
    fn a_view_rect_with_no_area_describes_no_editor_size() {
        assert_eq!(
            EditorSize::from_rect(&ViewRect {
                left: 0,
                top: 0,
                right: 0,
                bottom: 400
            }),
            None
        );
        assert_eq!(
            EditorSize::from_rect(&ViewRect {
                left: 10,
                top: 10,
                right: 5,
                bottom: 400
            }),
            None
        );
    }

    /// On the platforms whose `ViewRect` is physical pixels, a view's own size
    /// is twice the window's on a 2x display. A host that hands that number
    /// straight to a window seam that speaks logical units opens an editor at
    /// double size with the plugin drawing in a quarter of it.
    #[test]
    fn a_physical_pixel_size_converts_both_ways_across_the_window_seam() {
        let view_size = EditorSize {
            width: 1600,
            height: 1200,
        };
        let window_size = EditorSize {
            width: 800,
            height: 600,
        };

        assert_eq!(view_size.to_logical(2.0), window_size);
        assert_eq!(window_size.to_view_units(2.0), view_size);
    }

    /// Fractional scales are the common Windows case (125%, 150%), and they do
    /// not divide evenly. Rounding is the only answer a window can take, and a
    /// size must never round away to nothing.
    #[test]
    fn a_fractional_scale_rounds_rather_than_truncating_or_vanishing() {
        assert_eq!(
            EditorSize {
                width: 1001,
                height: 751
            }
            .to_logical(1.25),
            EditorSize {
                width: 801,
                height: 601
            }
        );
        assert_eq!(
            EditorSize {
                width: 1,
                height: 1
            }
            .to_logical(100.0),
            EditorSize {
                width: 1,
                height: 1
            }
        );
    }

    /// macOS states `ViewRect` in the same logical points the window seam sizes
    /// in, so converting there would halve every editor on a Retina display.
    /// Windows and X11 state physical pixels, and the display's scale is the
    /// conversion.
    #[test]
    fn only_the_platforms_whose_view_rect_is_physical_convert_by_the_display_scale() {
        let expected = if cfg!(any(target_os = "windows", target_os = "linux")) {
            2.0
        } else {
            1.0
        };

        assert_eq!(view_units_per_logical_unit(2.0), expected);
    }

    /// A scale the shell could not measure must convert nothing. Dividing by
    /// zero or by a NaN destroys every size that crosses the seam.
    #[test]
    fn a_scale_the_shell_could_not_measure_converts_nothing() {
        for unusable in [0.0, -2.0, f64::NAN, f64::INFINITY] {
            assert_eq!(view_units_per_logical_unit(unusable), 1.0);
        }
    }

    /// COM identity is defined on `FUnknown` alone. An object that implements
    /// two interfaces hands out a different address for each, so comparing
    /// interface pointers answers "different objects" about one object — which
    /// is how a frame ends up refusing its own view's resize.
    #[test]
    fn one_object_has_one_identity_whatever_interface_it_is_asked_through() {
        struct TwoFacedObject;

        impl Class for TwoFacedObject {
            type Interfaces = (IPlugFrame, IPlugViewContentScaleSupport);
        }

        impl IPlugFrameTrait for TwoFacedObject {
            unsafe fn resizeView(&self, _view: *mut IPlugView, _size: *mut ViewRect) -> tresult {
                kResultOk
            }
        }

        impl IPlugViewContentScaleSupportTrait for TwoFacedObject {
            unsafe fn setContentScaleFactor(&self, _scale: f32) -> tresult {
                kResultOk
            }
        }

        let object = ComWrapper::new(TwoFacedObject);
        let frame = object
            .as_com_ref::<IPlugFrame>()
            .expect("the object implements IPlugFrame")
            .as_ptr();
        let scaling = object
            .as_com_ref::<IPlugViewContentScaleSupport>()
            .expect("the object implements IPlugViewContentScaleSupport")
            .as_ptr();

        assert!(
            !ptr::eq(frame.cast::<u8>(), scaling.cast::<u8>()),
            "the two interfaces must sit at different addresses, or this proves nothing"
        );
        // SAFETY: both pointers borrow the live object this test owns.
        let (frame_identity, scaling_identity) =
            unsafe { (com_identity(frame), com_identity(scaling)) };
        assert!(frame_identity.is_some());
        assert_eq!(frame_identity, scaling_identity);
    }

    /// A `ViewRect` is a rectangle, not an origin and a size: an editor placed
    /// away from the origin is still only as wide as the rect it occupies.
    #[test]
    fn an_editor_size_is_the_extent_of_its_view_rect() {
        assert_eq!(
            EditorSize::from_rect(&ViewRect {
                left: 20,
                top: 30,
                right: 820,
                bottom: 630
            }),
            Some(EditorSize {
                width: 800,
                height: 600
            })
        );
    }
}
