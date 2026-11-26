//! Answers to what a hosted plugin asks of its editor's window from inside its
//! own callbacks: to be shown or hidden, that its editor ended, that its resize
//! constraints changed.
//!
//! CLAP marks every one of those callbacks `[thread-safe]`, so the backend only
//! records them and raises the editor hint the parameter-event drain already
//! wakes on for `request_resize`. That drain tick calls
//! [`answer_pending_editor_window_asks`], which finds each instance's window
//! under the control gate and carries the take and the answer to the thread that
//! owns it: every answer calls into the editor, and both formats bind the editor
//! to that thread. The gate stays here and only the call crosses, the order
//! every other editor path keeps; the audio access seam is claimed only once the
//! call has landed. The asks are taken on the window's thread, so a hop that
//! never ran leaves them recorded for the retry.
//!
//! The hop is bounded by the drain's own budget, [`EDITOR_DRAIN_HOP_DEADLINE`],
//! rather than the editor commands' longer one: the tick that waits for it also
//! carries every plugin's parameter events, and a shell thread that has stopped
//! taking work would otherwise hold all of them for the whole hop deadline on
//! every tick. A call withdrawn unrun is retried, at the intervals
//! [`EditorDrainRetry`] sets.

use crate::host::native_bridge::{PluginControlError, SharedHostedPlugin};
use crate::host::plugin_window::PluginEditorWindow;
use crate::host::ui_thread::{UiThread, UiThreadError, UiThreadTask};
use crate::host::{all_editor_runtimes, CommandPlugins, EditorDrainRetry};
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

/// How long an editor drain waits for a window's thread to take its call
/// before withdrawing it for a later tick. The same budget as the seam wait
/// beside it, for the same reason: the tick carries every plugin's knob edits.
pub(crate) const EDITOR_DRAIN_HOP_DEADLINE: Duration = Duration::from_millis(50);

