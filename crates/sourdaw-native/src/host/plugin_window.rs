//! Host seam for the bare native windows CLAP editors are drawn into.
//!
//! A plugin editor is not a webview: the host creates an empty native window,
//! hands the plugin its native handle, and the plugin draws into it. Creating
//! and destroying that window is the one part of the flow that belongs to the
//! desktop shell, so it lives behind this trait; the CLAP lifecycle, the
//! bookkeeping and the close/hide/show decisions belong to the command body and
//! stay in this crate.
//!
//! The seam carries the shell's UI thread as well as its windows
//! ([`crate::host::ui_thread::UiThread`]), because they are the same thing: a
//! window may only be touched from the thread that made it, and so may the
//! plugin editor drawn into it.
//!
//! No method here may be called from the audio thread — every one of them
//! reaches the platform's window server.

use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, Ordering};

use raw_window_handle::RawWindowHandle;

use crate::host::ui_thread::UiThread;

/// Label the shell gives the DAW's own window.
///
/// Shared with the shell because editor ownership is decided against it: the
/// editor window is *owned* by this window, and ownership is a destruction
/// cascade as well as a z-order relationship.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Label prefix every plugin editor window is created under.
pub const PLUGIN_WINDOW_LABEL_PREFIX: &str = "plugin-";

/// The window label for one *opening* of one instance's editor.
///
/// Two parts, separated by `:`. The instance id is escaped into the label
/// charset, and `open_sequence` — a number no two openings in this process share
/// — follows it.
///
/// The sequence is what makes a label name an opening rather than an instance.
/// An editor can be closed and reopened, and the shell reports a close by
/// echoing back the label it was given; a label that was a pure function of the
/// instance id would make the report for a window that is already gone
/// indistinguishable from a report for the editor that replaced it, and acting
/// on it would tear down the live editor. With the sequence in the label, the
/// recorded label and a superseded report simply do not match.
///
/// The separator is safe because the escaping below never emits `:` — it is
/// encoded as `-c` — so the two parts cannot be confused for one another and the
/// whole label stays injective.
///
/// Dots and colons are escaped because window labels are restricted to a smaller
/// alphabet than instance ids are: labels accept only ASCII alphanumerics,
/// `-`, `/`, `:` and `_`. The charset is the crate's own label contract
/// (inherited from the strictest shell that ever consumed it), so a label is
/// safe to hand any shell verbatim. Instance ids do not come from a
/// controlled vocabulary — they are lossy-decoded (`CStr::to_string_lossy`)
/// from a vendor-supplied CLAP descriptor id, so anything can appear: spaces,
/// arbitrary punctuation, `U+FFFD` from invalid UTF-8.
///
/// The escaping is injective, which a flat character substitution is not: two
/// instance ids that differ only in which of `.`, `:` or `-` they use — e.g.
/// `"a.b"`, `"a:b"`, `"a-b"` — must not collapse onto the same label, or the
/// second instance's editor either refuses to open ("already open") or is
/// addressed through the first instance's window on close/destroy. `-` is the
/// escape character:
///
/// - a literal `-` is doubled to `--`
/// - `.` becomes `-d`, `:` becomes `-c`
/// - every other character outside `{ASCII alphanumeric, '/', '_'}` — the
///   catch-all for anything a vendor descriptor id can contain — becomes the
///   fixed-width unit `-x` followed by its Unicode scalar value as six lowercase
///   hex digits (`-x000020` for a space, `-x01f4a9` for a four-byte code point)
///
/// Every escape unit starts with `-` and is a fixed length once its second
/// character (`-`, `d`, `c`, or `x`) is known, so `-` never appears in the
/// output except as the start of one of these four unambiguous units. The
/// encoding can therefore be scanned left to right and unambiguously decoded
/// back into the original id. A function with a well-defined left inverse is
/// injective, so distinct ids always produce distinct labels — and every
/// character in the output is inside the label charset.
pub fn plugin_editor_window_label(instance_id: &str, open_sequence: u64) -> String {
    let mut escaped = String::with_capacity(instance_id.len());
    for ch in instance_id.chars() {
        match ch {
            '-' => escaped.push_str("--"),
            '.' => escaped.push_str("-d"),
            ':' => escaped.push_str("-c"),
            other if other.is_ascii_alphanumeric() || other == '/' || other == '_' => {
                escaped.push(other)
            }
            other => escaped.push_str(&format!("-x{:06x}", other as u32)),
        }
    }
    format!(
        "{}{}:{}",
        PLUGIN_WINDOW_LABEL_PREFIX, escaped, open_sequence
    )
}

