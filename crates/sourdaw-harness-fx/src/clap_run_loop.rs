//! The editor class's use of `clap.timer-support` and `clap.posix-fd-support`,
//! as an X11 editor uses them: one timer registered from `plugin.init` and
//! never taken back, and, for the life of each editor, a timer and a
//! descriptor of its own — a pipe it keeps readable, standing in for a display
//! connection. What fired, and whether it fired on the thread that created the
//! editor, leaves through the state chunk (see [`crate::state::RunLoopRecord`]).
//!
//! A host that does not offer the extensions gets no registrations, and the
//! record says so.

use crate::state::RunLoopRecord;
use clap_sys::ext::posix_fd_support::{
    clap_host_posix_fd_support, clap_plugin_posix_fd_support, clap_posix_fd_flags,
    CLAP_EXT_POSIX_FD_SUPPORT, CLAP_POSIX_FD_READ,
};
use clap_sys::ext::timer_support::{
    clap_host_timer_support, clap_plugin_timer_support, CLAP_EXT_TIMER_SUPPORT,
};
use clap_sys::host::clap_host;
use clap_sys::id::{clap_id, CLAP_INVALID_ID};
use clap_sys::plugin::clap_plugin;
use std::io::{PipeReader, PipeWriter, Write};
use std::os::fd::AsRawFd;
use std::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering};
use std::sync::Mutex;
use std::thread::ThreadId;

/// The period both timers ask for. Shorter than any pump's turn, so every pass
/// finds them due.
const TIMER_PERIOD_MS: u32 = 1;

/// One editor's registrations, made in `gui.create` and taken back in
/// `gui.destroy`.
struct EditorRegistrations {
    timer: Option<clap_id>,
    pipe: Option<(PipeReader, PipeWriter)>,
    created_on: ThreadId,
}

/// The editor class's run-loop state. `[main-thread]` only, so a lock is
/// allowed.
pub(crate) struct RunLoopFixture {
    host: *const clap_host,
    host_timer: AtomicPtr<clap_host_timer_support>,
    host_posix_fd: AtomicPtr<clap_host_posix_fd_support>,
    init_timer: AtomicU32,
    editor: Mutex<Option<EditorRegistrations>>,
    init_timer_fires: AtomicU32,
    editor_timer_fires: AtomicU32,
    editor_fd_fires: AtomicU32,
    all_on_creating_thread: AtomicBool,
}

// SAFETY: `host` is the `clap_host` the host passed `create_plugin`, valid for
// the instance's life, and it is only dereferenced on the main thread.
unsafe impl Send for RunLoopFixture {}
// SAFETY: as above; every other field is a lock or an atomic.
unsafe impl Sync for RunLoopFixture {}

impl RunLoopFixture {
    pub(crate) fn new(host: *const clap_host) -> Self {
        Self {
            host,
            host_timer: AtomicPtr::new(std::ptr::null_mut()),
            host_posix_fd: AtomicPtr::new(std::ptr::null_mut()),
            init_timer: AtomicU32::new(CLAP_INVALID_ID),
            editor: Mutex::new(None),
            init_timer_fires: AtomicU32::new(0),
            editor_timer_fires: AtomicU32::new(0),
            editor_fd_fires: AtomicU32::new(0),
            all_on_creating_thread: AtomicBool::new(true),
        }
    }

    /// From `plugin.init`: ask for both host extensions, and register the
    /// timer this instance never takes back.
    pub(crate) fn bind_and_register_init_timer(&self) {
        // SAFETY: the instance's live host, on its main thread.
        let timer = unsafe { host_extension(self.host, CLAP_EXT_TIMER_SUPPORT.as_ptr()) };
        // SAFETY: as above.
        let posix_fd = unsafe { host_extension(self.host, CLAP_EXT_POSIX_FD_SUPPORT.as_ptr()) };
        self.host_timer
            .store(timer.cast_mut().cast(), Ordering::Release);
        self.host_posix_fd
            .store(posix_fd.cast_mut().cast(), Ordering::Release);
        if let Some(id) = self.register_timer() {
            self.init_timer.store(id, Ordering::Release);
        }
    }

    /// From `gui.create`: a timer and a readable pipe for this editor.
    pub(crate) fn register_editor(&self) {
        let timer = self.register_timer();
        let pipe = self.register_readable_pipe();
        *self.lock_editor() = Some(EditorRegistrations {
            timer,
            pipe,
            created_on: std::thread::current().id(),
        });
    }

    /// From `gui.destroy`: take back what `register_editor` registered.
    pub(crate) fn unregister_editor(&self) {
        let Some(editor) = self.lock_editor().take() else {
            return;
        };
        if let (Some(id), Some(timer)) = (editor.timer, self.host_timer()) {
            if let Some(unregister) = timer.unregister_timer {
                // SAFETY: the host's `[main-thread]` callback, on its own pointer.
                unsafe { unregister(self.host, id) };
            }
        }
        if let (Some((reader, _)), Some(posix_fd)) = (&editor.pipe, self.host_posix_fd()) {
            if let Some(unregister) = posix_fd.unregister_fd {
                // SAFETY: the host's `[main-thread]` callback, on its own pointer.
                unsafe { unregister(self.host, reader.as_raw_fd()) };
            }
        }
    }

