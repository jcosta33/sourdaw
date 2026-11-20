//! Answers to what a hosted plugin asks of its editor's window from inside its
//! own callbacks: to be shown or hidden, that its editor ended, that its resize
//! constraints changed.
//!
//! CLAP marks every one of those callbacks `[thread-safe]`, so the backend only
//! records them and raises the editor hint the parameter-event drain already
//! wakes on for `request_resize`. That drain tick calls
//! [`answer_pending_editor_window_asks`], which takes each instance's asks
//! under the control seam and carries the answer to the thread that owns the
//! editor's window: every answer calls into the editor, and both formats bind
//! the editor to that thread. The claim is taken here and only the call
//! crosses, the order every other editor path keeps.

use crate::host::native_bridge::SharedHostedPlugin;
use crate::host::plugin_window::PluginEditorWindow;
use crate::host::ui_thread::{lend_on_ui_thread, UiThread, UiThreadTask};
use crate::host::{all_engine_runtimes, retry_unreached_instance};
use crate::state::EnginePluginInstanceData;
use daw_plugin_host::{
    signal_pending_editor_resize, AudioPlugin, EditorWindowHost, SharedEditorWindow,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

type EnginePlugins = Arc<Mutex<HashMap<String, EnginePluginInstanceData>>>;

/// How long taking one instance's asks may wait for the audio thread to
/// release it.
///
/// Sized for the audio thread holding the seam for one block, like the resize
/// leg beside it on the same drain tick: that tick also carries every plugin's
/// knob edits, so an instance busy with a long command defers to the next tick.
const ASK_CONTROL_TIMEOUT: Duration = Duration::from_millis(50);

/// The shell window an editor is drawn into, as the backend addresses it.
struct EditorSessionWindow {
    window: Arc<dyn PluginEditorWindow>,
}

impl EditorWindowHost for EditorSessionWindow {
    fn show(&self) {
        self.window.show();
    }

    fn hide(&self) {
        self.window.hide();
    }

    fn set_resizable(&self, resizable: bool) {
        self.window.set_resizable(resizable);
    }

    fn destroy(&self) {
        self.window.destroy();
    }

    fn run_on_window_thread(&self, work: Box<dyn FnOnce() + Send>) -> Result<(), String> {
        self.window.run_on_ui_thread(work)
    }
}

/// The window handle the backend keeps for an open editor.
pub fn editor_window_host(window: &Arc<dyn PluginEditorWindow>) -> SharedEditorWindow {
    Arc::new(EditorSessionWindow {
        window: Arc::clone(window),
    })
}

/// The thread that owns an editor's window, reached through the handle the
/// backend handed back.
///
/// Never the calling thread as far as this adapter knows: the handle decides
/// whether the work runs in place, so every task is handed to it. A task the
/// handle refuses never ran, which is [`UiThread::run_on_ui_thread`]'s
/// contract for an `Err`.
struct EditorWindowThread(SharedEditorWindow);

impl UiThread for EditorWindowThread {
    fn is_ui_thread(&self) -> bool {
        false
    }

    fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> Result<(), String> {
        let task = Arc::clone(task);
        self.0.run_on_window_thread(Box::new(move || task.run()))
    }
}

/// Take and answer every engine-owned instance's editor-window asks.
///
/// The hint names no instance — it is raised from callbacks a plugin may make
/// on the audio thread — so every instance is visited and each backend says
/// whether it asked anything. One the seam could not reach keeps its asks and
/// raises the hint again for the next tick.
pub fn answer_pending_editor_window_asks(engine_plugins: &EnginePlugins) {
    for (instance_id, runtime) in all_engine_runtimes(engine_plugins, "editor window ask") {
        if let Err(error) = answer_instance_asks(&runtime) {
            retry_unreached_instance(
                &runtime,
                &instance_id,
                "editor window ask",
                &error,
                signal_pending_editor_resize,
            );
        }
    }
}

fn answer_instance_asks(runtime: &SharedHostedPlugin) -> Result<(), String> {
    runtime.try_with_control(ASK_CONTROL_TIMEOUT, |plugin| {
        let Some((asks, window)) = plugin.take_editor_window_asks() else {
            return Ok(());
        };
        let window_thread = EditorWindowThread(window);
        if let Err(error) = lend_on_ui_thread(&window_thread, plugin, move |plugin| {
            plugin.answer_editor_window_asks(asks);
        }) {
            // Taken but never answered, and the window's thread is the only one
            // that may: the asks are lost with the hop, so say so once rather
            // than retry against a shell that is not answering.
            eprintln!("[Plugin] editor window asks were not answered: {error}");
        }
        Ok(())
    })
}
