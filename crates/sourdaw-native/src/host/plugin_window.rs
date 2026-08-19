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
/// addresses the same window and a label can be recomputed on any path. Dots
/// and colons are escaped because window labels are restricted to a smaller
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
pub fn plugin_editor_window_label(instance_id: &str) -> String {
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
    format!("{}{}", PLUGIN_WINDOW_LABEL_PREFIX, escaped)
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
            "plugin-com-dvendor-dplugin-c3"
        );
    }

    /// A flat `.`/`:` -> `-` substitution collapses these three ids onto the
    /// same label, which is exactly the defect this encoding fixes: the
    /// second instance's editor either refuses to open ("already open") or
    /// close/destroy targets the wrong window. The escaping must keep them
    /// distinct.
    #[test]
    fn ids_that_collided_under_the_old_flat_substitution_now_get_distinct_labels() {
        let dot = plugin_editor_window_label("a.b");
        let colon = plugin_editor_window_label("a:b");
        let dash = plugin_editor_window_label("a-b");

        assert_ne!(dot, colon);
        assert_ne!(dot, dash);
        assert_ne!(colon, dash);
    }

    /// The label is recomputed from the instance id on every path rather than
    /// stored, so recomputation must be stable or the same instance would
    /// address a different window depending on which path asked.
    #[test]
    fn the_same_instance_id_always_recomputes_the_same_label() {
        let instance_id = "com.vendor.plugin:7";

        assert_eq!(
            plugin_editor_window_label(instance_id),
            plugin_editor_window_label(instance_id)
        );
    }

    /// Instance ids are lossy-decoded from a vendor CLAP descriptor id and are
    /// not restricted to the label charset — a space, arbitrary punctuation,
    /// or `U+FFFD` from invalid UTF-8 can all appear. Every one of them must
    /// still produce a valid, distinct label rather than a window-creation
    /// failure or a collision.
    #[test]
    fn ids_with_characters_outside_the_label_charset_still_get_valid_distinct_labels() {
        let space = plugin_editor_window_label("vendor plugin 1");
        let punctuation = plugin_editor_window_label("vendor!plugin#1");
        let replacement_char = plugin_editor_window_label("vendor\u{FFFD}plugin1");
        let non_ascii = plugin_editor_window_label("vendor\u{1F4A9}plugin1");

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