/// The asks drain's retry rule; see [`EditorDrainRetry`].
static ASK_RETRY: EditorDrainRetry = EditorDrainRetry::new("editor window ask");

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

    fn run_on_window_thread_within(
        &self,
        work: Box<dyn FnOnce() + Send>,
        deadline: Duration,
    ) -> Result<(), String> {
        self.window.run_on_ui_thread_within(work, deadline)
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
pub(crate) struct EditorWindowThread(pub(crate) SharedEditorWindow);

impl UiThread for EditorWindowThread {
    fn is_ui_thread(&self) -> bool {
        false
    }

    fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> Result<(), UiThreadError> {
        let task = Arc::clone(task);
        self.0
            .run_on_window_thread(Box::new(move || task.run()))
            .map_err(UiThreadError::from)
    }

    fn run_on_ui_thread_within(
        &self,
        task: &Arc<UiThreadTask>,
        deadline: Duration,
    ) -> Result<(), UiThreadError> {
        let task = Arc::clone(task);
        self.0
            .run_on_window_thread_within(Box::new(move || task.run()), deadline)
            .map_err(UiThreadError::from)
    }
}

/// Take and answer every instance's editor-window asks, engine-owned or
/// dormant: an editor opens on either, and a dormant one may wait for its
/// first graph batch for as long as playback has not started.
///
/// The hint names no instance — it is raised from callbacks a plugin may make
/// on the audio thread — so every instance is visited and each backend says
/// whether it asked anything. One the drain could not reach keeps its asks and
/// raises the hint again, to be retried at [`EditorDrainRetry`]'s intervals.
pub fn answer_pending_editor_window_asks(
    engine_plugins: &EnginePlugins,
    command_plugins: &CommandPlugins,
) {
    let runtimes = all_editor_runtimes(
        engine_plugins,
        command_plugins,
        "editor window ask",
        signal_pending_editor_resize,
    );
    answer_with_retry(&ASK_RETRY, &runtimes);
}

fn answer_with_retry(retry: &EditorDrainRetry, runtimes: &[(String, Arc<SharedHostedPlugin>)]) {
    retry.forget_absent(runtimes);
    for (instance_id, runtime) in runtimes {
        if !retry.admits(instance_id, signal_pending_editor_resize) {
            continue;
        }
        match answer_instance_asks(runtime) {
            Ok(()) => retry.reached(instance_id),
            Err(error) => {
                retry.unreached(runtime, instance_id, &error, signal_pending_editor_resize)
            }
        }
    }
}

fn answer_instance_asks(
    runtime: &SharedHostedPlugin,
) -> Result<(), PluginControlError<UiThreadError>> {
    let visit = runtime.try_control_visit()?;
    let window = visit.with_seam(ASK_CONTROL_TIMEOUT, |plugin| {
        Ok::<_, UiThreadError>(plugin.editor_window_with_pending_asks())
    })?;
    let Some(window) = window else {
        return Ok(());
    };
    visit.on_ui_thread_within(
        &EditorWindowThread(window),
        EDITOR_DRAIN_HOP_DEADLINE,
        ASK_CONTROL_TIMEOUT,
        |plugin| {
            if let Some((asks, _window)) = plugin.take_editor_window_asks() {
                plugin.answer_editor_window_asks(asks);
            }
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::hint_test_support;
    use crate::host::plugin_host_requests::apply_pending_editor_resizes;
    use crate::host::plugin_window::PluginWindowError;
    use crate::host::ui_thread::PostedUiThread;
    use daw_engine::timeline::DeviceKind;
    use daw_plugin_host::ClapWrapper;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    /// A window whose thread accepts every call and never runs one: a shell
    /// whose main loop is busy elsewhere. Its own wait is far longer than any
    /// test, so a caller that does not bound the hop parks for good, while one
    /// that does is answered at its own deadline with the call withdrawn.
    struct StalledWindow {
        queue: PostedUiThread,
        posted: Mutex<mpsc::Sender<()>>,
    }

    impl StalledWindow {
        fn new() -> (Arc<Self>, mpsc::Receiver<()>) {
            let (posted, was_posted) = mpsc::channel();
            let window = Arc::new(Self {
                queue: PostedUiThread::new(Duration::from_secs(3600)),
                posted: Mutex::new(posted),
            });
            (window, was_posted)
        }

        fn announce(&self) -> Result<(), UiThreadError> {
            let _ = self.posted.lock().expect("posted channel").send(());
            Ok(())
        }
    }

    impl PluginEditorWindow for StalledWindow {
        fn native_handle_ptr(&self) -> Result<*mut std::ffi::c_void, PluginWindowError> {
            Ok(std::ptr::null_mut())
        }
        fn set_size(&self, _width: u32, _height: u32) {}
        fn set_resizable(&self, _resizable: bool) {}
        fn show_and_focus(&self) {}
        fn destroy(&self) {}
        fn show(&self) {}
        fn hide(&self) {}

        fn run_on_ui_thread(&self, work: Box<dyn FnOnce() + Send>) -> Result<(), String> {
            self.queue
                .post_and_wait(&UiThreadTask::new(work), || self.announce())
                .map_err(|error| error.to_string())
        }

        fn run_on_ui_thread_within(
            &self,
            work: Box<dyn FnOnce() + Send>,
            deadline: Duration,
        ) -> Result<(), String> {
            self.queue
                .post_and_wait_within(&UiThreadTask::new(work), deadline, || self.announce())
                .map_err(|error| error.to_string())
        }
    }

    /// A window whose thread refuses every call at once, counting them.
    #[derive(Default)]
    struct RefusingWindow {
        hops: AtomicUsize,
    }

    impl PluginEditorWindow for RefusingWindow {
        fn native_handle_ptr(&self) -> Result<*mut std::ffi::c_void, PluginWindowError> {
            Ok(std::ptr::null_mut())
        }
        fn set_size(&self, _width: u32, _height: u32) {}
        fn set_resizable(&self, _resizable: bool) {}
        fn show_and_focus(&self) {}
        fn destroy(&self) {}
        fn show(&self) {}
        fn hide(&self) {}

        fn run_on_ui_thread(&self, _work: Box<dyn FnOnce() + Send>) -> Result<(), String> {
            self.hops.fetch_add(1, Ordering::SeqCst);
            Err("the shell's thread is not taking work".to_string())
        }
    }

    /// A fixture whose editor is open in `window`, with the plugin's ask raised
    /// by `ask`, as one engine-owned instance in a real map.
    fn instance_with_open_editor(
        window: Arc<dyn PluginEditorWindow>,
        ask: impl FnOnce(&ClapWrapper),
    ) -> (EnginePlugins, Arc<SharedHostedPlugin>) {
        let mut wrapper =
            ClapWrapper::new_engine_owned_command_fixture("Stalled Fixture", Vec::new(), true);
        wrapper.set_editor_window_resizer(Arc::new(|_, _| {}));
        wrapper.set_editor_window(editor_window_host(&window));
        wrapper
            .open_gui(std::ptr::null_mut())
            .expect("the fixture opens its editor");
        ask(&wrapper);
        let runtime = Arc::new(SharedHostedPlugin::new(wrapper.into()));
        let mut map = HashMap::new();
        map.insert(
            "inst-1".to_string(),
            EnginePluginInstanceData {
                engine_plugin_id: 11,
                runtime: Arc::clone(&runtime),
                name: "Stalled Fixture".to_string(),
                parameters: Vec::new(),
                has_gui: true,
                chain_kind: DeviceKind::Effect,
                parameter_events: None,
                load_resolution: crate::commands::plugins::VettedRegistryEntry::fixture(),
            },
        );
        (Arc::new(Mutex::new(map)), runtime)
    }

    /// Runs one drain tick on its own thread against a window that never runs
    /// its calls, and reports whether the audio thread could have claimed the
    /// plugin while the tick's call sat posted there. Fails if the tick never
    /// returns: that is a tick holding every plugin's knob edits for good.
    fn seam_free_while_a_drain_hop_is_stalled(
        engine_plugins: EnginePlugins,
        runtime: &SharedHostedPlugin,
        was_posted: &mpsc::Receiver<()>,
        drain: fn(&EnginePlugins, &CommandPlugins),
    ) -> bool {
        let (finished, ticked) = mpsc::channel();
        std::thread::spawn(move || {
            drain(&engine_plugins, &CommandPlugins::default());
            let _ = finished.send(());
        });
        was_posted
            .recv_timeout(Duration::from_secs(10))
            .expect("the tick must post its call to the window's thread");
        let free = runtime.try_claim_control().is_some();
        ticked
            .recv_timeout(Duration::from_secs(10))
            .expect("a tick whose window thread never runs the call must still return");
        free
    }

    /// #7196 on the ask drain: a window thread that takes the answer and never
    /// runs it must neither hold the tick nor silence the plugin while it waits.
    #[test]
    fn an_editor_ask_stalled_on_its_window_thread_leaves_the_tick_and_the_audio_free() {
        let _guard = hint_test_support::guard();
        let (window, was_posted) = StalledWindow::new();
        let (engine_plugins, runtime) = instance_with_open_editor(window, |wrapper| {
            wrapper
                .engine_owned_command_fixture_host_state()
                .mark_editor_closed(false);
        });

        let free = seam_free_while_a_drain_hop_is_stalled(
            engine_plugins,
            &runtime,
            &was_posted,
            answer_pending_editor_window_asks,
        );

        assert!(
            free,
            "the plugin's blocks must be served while its ask waits for the window's thread"
        );
    }

    /// The same on the resize drain: moving the window waits on the shell.
    #[test]
    fn an_editor_resize_stalled_on_its_window_thread_leaves_the_tick_and_the_audio_free() {
        let _guard = hint_test_support::guard();
        let (window, was_posted) = StalledWindow::new();
        let (engine_plugins, runtime) = instance_with_open_editor(window, |wrapper| {
            assert!(wrapper
                .engine_owned_command_fixture_host_state()
                .request_editor_resize(1024, 768));
        });

        let free = seam_free_while_a_drain_hop_is_stalled(
            engine_plugins,
            &runtime,
            &was_posted,
            apply_pending_editor_resizes,
        );

        assert!(
            free,
            "the plugin's blocks must be served while its resize waits for the window's thread"
        );
    }

    /// A window thread that refuses at once used to cost one attempt and one
    /// log line on every 16 ms tick. The episode is logged once and attempted
    /// on visits 1, 2, 4, 8 and 16 of 20 — doubling intervals — with its ask
    /// still recorded for the attempt that eventually lands.
    #[test]
    fn an_editor_ask_whose_window_keeps_refusing_backs_off_and_logs_once() {
        let _guard = hint_test_support::guard();
        let window = Arc::new(RefusingWindow::default());
        let (_engine_plugins, runtime) = instance_with_open_editor(
            Arc::clone(&window) as Arc<dyn PluginEditorWindow>,
            |wrapper| {
                wrapper
                    .engine_owned_command_fixture_host_state()
                    .mark_editor_closed(false);
            },
        );
        let runtimes = vec![("inst-1".to_string(), runtime)];
        let retry = EditorDrainRetry::new("editor window ask");
        let mut attempted_on = Vec::new();

        for visit in 1..=20 {
            let before = window.hops.load(Ordering::SeqCst);
            answer_with_retry(&retry, &runtimes);
            if window.hops.load(Ordering::SeqCst) > before {
                attempted_on.push(visit);
            }
        }

        assert_eq!(attempted_on, [1, 2, 4, 8, 16]);
        assert_eq!(
            retry.logged_lines("inst-1"),
            1,
            "one episode of failures is one line of log"
        );
    }
}