/// Claim the next editor-opening sequence number.
///
/// Process-global and monotonic, so no two openings — of one instance or of
/// different ones — ever share a label. Not per instance: an instance id is
/// reusable across a load/unload cycle, and a counter that restarted with it
/// would hand a fresh editor a label a stale close report still names.
pub fn next_editor_open_sequence() -> u64 {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    NEXT.fetch_add(1, Ordering::Relaxed)
}

/// Whether every character in a window label is inside the label charset
/// (ASCII alphanumeric, `-`, `/`, `:`, `_`). Test-only: it is what a
/// consumer of [`plugin_editor_window_label`] can rely on, not a runtime gate.
#[cfg(test)]
fn is_valid_window_label(label: &str) -> bool {
    label
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '/' | ':' | '_'))
}

/// Whether a plugin editor window still needs `always_on_top`.
///
/// Only when the platform refused, or had no, parent window. A parented editor
/// already sits above the DAW and only the DAW: Windows owner windows are always
/// above their owner, macOS `addChildWindow` orders the child above its parent,
/// and X11/Wayland `transient_for` tells the WM the same thing. Keeping
/// `always_on_top` on top of that is what put plugin editors above unrelated
/// applications — a floating editor covering a browser while the DAW is in the
/// background is not the professional convention. Without a parent the flag is
/// the only thing keeping the editor reachable, so it stays.
///
/// Parenting is not a free equivalence, and the difference is deliberate. On
/// macOS `addChildWindow` also makes the child *follow the parent's moves*: drag
/// the main window and every open editor travels with it, which a separately
/// placed floating editor would not do. Established hosts accept exactly this
/// tradeoff — correct z-order and correct focus behaviour are worth more to a
/// working musician than independently parked editor windows — and so does
/// Sourdaw.
pub fn plugin_editor_needs_always_on_top(parented: bool) -> bool {
    !parented
}

/// The pointer a CLAP plugin's GUI extension expects for a window.
///
/// One cast per windowing system, and the set is closed: a platform this does
/// not name cannot host an embedded editor at all, and saying so is better than
/// handing the plugin a pointer of the wrong kind.
pub fn native_editor_handle_ptr(handle: RawWindowHandle) -> Result<*mut c_void, String> {
    match handle {
        RawWindowHandle::AppKit(h) => Ok(h.ns_view.as_ptr()),
        #[cfg(target_os = "windows")]
        RawWindowHandle::Win32(h) => Ok(h.hwnd.get() as *mut c_void),
        RawWindowHandle::Xlib(h) => Ok(h.window as *mut c_void),
        _ => Err("Unsupported platform for plugin GUI".to_string()),
    }
}

/// The native pointer a shell delivered as raw bytes.
///
/// Electron's `getNativeWindowHandle()` hands the platform handle as a byte
/// buffer holding the pointer's memory representation — NSView* on macOS, HWND
/// on Windows, an X11 window id on Linux — so the cast back is a native-endian
/// read of exactly one pointer. Any other length is a corrupt handle and is
/// refused: handing the CLAP GUI extension a truncated pointer is a crash
/// inside the plugin, not an error here.
pub fn native_handle_from_bytes(bytes: &[u8]) -> Result<usize, String> {
    let array: [u8; size_of::<usize>()] = bytes.try_into().map_err(|_| {
        format!(
            "Native window handle must be {} bytes, got {}",
            size_of::<usize>(),
            bytes.len()
        )
    })?;
    Ok(usize::from_ne_bytes(array))
}

/// One live editor window.
///
/// Commands address a window by label through [`PluginWindowHost`], because the
/// recorded label is what survives across them. This handle outlives
/// `open_plugin_gui` for one reason: a plugin editor resizes *itself*, at any
/// point while it is open and from inside its own call into the host, and the
/// resizer it is given has to reach a window without a command to carry it. An
/// implementation therefore holds a label rather than a live window object, and
/// tolerates being asked to size a window the platform has already ended.
pub trait PluginEditorWindow: Send + Sync {
    /// The native handle to hand the plugin, already cast for this platform.
    fn native_handle_ptr(&self) -> Result<*mut c_void, String>;

