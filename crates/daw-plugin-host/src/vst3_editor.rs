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
//! Every call in this module is a UI/control-path call. None of it is reachable
//! from the audio thread, and none of it takes a lock the audio thread holds:
//! the only shared state is this module's own frame state.
//!
//! `ViewRect` is not one unit on every platform. macOS states it in logical
//! points and the window server applies the backing scale, while Windows and
//! X11 state it in physical pixels and expect the host to have told the plugin
//! what scale it is running at. That is why
//! [`IPlugViewContentScaleSupport`](vst3::Steinberg::IPlugViewContentScaleSupport)
//! is set on those two platforms and not on macOS.

use std::ffi::c_void;
use std::ptr;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use vst3::Steinberg::Vst::{IEditController, IEditControllerTrait, ViewType};
use vst3::Steinberg::{
    kInvalidArgument, kResultFalse, kResultOk, kResultTrue, tresult, FIDString, IPlugFrame,
    IPlugFrameTrait, IPlugView, IPlugViewContentScaleSupport, IPlugViewContentScaleSupportTrait,
    IPlugViewTrait, ViewRect,
};
use vst3::{Class, ComPtr, ComRef, ComWrapper};

use crate::traits::EditorWindowResizer;

#[cfg(unix)]
use crate::vst3_run_loop::HostRunLoop;
#[cfg(target_os = "linux")]
use crate::vst3_run_loop::RunLoopService;
#[cfg(target_os = "linux")]
use vst3::Steinberg::Linux::{
    FileDescriptor, IEventHandler, IRunLoop, IRunLoopTrait, ITimerHandler, TimerInterval,
};

/// The scale the host states to a plugin on the platforms whose `ViewRect` is in
/// physical pixels.
///
/// One, because that is the scale the editor window actually runs at: the window
/// seam sizes windows in logical units and reports no backing scale back, so
/// there is no measurement to pass on. Stating it anyway is not ceremony — a
/// VST3 editor that is never told a scale on Windows or X11 lays itself out
/// against whatever it last assumed, and 1.0 is the truth for the 100% case this
/// host currently creates.
const HOST_CONTENT_SCALE: f32 = 1.0;

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
    /// The view this frame belongs to. Held as a bare pointer for identity only:
    /// the view holds the frame for its whole attached life, and retaining it
    /// back would be a cycle neither side ever breaks.
    view: AtomicPtr<IPlugView>,
    /// How the host resizes the native window the view is drawn into.
    window: Mutex<Option<EditorWindowResizer>>,
    granted_width: AtomicU32,
    granted_height: AtomicU32,
    /// Whether a resize handshake is already on this callstack.
    resizing: AtomicBool,
    /// Nested `resizeView` calls this frame has refused. Read by tests; the
    /// count is what distinguishes "the guard held" from "the plugin never
    /// asked".
    refused_nested_resizes: AtomicU32,
    #[cfg(unix)]
    run_loop: Arc<HostRunLoop>,
}

// SAFETY: the view pointer is used for identity comparison only, and every other
// field is a synchronised primitive or behind a mutex.
unsafe impl Send for EditorFrameState {}
unsafe impl Sync for EditorFrameState {}

impl EditorFrameState {
    fn new(window: Option<EditorWindowResizer>) -> Self {
        Self {
            view: AtomicPtr::new(ptr::null_mut()),
            window: Mutex::new(window),
            granted_width: AtomicU32::new(0),
            granted_height: AtomicU32::new(0),
            resizing: AtomicBool::new(false),
            refused_nested_resizes: AtomicU32::new(0),
            #[cfg(unix)]
            run_loop: Arc::new(HostRunLoop::new()),
        }
    }

    fn adopt(&self, view: &ComPtr<IPlugView>) {
        self.view.store(view.as_ptr(), Ordering::Release);
    }

    fn owns(&self, view: *mut IPlugView) -> bool {
        !view.is_null() && ptr::eq(self.view.load(Ordering::Acquire), view)
    }

    /// Take the resize guard, or report that a handshake is already running.
    ///
    /// The guard is against unbounded recursion, not against synchrony: a plugin
    /// is entitled to ask for another size from inside `onSize` — setting the
    /// content scale is one documented way it happens — and a host that answered
    /// each one would recurse until the stack ran out. Refusing the nested
    /// request leaves the plugin at the size the outer handshake granted, which
    /// is a size it asked for.
    fn begin_resize(&self) -> bool {
        !self.resizing.swap(true, Ordering::AcqRel)
    }

    fn end_resize(&self) {
        self.resizing.store(false, Ordering::Release);
    }

    fn record_granted(&self, size: EditorSize) {
        self.granted_width.store(size.width, Ordering::Release);
        self.granted_height.store(size.height, Ordering::Release);
    }

    fn granted(&self) -> EditorSize {
        EditorSize {
            width: self.granted_width.load(Ordering::Acquire),
            height: self.granted_height.load(Ordering::Acquire),
        }
    }

