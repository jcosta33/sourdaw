//! The editor class's `clap.gui`: an embedded editor with no pixels, which
//! records every call the host makes into it and, when commanded, does what a
//! plugin's own editor does unprompted — reports itself closed, changes its
//! resize constraints, asks for its window to be hidden or shown.
//!
//! Commands arrive as writes to the `Command` parameter, delivered in a
//! process call, so a host test drives them through the ordinary block path.
//! Everything recorded leaves through the state chunk (see
//! [`crate::state::GuiRecord`]).

use crate::clap_front::gui_of;
#[cfg(unix)]
use crate::clap_run_loop::RunLoopFixture;
use crate::state::{self, GuiCall, RunLoopRecord, GUI_CALLS_KEPT};
use clap_sys::ext::gui::{
    clap_gui_resize_hints, clap_host_gui, clap_plugin_gui, clap_window, CLAP_EXT_GUI,
};
use clap_sys::host::clap_host;
use clap_sys::plugin::clap_plugin;
use std::ffi::c_char;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, AtomicUsize, Ordering};

/// The `Command` parameter's id, on the editor class only.
pub const COMMAND_PARAM_ID: u32 = 1;
/// The editor's reported size, in either unit: nothing checks it.
const EDITOR_SIZE: (u32, u32) = (400, 300);

/// What a write to `Command` makes the editor do, by the value written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GuiCommand {
    /// Report the editor closed and already destroyed, from a thread of the
    /// plugin's own: `closed` is `[thread-safe]`, and a plugin whose editor
    /// lost its connection reports it from wherever it noticed.
    CloseDestroyed,
    /// Flip what `can_resize` answers, then call `resize_hints_changed`.
    ToggleResizable,
    /// Flip whether `get_resize_hints` refuses both axes, then call
    /// `resize_hints_changed`. `can_resize` keeps its answer.
    ToggleAxesRefused,
    /// Call `request_hide` and record the answer.
    RequestHide,
    /// Call `request_show` and record the answer.
    RequestShow,
}

impl GuiCommand {
    /// The `Command` value that issues this command.
    pub const fn value(self) -> f64 {
        match self {
            Self::CloseDestroyed => 1.0,
            Self::ToggleResizable => 2.0,
            Self::ToggleAxesRefused => 5.0,
            Self::RequestHide => 3.0,
            Self::RequestShow => 4.0,
        }
    }

    fn from_value(value: f64) -> Option<Self> {
        match value.round() as i64 {
            1 => Some(Self::CloseDestroyed),
            2 => Some(Self::ToggleResizable),
            5 => Some(Self::ToggleAxesRefused),
            3 => Some(Self::RequestHide),
            4 => Some(Self::RequestShow),
            _ => None,
        }
    }
}

/// The host pointer CLAP handed this instance, carried to the plugin's own
/// thread for a `[thread-safe]` callback.
#[derive(Clone, Copy)]
struct HostHandle(*const clap_host);

// SAFETY: the pointer is the `clap_host` the host passed `create_plugin`, valid
// for the instance's whole life; it is only dereferenced to make the callbacks
// gui.h marks `[thread-safe]`.
unsafe impl Send for HostHandle {}

impl HostHandle {
    fn get(self) -> *const clap_host {
        self.0
    }
}

/// The editor class's per-instance editor state. Every field is atomic: the
/// host calls `clap.gui` on its main thread while commands run on the audio
/// thread.
pub(crate) struct GuiFixture {
    host: HostHandle,
    host_gui: AtomicPtr<clap_host_gui>,
    can_resize: AtomicBool,
    axes_refused: AtomicBool,
    calls: [AtomicU8; GUI_CALLS_KEPT],
    call_count: AtomicUsize,
    show_answer: AtomicU8,
    hide_answer: AtomicU8,
    /// The editor's timers and descriptor, registered with the host's run loop.
    #[cfg(unix)]
    run_loop: RunLoopFixture,
}

impl GuiFixture {
    pub(crate) fn new(host: *const clap_host) -> Self {
        Self {
            host: HostHandle(host),
            host_gui: AtomicPtr::new(std::ptr::null_mut()),
            can_resize: AtomicBool::new(false),
            axes_refused: AtomicBool::new(false),
            calls: std::array::from_fn(|_| AtomicU8::new(0)),
            call_count: AtomicUsize::new(0),
            show_answer: AtomicU8::new(state::encode_answer(None)),
            hide_answer: AtomicU8::new(state::encode_answer(None)),
            #[cfg(unix)]
            run_loop: RunLoopFixture::new(host),
        }
    }

    #[cfg(unix)]
    pub(crate) fn run_loop(&self) -> &RunLoopFixture {
        &self.run_loop
    }