    /// Resize to the plugin's preferred editor size, in logical units.
    ///
    /// Returns only once the shell has applied the request to its window. A
    /// plugin mid-handshake is told the size it was granted the instant this
    /// returns — VST3 states that order outright, and an editor told it before
    /// the host acted lays itself out against the old size — so an
    /// implementation that merely queued the request would answer for work it
    /// had not done.
    ///
    /// Applied, not granted: on X11 and Wayland a content-size call is a request
    /// to the window manager, which may honour it late or not at all, and no
    /// host can promise otherwise. What the caller may rely on is the ordering —
    /// the shell's own resize ran before this returned — which is the same thing
    /// conventional hosts rely on when they answer `onSize` right after asking
    /// the platform.
    fn set_size(&self, width: u32, height: u32);

    /// Whether the user may drag this window's edges.
    ///
    /// Stated after the editor opens rather than at creation, because that is
    /// where the answer first exists: both formats answer it through a view the
    /// plugin has not created yet. A window is therefore built fixed and widened
    /// here, which is the safe order — a window the user cannot drag until the
    /// editor is up costs nothing, and one that could be dragged before the
    /// plugin was asked can be dragged to a size it refuses.
    fn set_resizable(&self, resizable: bool);

    /// The display scale this window was created at.
    ///
    /// A plugin editor is not always sized in the same units the window is: VST3
    /// states its editor rect in physical pixels on Windows and X11, and expects
    /// to be told the scale it is running at. The shell is the only side that
    /// can measure it, so it reports it here, once, at creation.
    ///
    /// The default is [`daw_plugin_host::DEFAULT_EDITOR_CONTENT_SCALE`], for an
    /// implementation with no display to measure — the scan worker and the tests
    /// both have none.
    fn scale_factor(&self) -> f64 {
        daw_plugin_host::DEFAULT_EDITOR_CONTENT_SCALE
    }

    /// Make the window visible and give it focus.
    fn show_and_focus(&self);

    /// Destroy the window. Used on every failure path after creation.
    fn destroy(&self);
}

/// Apply one editor resize on the UI thread, and return only once it has been
/// applied.
///
/// [`PluginEditorWindow::set_size`]'s ordering contract, in one place, because
/// it is the whole difference between a resize and a resize request: a plugin
/// reads the answer as the size its window now has. A resize raised on the UI
/// thread — a view laying itself out inside its own attach — is applied where it
/// stands; one raised anywhere else crosses and waits there.
///
/// The outcome is discarded for the same reason a fire-and-forget window call
/// discards its status: a window the shell no longer has is not a failure of the
/// resize, and a plugin mid-handshake has nowhere to be told about one.
pub fn apply_editor_size_on_ui_thread<Ui: UiThread + ?Sized>(
    ui: &Ui,
    apply: impl FnOnce() + Send + 'static,
) {
    let _ = crate::host::ui_thread::call_on_ui_thread(ui, apply);
}

/// Creates and addresses the native windows plugin editors are drawn into, and
/// is the thread they live on.
pub trait PluginWindowHost: UiThread {
    /// Whether a window with this label already exists.
    fn window_exists(&self, label: &str) -> bool;

    /// Create a hidden, bare native window for one plugin editor.
    ///
    /// The implementation owns two things the body cannot express: owning the
    /// window by the DAW window (falling back to
    /// [`plugin_editor_needs_always_on_top`] when the platform refuses), and
    /// wiring the OS-close path — when the platform asks to end this window, the
    /// shell must run [`crate::commands::plugin_gui::reset_plugin_gui_state_after_os_close`]
    /// for `(instance_id, label)`, off the event thread and before the window is
    /// destroyed. Without that wiring a title-bar close leaves the plugin's
    /// internal GUI alive and the instance permanently unopenable; with it in
    /// the wrong order it un-parents the plugin's child window from a parent the
    /// platform has already destroyed.
    ///
    /// That wiring is attached here, at creation — before the window is
    /// published to `plugin_windows` — and not after the caller finishes
    /// sizing and showing: a window that exists with no close handling is a
    /// leak, and the trait has no "wire this later" step to defer it to. The
    /// consequence is that the reset path must tolerate a close event for a
    /// window that was never published, which it does: label removal is
    /// compare-and-remove against an absent entry, and `close_gui` returns
    /// early when the plugin's GUI was never opened.
    fn create_editor_window(
        &self,
        label: &str,
        title: &str,
        instance_id: &str,
    ) -> Result<Box<dyn PluginEditorWindow>, String>;