    /// Resize the native window the view lives in.
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

    #[cfg(unix)]
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
    unsafe fn resizeView(&self, view: *mut IPlugView, new_size: *mut ViewRect) -> tresult {
        if new_size.is_null() || !self.state.owns(view) {
            return kInvalidArgument;
        }
        let Some(requested) = EditorSize::from_rect(&*new_size) else {
            return kInvalidArgument;
        };
        let Some(view) = ComRef::from_raw(view) else {
            return kInvalidArgument;
        };

        if !self.state.begin_resize() {
            self.state
                .refused_nested_resizes
                .fetch_add(1, Ordering::AcqRel);
            return kResultFalse;
        }

        self.state.resize_host_window(requested);
        self.state.record_granted(requested);
        let mut granted = requested.to_rect();
        let result = view.onSize(&mut granted);

        self.state.end_resize();
        result
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

// SAFETY: as the rest of this backend — every VST3 object here is reached under
// the runtime owner's control claim, and released by this type's `Drop`.
unsafe impl Send for Vst3Editor {}
unsafe impl Sync for Vst3Editor {}

impl Vst3Editor {
    /// Create the plugin's editor and attach it to a native window.
    ///
    /// The order is the SDK's own host's: ask whether the platform is supported,
    /// give the view its frame, state the content scale, learn the size, size the
    /// host window to it, attach, and read the size back — because a plugin is
    /// entitled to settle on a different size once it can see its parent.
    pub fn open(
        controller: &ComPtr<IEditController>,
        parent: *mut c_void,
        plugin_name: &str,
        session: EditorSession,
        window: Option<EditorWindowResizer>,
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

        let state = Arc::new(EditorFrameState::new(window));
        state.adopt(&view);
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
        if unsafe { view.setFrame(frame_pointer) } != kResultOk {
            return Err(format!(
                "[VST3] '{plugin_name}' refused the host's plug frame"
            ));
        }

        // Every failure past this point has to take the frame back off the view
        // before releasing it: a view left holding a pointer to a host object
        // whose last reference is about to drop can call into freed memory.
        if let Err(error) = unsafe { attach(&view, &state, parent, view_type, plugin_name) } {
            // SAFETY: the view is live and, on every path here, not attached.
            unsafe { view.setFrame(ptr::null_mut()) };
            return Err(error);
        }

        Ok(Self {
            view,
            _frame: frame,
            #[cfg(target_os = "linux")]
            run_loop_service: Some(RunLoopService::start(Arc::clone(state.run_loop()))),
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

    /// Resize the editor because the *host* wants a different size.
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

            let granted = granted?;
            self.state.record_granted(granted);
            self.state.resize_host_window(granted);
            Ok(granted)
        }
    }

    /// # Safety
    /// Called with the resize guard held, on the control path, with the view
    /// attached.
    unsafe fn negotiate_size(&self, requested: EditorSize) -> Result<EditorSize, String> {
        let mut rect = requested.to_rect();
        if self.view.checkSizeConstraint(&mut rect) != kResultTrue {
            return Err("[VST3] this editor refused the requested size".to_string());
        }
        let constrained = EditorSize::from_rect(&rect)
            .ok_or_else(|| "[VST3] this editor constrained the size to nothing".to_string())?;

        let mut applied = constrained.to_rect();
        if self.view.onSize(&mut applied) != kResultOk {
            return Err("[VST3] this editor refused to move to the constrained size".to_string());
        }
        Ok(constrained)
    }
}

impl Drop for Vst3Editor {
    /// Detach before release, and drop the frame last.
    ///
    /// `removed` is what un-parents the plugin's own child window; a view
    /// released while still attached leaves that window pointing at a host window
    /// that is about to go away. Clearing the frame afterwards means the plugin
    /// cannot call back into a host object whose last reference is about to drop.
    fn drop(&mut self) {
        // The service thread calls into handlers the editor registered, so it
        // stops before anything the editor owns is torn down.
        #[cfg(target_os = "linux")]
        drop(self.run_loop_service.take());

        // SAFETY: the view is attached and live until these two calls.
        unsafe {
            self.view.removed();
            self.view.setFrame(ptr::null_mut());
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
        apply_content_scale(view, HOST_CONTENT_SCALE);
    }

    let preferred = read_view_size(view)
        .ok_or_else(|| format!("[VST3] '{plugin_name}' would not state a size for its editor"))?;
    state.record_granted(preferred);
    state.resize_host_window(preferred);

    if view.attached(parent, view_type) != kResultOk {
        return Err(format!(
            "[VST3] '{plugin_name}' refused to attach its editor to the host window"
        ));
    }

    // A plugin may settle on a different size once it can see its parent, and the
    // window the host is about to show has to match.
    if let Some(attached) = read_view_size(view) {
        state.record_granted(attached);
    }
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