    /// From `plugin.init`: bind the host's `clap.gui`, and its run-loop
    /// extensions where it offers them.
    pub(crate) fn bind_host(&self) {
        self.bind_host_gui();
        #[cfg(unix)]
        self.run_loop.bind_and_register_init_timer();
    }

    #[cfg(unix)]
    fn run_loop_record(&self) -> RunLoopRecord {
        self.run_loop.record()
    }

    #[cfg(not(unix))]
    fn run_loop_record(&self) -> RunLoopRecord {
        RunLoopRecord::default()
    }

    /// Ask the host for its `clap.gui`. From `plugin.init`, where gui.h
    /// expects a plugin to query host extensions.
    fn bind_host_gui(&self) {
        let host = self.host.get();
        if host.is_null() {
            return;
        }
        // SAFETY: the host pointer is live for the instance's life (see `HostHandle`).
        let Some(get_extension) = (unsafe { (*host).get_extension }) else {
            return;
        };
        // SAFETY: the host's own callback, on its own pointer, with a static id.
        let extension = unsafe { get_extension(host, CLAP_EXT_GUI.as_ptr()) };
        self.host_gui
            .store(extension as *mut clap_host_gui, Ordering::Release);
    }

    fn host_gui(&self) -> Option<&clap_host_gui> {
        let extension = self.host_gui.load(Ordering::Acquire);
        if extension.is_null() {
            return None;
        }
        // SAFETY: a host extension struct lives as long as the host that returned it.
        Some(unsafe { &*extension })
    }

    fn record(&self, call: GuiCall) {
        let index = self.call_count.fetch_add(1, Ordering::Relaxed);
        if let Some(slot) = self.calls.get(index) {
            slot.store(call.code(), Ordering::Relaxed);
        }
    }

    pub(crate) fn append_record(&self, chunk: &mut Vec<u8>) {
        let codes = std::array::from_fn(|index| self.calls[index].load(Ordering::Relaxed));
        let answers = [
            self.show_answer.load(Ordering::Relaxed),
            self.hide_answer.load(Ordering::Relaxed),
        ];
        state::append_gui_record(
            chunk,
            &codes,
            self.call_count.load(Ordering::Relaxed),
            answers,
            self.can_resize.load(Ordering::Relaxed),
            self.run_loop_record(),
        );
    }

    /// Carry out one `Command` write.
    pub(crate) fn run_command(&self, value: f64) {
        let Some(command) = GuiCommand::from_value(value) else {
            return;
        };
        let Some(gui) = self.host_gui() else {
            return;
        };
        let host = self.host.get();
        match command {
            GuiCommand::CloseDestroyed => self.report_closed_from_own_thread(gui),
            GuiCommand::ToggleResizable => {
                self.can_resize.fetch_xor(true, Ordering::Relaxed);
                Self::announce_resize_hints_changed(gui, host);
            }
            GuiCommand::ToggleAxesRefused => {
                self.axes_refused.fetch_xor(true, Ordering::Relaxed);
                Self::announce_resize_hints_changed(gui, host);
            }
            GuiCommand::RequestHide => {
                if let Some(request_hide) = gui.request_hide {
                    // SAFETY: the host's `[thread-safe]` callback, on its own pointer.
                    let answer = unsafe { request_hide(host) };
                    self.hide_answer
                        .store(state::encode_answer(Some(answer)), Ordering::Relaxed);
                }
            }
            GuiCommand::RequestShow => {
                if let Some(request_show) = gui.request_show {
                    // SAFETY: the host's `[thread-safe]` callback, on its own pointer.
                    let answer = unsafe { request_show(host) };
                    self.show_answer
                        .store(state::encode_answer(Some(answer)), Ordering::Relaxed);
                }
            }
        }
    }

    fn announce_resize_hints_changed(gui: &clap_host_gui, host: *const clap_host) {
        let Some(resize_hints_changed) = gui.resize_hints_changed else {
            return;
        };
        // SAFETY: the host's `[thread-safe & !floating]` callback, on its own
        // pointer, for this embedded editor.
        unsafe { resize_hints_changed(host) };
    }

    /// Report the editor destroyed from a thread this plugin started, joined
    /// before returning. Spawning allocates, which a real-time plugin would
    /// not do in `process`; the fixture does so only on command, to put the
    /// call on a thread that is neither the host's main nor its audio thread.
    fn report_closed_from_own_thread(&self, gui: &clap_host_gui) {
        let Some(closed) = gui.closed else {
            return;
        };
        let host = self.host;
        std::thread::scope(|scope| {
            scope.spawn(move || {
                // SAFETY: the host's `[thread-safe]` callback, on its own pointer.
                unsafe { closed(host.get(), true) };
            });
        });
    }
}

// ── clap.gui ────────────────────────────────────────────────────────────