    /// Destroy the window with this label, if it still exists.
    fn destroy_window(&self, label: &str);

    /// Hide the window with this label, if it still exists.
    fn hide_window(&self, label: &str);

    /// Show the window with this label, if it still exists.
    fn show_window(&self, label: &str);
}

/// Window host for a process with no window server attached: the scan worker,
/// the tests, and the Node addon until packet E4 wires real windows.
///
/// Creation fails rather than silently succeeding — an editor that reports
/// itself open with no window behind it is worse than one that refuses.
pub struct NoWindowHost;

/// No shell, so no thread of its own: the defaults run editor calls where the
/// caller stands, which is the only thread there is.
impl UiThread for NoWindowHost {}

impl PluginWindowHost for NoWindowHost {
    fn window_exists(&self, _label: &str) -> bool {
        false
    }

    fn create_editor_window(
        &self,
        _label: &str,
        _title: &str,
        _instance_id: &str,
    ) -> Result<Box<dyn PluginEditorWindow>, String> {
        Err("This host cannot create plugin editor windows".to_string())
    }

    fn destroy_window(&self, _label: &str) {}

    fn hide_window(&self, _label: &str) {}

    fn show_window(&self, _label: &str) {}
}

/// A window host with a UI thread of its own, for the tests of every path that
/// has to reach one.
///
/// Shared rather than per-module because "which thread reached the plugin" is
/// asked of the GUI commands and of the unload path alike, and two copies of the
/// fake would let one of them drift into answering it the easy way.
#[cfg(test)]
pub mod testing {
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::thread::{self, JoinHandle, ThreadId};

    use super::{PluginEditorWindow, PluginWindowHost};
    use crate::host::ui_thread::{UiThread, UiThreadTask};

    /// A shell's main loop, reduced to the one thing that matters here: a thread
    /// of its own that does nothing but drain the editor work posted to it.
    ///
    /// That is what makes the thread question answerable — the id it records can
    /// only appear in a plugin fixture's log if the call was actually carried
    /// here.
    pub struct DedicatedUiWindowHost {
        work: mpsc::Sender<Arc<UiThreadTask>>,
        pub thread_id: ThreadId,
        thread: Mutex<Option<JoinHandle<()>>>,
        editor_resizable: Arc<Mutex<Option<bool>>>,
    }

    impl DedicatedUiWindowHost {
        /// What the host told this shell's editor window about dragging its
        /// edges, or `None` if it was never told.
        pub fn editor_resizable(&self) -> Option<bool> {
            *self.editor_resizable.lock().expect("resizable record")
        }

        pub fn start() -> Self {
            let (work, queued) = mpsc::channel::<Arc<UiThreadTask>>();
            let (announce, announced) = mpsc::channel();
            let thread = thread::spawn(move || {
                announce
                    .send(thread::current().id())
                    .expect("the fake UI thread must announce itself");
                while let Ok(task) = queued.recv() {
                    task.run();
                }
            });
            let thread_id = announced.recv().expect("the fake UI thread must start");
            Self {
                work,
                thread_id,
                thread: Mutex::new(Some(thread)),
                editor_resizable: Arc::new(Mutex::new(None)),
            }
        }
    }

    impl Drop for DedicatedUiWindowHost {
        fn drop(&mut self) {
            let (closed, _) = mpsc::channel();
            drop(std::mem::replace(&mut self.work, closed));
            if let Some(thread) = self.thread.lock().expect("ui thread handle").take() {
                let _ = thread.join();
            }
        }
    }

    impl UiThread for DedicatedUiWindowHost {
        fn is_ui_thread(&self) -> bool {
            thread::current().id() == self.thread_id
        }

        fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> Result<(), String> {
            let (done, waited) = mpsc::sync_channel(1);
            let queued = Arc::clone(task);
            self.work
                .send(UiThreadTask::new(move || {
                    queued.run();
                    let _ = done.send(());
                }))
                .map_err(|_| "the fake UI thread is gone".to_string())?;
            waited
                .recv()
                .map_err(|_| "the fake UI thread never answered".to_string())
        }
    }

    /// A window with no platform behind it: enough for an editor to be opened
    /// into, and it remembers the one thing a host tells it that a test asks
    /// about.
    pub struct BareEditorWindow {
        resizable: Arc<Mutex<Option<bool>>>,
    }

    impl PluginEditorWindow for BareEditorWindow {
        fn native_handle_ptr(&self) -> Result<*mut std::ffi::c_void, String> {
            Ok(std::ptr::null_mut())
        }

        fn set_size(&self, _width: u32, _height: u32) {}

        fn set_resizable(&self, resizable: bool) {
            *self.resizable.lock().expect("resizable record") = Some(resizable);
        }

        fn show_and_focus(&self) {}

        fn destroy(&self) {}
    }

    impl PluginWindowHost for DedicatedUiWindowHost {
        fn window_exists(&self, _label: &str) -> bool {
            false
        }

        fn create_editor_window(
            &self,
            _label: &str,
            _title: &str,
            _instance_id: &str,
        ) -> Result<Box<dyn PluginEditorWindow>, String> {
            Ok(Box::new(BareEditorWindow {
                resizable: Arc::clone(&self.editor_resizable),
            }))
        }

        fn destroy_window(&self, _label: &str) {}

        fn hide_window(&self, _label: &str) {}

        fn show_window(&self, _label: &str) {}
    }
}

#[cfg(test)]
mod tests {
    use super::testing::DedicatedUiWindowHost;
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    /// The ordering the plugin depends on: by the time the resize call returns,
    /// the shell has already applied it. A resize that was merely posted would
    /// let the plugin lay itself out against the size it had before it asked.
    ///
    /// The applied work takes a moment on purpose — an implementation that
    /// handed the resize to another thread and returned would come back with the
    /// answer still in flight, and this is what makes that difference visible
    /// rather than a coin flip.
    #[test]
    fn a_resize_is_applied_before_the_call_that_asked_for_it_returns() {
        let ui = DedicatedUiWindowHost::start();
        let (applied, was_applied) = mpsc::sync_channel(1);
        let ui_thread = ui.thread_id;

        apply_editor_size_on_ui_thread(&ui, move || {
            std::thread::sleep(Duration::from_millis(20));
            let _ = applied.send(std::thread::current().id());
        });

        let ran_on = was_applied
            .try_recv()
            .expect("the resize must have been applied by the time the call returned");
        assert_eq!(
            ran_on, ui_thread,
            "the resize must be applied on the thread that owns the window"
        );
    }

    #[test]
    fn an_instance_id_and_an_opening_map_to_one_stable_window_label() {
        assert_eq!(
            plugin_editor_window_label("com.vendor.plugin:3", 12),
            "plugin-com-dvendor-dplugin-c3:12"
        );
    }

    /// The whole point of the sequence: the shell reports a close by echoing the
    /// label it was given, and a reopened editor must not answer to the label of
    /// the window it replaced.
    #[test]
    fn reopening_one_instances_editor_produces_a_label_the_previous_opening_does_not_share() {
        let instance_id = "com.vendor.plugin:3";

        assert_ne!(
            plugin_editor_window_label(instance_id, 1),
            plugin_editor_window_label(instance_id, 2)
        );
    }

    /// `:` separates the two parts and the escaping never emits one, which is
    /// what lets the label be split back into the pair that built it. Asserted
    /// through the split rather than by comparing two labels: ids and sequences
    /// that differ produce labels that differ anyway, so a comparison passes
    /// with the colon escaping deleted.
    #[test]
    fn a_label_splits_at_its_one_separator_back_into_the_opening_that_built_it() {
        let label = plugin_editor_window_label("a:1", 2);

        let mut parts = label.split(':');
        let escaped_id = parts.next().expect("label has an id part");
        let sequence = parts.next().expect("label has a sequence part");

        assert_eq!(parts.next(), None, "the separator appears exactly once");
        assert_eq!(
            escaped_id, "plugin-a-c1",
            "the colon in the id is escaped, so it cannot read as the separator"
        );
        assert_eq!(sequence, "2");
    }

