//! Host seam for the bare native windows CLAP editors are drawn into.
//!
//! A plugin editor is not a webview: the host creates an empty native window,
//! hands the plugin its native handle, and the plugin draws into it. Creating
//! and destroying that window is the one part of the flow that belongs to the
//! desktop shell, so it lives behind this trait; the CLAP lifecycle, the
//! bookkeeping and the close/hide/show decisions belong to the command body and
//! stay in this crate.
//!
//! No method here may be called from the audio thread — every one of them
//! reaches the platform's window server.

use std::ffi::c_void;

use raw_window_handle::RawWindowHandle;

/// Label the shell gives the DAW's own window.
///
/// Shared with the shell because editor ownership is decided against it: the
/// editor window is *owned* by this window, and ownership is a destruction
/// cascade as well as a z-order relationship.
pub const MAIN_WINDOW_LABEL: &str = "main";

/// Label prefix every plugin editor window is created under.
pub const PLUGIN_WINDOW_LABEL_PREFIX: &str = "plugin-";

/// The window label for one instance's editor.
///
/// Derived from the instance id rather than stored, so the same instance always
/// addresses the same window and a label can be recomputed on any path. Dots and
/// colons are replaced because window labels are restricted to a smaller
/// alphabet than instance ids are.
pub fn plugin_editor_window_label(instance_id: &str) -> String {
    format!(
        "{}{}",
        PLUGIN_WINDOW_LABEL_PREFIX,
        instance_id.replace('.', "-").replace(':', "-")
    )
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

/// One live editor window.
///
/// Held only for the duration of `open_plugin_gui`; afterwards the window is
/// addressed by label through [`PluginWindowHost`], because the recorded label
/// is what survives across commands.
pub trait PluginEditorWindow: Send + Sync {
    /// The native handle to hand the plugin, already cast for this platform.
    fn native_handle_ptr(&self) -> Result<*mut c_void, String>;

    /// Resize to the plugin's preferred editor size, in logical units.
    fn set_size(&self, width: u32, height: u32);

    /// Make the window visible and give it focus.
    fn show_and_focus(&self);

    /// Destroy the window. Used on every failure path after creation.
    fn destroy(&self);
}

/// Creates and addresses the native windows plugin editors are drawn into.
pub trait PluginWindowHost: Send + Sync {
    /// Whether a window with this label already exists.
    fn window_exists(&self, label: &str) -> bool;

    /// Create a hidden, bare native window for one plugin editor.
    ///
    /// The implementation owns two things the body cannot express: owning the
    /// window by the DAW window (falling back to
    /// [`plugin_editor_needs_always_on_top`] when the platform refuses), and
    /// wiring the OS-close path — when the platform ends this window, the shell
    /// must run [`crate::commands::plugin_gui::reset_plugin_gui_state_after_os_close`]
    /// for `(instance_id, label)`, off the event thread. Without that wiring a
    /// title-bar close leaves the plugin's internal GUI alive and the instance
    /// permanently unopenable.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_instance_id_maps_to_one_stable_window_label() {
        assert_eq!(
            plugin_editor_window_label("com.vendor.plugin:3"),
            "plugin-com-vendor-plugin-3"
        );
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
}