pub(crate) static GUI: clap_plugin_gui = clap_plugin_gui {
    is_api_supported: Some(gui_is_api_supported),
    get_preferred_api: None,
    create: Some(gui_create),
    destroy: Some(gui_destroy),
    set_scale: Some(gui_set_scale),
    get_size: Some(gui_get_size),
    can_resize: Some(gui_can_resize),
    get_resize_hints: Some(gui_get_resize_hints),
    adjust_size: Some(gui_adjust_size),
    set_size: Some(gui_set_size),
    set_parent: Some(gui_set_parent),
    set_transient: None,
    suggest_title: None,
    show: Some(gui_show),
    hide: Some(gui_hide),
};

/// Record `call` against the instance's editor, answering whether it has one.
///
/// # Safety
/// `plugin` must be null or a live `clap_plugin` from `create_plugin`.
unsafe fn record(plugin: *const clap_plugin, call: GuiCall) -> bool {
    // SAFETY: the caller's contract.
    match unsafe { gui_of(plugin) } {
        Some(gui) => {
            gui.record(call);
            true
        }
        None => false,
    }
}

/// Embedded only: the class exercises the embedded editor's host side.
unsafe extern "C" fn gui_is_api_supported(
    _plugin: *const clap_plugin,
    _api: *const c_char,
    is_floating: bool,
) -> bool {
    !is_floating
}

unsafe extern "C" fn gui_create(
    plugin: *const clap_plugin,
    _api: *const c_char,
    is_floating: bool,
) -> bool {
    // SAFETY: the host passes the plugin it created.
    let created = !is_floating && unsafe { record(plugin, GuiCall::Create) };
    #[cfg(unix)]
    if created {
        // SAFETY: as above.
        if let Some(gui) = unsafe { gui_of(plugin) } {
            gui.run_loop.register_editor();
        }
    }
    created
}

unsafe extern "C" fn gui_destroy(plugin: *const clap_plugin) {
    // SAFETY: the host passes the plugin it created.
    unsafe { record(plugin, GuiCall::Destroy) };
    #[cfg(unix)]
    // SAFETY: as above.
    if let Some(gui) = unsafe { gui_of(plugin) } {
        gui.run_loop.unregister_editor();
    }
}

unsafe extern "C" fn gui_set_scale(_plugin: *const clap_plugin, _scale: f64) -> bool {
    true
}

unsafe extern "C" fn gui_get_size(
    _plugin: *const clap_plugin,
    width: *mut u32,
    height: *mut u32,
) -> bool {
    if width.is_null() || height.is_null() {
        return false;
    }
    // SAFETY: `width` is a valid out parameter.
    unsafe { *width = EDITOR_SIZE.0 };
    // SAFETY: `height` is a valid out parameter.
    unsafe { *height = EDITOR_SIZE.1 };
    true
}

unsafe extern "C" fn gui_can_resize(plugin: *const clap_plugin) -> bool {
    // SAFETY: the host passes the plugin it created.
    unsafe { gui_of(plugin) }.is_some_and(|gui| gui.can_resize.load(Ordering::Relaxed))
}

/// Both axes free unless `ToggleAxesRefused` refused them: whether the editor
/// resizes is then `can_resize`'s answer alone, or refused outright.
unsafe extern "C" fn gui_get_resize_hints(
    plugin: *const clap_plugin,
    hints: *mut clap_gui_resize_hints,
) -> bool {
    if hints.is_null() {
        return false;
    }
    // SAFETY: the host passes the plugin it created.
    let axes_free =
        unsafe { gui_of(plugin) }.is_none_or(|gui| !gui.axes_refused.load(Ordering::Relaxed));
    // SAFETY: `hints` is a valid out parameter.
    unsafe {
        *hints = clap_gui_resize_hints {
            can_resize_horizontally: axes_free,
            can_resize_vertically: axes_free,
            preserve_aspect_ratio: false,
            aspect_ratio_width: 0,
            aspect_ratio_height: 0,
        }
    };
    true
}

unsafe extern "C" fn gui_adjust_size(
    _plugin: *const clap_plugin,
    _width: *mut u32,
    _height: *mut u32,
) -> bool {
    true
}

unsafe extern "C" fn gui_set_size(_plugin: *const clap_plugin, _width: u32, _height: u32) -> bool {
    true
}

/// Any parent: the editor draws nothing into it.
unsafe extern "C" fn gui_set_parent(
    _plugin: *const clap_plugin,
    _window: *const clap_window,
) -> bool {
    true
}

unsafe extern "C" fn gui_show(plugin: *const clap_plugin) -> bool {
    // SAFETY: the host passes the plugin it created.
    unsafe { record(plugin, GuiCall::Show) }
}

unsafe extern "C" fn gui_hide(plugin: *const clap_plugin) -> bool {
    // SAFETY: the host passes the plugin it created.
    unsafe { record(plugin, GuiCall::Hide) }
}