    #[test]
    fn no_two_claimed_openings_share_a_sequence() {
        let first = next_editor_open_sequence();
        let second = next_editor_open_sequence();

        assert_ne!(first, second);
    }

    /// A flat `.`/`:` -> `-` substitution collapses these three ids onto the
    /// same label, which is exactly the defect this encoding fixes: the
    /// second instance's editor either refuses to open ("already open") or
    /// close/destroy targets the wrong window. The escaping must keep them
    /// distinct.
    #[test]
    fn ids_that_collided_under_the_old_flat_substitution_now_get_distinct_labels() {
        let dot = plugin_editor_window_label("a.b", 1);
        let colon = plugin_editor_window_label("a:b", 1);
        let dash = plugin_editor_window_label("a-b", 1);

        assert_ne!(dot, colon);
        assert_ne!(dot, dash);
        assert_ne!(colon, dash);
    }

    /// One opening's label is recomputable, which is what lets the open path
    /// build it once and every later path compare against the recorded copy.
    #[test]
    fn the_same_instance_id_and_opening_always_recompute_the_same_label() {
        let instance_id = "com.vendor.plugin:7";

        assert_eq!(
            plugin_editor_window_label(instance_id, 4),
            plugin_editor_window_label(instance_id, 4)
        );
    }

    /// Instance ids are lossy-decoded from a vendor CLAP descriptor id and are
    /// not restricted to the label charset — a space, arbitrary punctuation,
    /// or `U+FFFD` from invalid UTF-8 can all appear. Every one of them must
    /// still produce a valid, distinct label rather than a window-creation
    /// failure or a collision.
    #[test]
    fn ids_with_characters_outside_the_label_charset_still_get_valid_distinct_labels() {
        let space = plugin_editor_window_label("vendor plugin 1", 1);
        let punctuation = plugin_editor_window_label("vendor!plugin#1", 1);
        let replacement_char = plugin_editor_window_label("vendor\u{FFFD}plugin1", 1);
        let non_ascii = plugin_editor_window_label("vendor\u{1F4A9}plugin1", 1);

        for label in [&space, &punctuation, &replacement_char, &non_ascii] {
            assert!(is_valid_window_label(label), "invalid label: {label}");
        }
        assert_ne!(space, punctuation);
        assert_ne!(space, replacement_char);
        assert_ne!(space, non_ascii);
        assert_ne!(punctuation, replacement_char);
        assert_ne!(punctuation, non_ascii);
        assert_ne!(replacement_char, non_ascii);
    }

    /// The editor window is owned by the DAW window on every platform the shell
    /// parents on, and that ownership is what keeps it above the DAW. Stacking
    /// `always_on_top` on it is what put plugin editors above unrelated apps.
    #[test]
    fn a_parented_editor_window_does_not_also_float_above_every_application() {
        assert!(!plugin_editor_needs_always_on_top(true));
    }

    /// With no parent the flag is the only thing keeping the editor reachable
    /// above the DAW, so it stays.
    #[test]
    fn an_unparented_editor_window_keeps_the_always_on_top_fallback() {
        assert!(plugin_editor_needs_always_on_top(false));
    }

    /// The byte buffer is the pointer's memory representation, so the read
    /// must be native-endian and exactly pointer-sized.
    #[test]
    fn a_native_handle_round_trips_through_its_byte_representation() {
        let pointer: usize = 0x7ffe_e1b2_c3d4;
        let bytes = pointer.to_ne_bytes();

        assert_eq!(native_handle_from_bytes(&bytes), Ok(pointer));
    }

    /// A truncated or padded buffer is a corrupt handle, and handing it to a
    /// plugin is a crash in the plugin — refusal is the only safe answer.
    #[test]
    fn a_wrong_sized_handle_buffer_is_refused() {
        assert!(native_handle_from_bytes(&[1, 2, 3, 4]).is_err());
        assert!(native_handle_from_bytes(&[0; 16]).is_err());
        assert!(native_handle_from_bytes(&[]).is_err());
    }
}