    pub(crate) fn record(&self) -> RunLoopRecord {
        RunLoopRecord {
            offered: self.host_timer().is_some() && self.host_posix_fd().is_some(),
            init_timer_fires: self.init_timer_fires.load(Ordering::Acquire),
            editor_timer_fires: self.editor_timer_fires.load(Ordering::Acquire),
            editor_fd_fires: self.editor_fd_fires.load(Ordering::Acquire),
            all_on_creating_thread: self.all_on_creating_thread.load(Ordering::Acquire),
        }
    }

    fn on_timer(&self, id: clap_id) {
        if id == self.init_timer.load(Ordering::Acquire) {
            self.init_timer_fires.fetch_add(1, Ordering::AcqRel);
            return;
        }
        let editor = self.lock_editor();
        let Some(registrations) = editor.as_ref() else {
            return;
        };
        if registrations.timer == Some(id) {
            self.editor_timer_fires.fetch_add(1, Ordering::AcqRel);
            self.note_thread(registrations.created_on);
        }
    }

    fn on_fd(&self, fd: i32, flags: clap_posix_fd_flags) {
        let editor = self.lock_editor();
        let Some(registrations) = editor.as_ref() else {
            return;
        };
        let is_ours = registrations
            .pipe
            .as_ref()
            .is_some_and(|(reader, _)| reader.as_raw_fd() == fd);
        if is_ours && flags & CLAP_POSIX_FD_READ != 0 {
            self.editor_fd_fires.fetch_add(1, Ordering::AcqRel);
            self.note_thread(registrations.created_on);
        }
    }

    fn note_thread(&self, created_on: ThreadId) {
        if std::thread::current().id() != created_on {
            self.all_on_creating_thread.store(false, Ordering::Release);
        }
    }

    fn register_timer(&self) -> Option<clap_id> {
        let register = self.host_timer()?.register_timer?;
        let mut id = CLAP_INVALID_ID;
        // SAFETY: the host's `[main-thread]` callback, on its own pointer, with a
        // writable id.
        let registered = unsafe { register(self.host, TIMER_PERIOD_MS, &mut id) };
        registered.then_some(id)
    }

    /// A pipe holding one unread byte, registered for reading. Never drained,
    /// so it stays readable for as long as it is registered.
    fn register_readable_pipe(&self) -> Option<(PipeReader, PipeWriter)> {
        let register = self.host_posix_fd()?.register_fd?;
        let (reader, mut writer) = std::io::pipe().ok()?;
        writer.write_all(b"x").ok()?;
        // SAFETY: the host's `[main-thread]` callback, on its own pointer, for a
        // descriptor this instance owns.
        let registered = unsafe { register(self.host, reader.as_raw_fd(), CLAP_POSIX_FD_READ) };
        registered.then_some((reader, writer))
    }

    fn host_timer(&self) -> Option<&clap_host_timer_support> {
        let extension = self.host_timer.load(Ordering::Acquire);
        // SAFETY: null, or a host extension struct, which lives as long as the host.
        unsafe { extension.as_ref() }
    }

    fn host_posix_fd(&self) -> Option<&clap_host_posix_fd_support> {
        let extension = self.host_posix_fd.load(Ordering::Acquire);
        // SAFETY: null, or a host extension struct, which lives as long as the host.
        unsafe { extension.as_ref() }
    }

    fn lock_editor(&self) -> std::sync::MutexGuard<'_, Option<EditorRegistrations>> {
        self.editor
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// # Safety
/// `host` is null or a live `clap_host`, and `id` is NUL-terminated.
unsafe fn host_extension(
    host: *const clap_host,
    id: *const std::ffi::c_char,
) -> *const std::ffi::c_void {
    if host.is_null() {
        return std::ptr::null();
    }
    // SAFETY: non-null (checked above) and live (this fn's contract).
    let Some(get_extension) = (unsafe { (*host).get_extension }) else {
        return std::ptr::null();
    };
    // SAFETY: the host's own callback, on its own pointer, with a NUL-terminated id.
    unsafe { get_extension(host, id) }
}

// ── clap.timer-support / clap.posix-fd-support ───────────────────────────

pub(crate) static TIMER_SUPPORT: clap_plugin_timer_support = clap_plugin_timer_support {
    on_timer: Some(on_timer),
};

pub(crate) static POSIX_FD_SUPPORT: clap_plugin_posix_fd_support =
    clap_plugin_posix_fd_support { on_fd: Some(on_fd) };

unsafe extern "C" fn on_timer(plugin: *const clap_plugin, timer_id: clap_id) {
    // SAFETY: the host passes the plugin it created.
    if let Some(gui) = unsafe { crate::clap_front::gui_of(plugin) } {
        gui.run_loop().on_timer(timer_id);
    }
}

unsafe extern "C" fn on_fd(plugin: *const clap_plugin, fd: i32, flags: clap_posix_fd_flags) {
    // SAFETY: the host passes the plugin it created.
    if let Some(gui) = unsafe { crate::clap_front::gui_of(plugin) } {
        gui.run_loop().on_fd(fd, flags);
    }
}
