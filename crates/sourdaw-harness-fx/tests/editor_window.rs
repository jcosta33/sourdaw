//! What a CLAP plugin asks of its editor's window from inside its own
//! callbacks — `closed`, `resize_hints_changed`, `request_hide`,
//! `request_show` — answered through the real `ClapWrapper` against the
//! fixture's editor class, with a window that records what it was told.
//!
//! The tests stand where the host's control path stands: they take the asks
//! the plugin's callbacks recorded and answer them on this thread, which plays
//! the window's own.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "tests assert by unwrapping"
)]

use std::env;
use std::fs;
use std::path::PathBuf;
use std::ptr;
use std::sync::{Arc, Mutex};

use daw_plugin_host::{
    AudioPlugin, ClapWrapper, EditorClosed, EditorVisibility, EditorWindowHost,
    HostParameterUpdate, SharedEditorWindow,
};
use sourdaw_harness_fx::state::{decode_gui, GuiCall, GuiRecord};
use sourdaw_harness_fx::{GuiCommand, CLAP_EDITOR_PLUGIN_ID, COMMAND_PARAM_ID};

mod support;
use support::built_cdylib_path;

const SAMPLE_RATE: f64 = 48_000.0;
const BLOCK_FRAMES: usize = 64;

/// One call the host made on the editor's window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WindowCall {
    Show,
    Hide,
    SetResizable(bool),
    Destroy,
}

#[derive(Default)]
struct RecordingWindow {
    calls: Mutex<Vec<WindowCall>>,
}

impl RecordingWindow {
    fn calls(&self) -> Vec<WindowCall> {
        self.calls.lock().unwrap().clone()
    }

    fn push(&self, call: WindowCall) {
        self.calls.lock().unwrap().push(call);
    }
}

impl EditorWindowHost for RecordingWindow {
    fn show(&self) {
        self.push(WindowCall::Show);
    }

    fn hide(&self) {
        self.push(WindowCall::Hide);
    }

    fn set_resizable(&self, resizable: bool) {
        self.push(WindowCall::SetResizable(resizable));
    }

    fn destroy(&self) {
        self.push(WindowCall::Destroy);
    }

    fn run_on_window_thread(&self, work: Box<dyn FnOnce() + Send>) -> Result<(), String> {
        work();
        Ok(())
    }
}

/// The dylib installed as a `.clap` file in a fresh temp directory, torn down
/// on drop.
struct InstalledClap {
    root: PathBuf,
    path: PathBuf,
}

impl InstalledClap {
    fn create(test_name: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("the system clock should be after the unix epoch")
            .as_nanos();
        let root = fs::canonicalize(env::temp_dir())
            .expect("the temp directory should resolve")
            .join(format!(
                "sourdaw-harness-fx-editor-{test_name}-{}-{unique}",
                std::process::id()
            ));
        fs::create_dir_all(&root).expect("the temp root should be created");
        let source = built_cdylib_path();
        assert!(source.exists(), "the cdylib must be built: {source:?}");
        let path = root.join("HarnessFx.clap");
        fs::copy(&source, &path).expect("the cdylib should copy into the .clap path");
        Self { root, path }
    }

    /// An editor-class instance the host took into its engine: its request
    /// wake installed, as the native engine installs one on every instance
    /// it hosts.
    fn editor_instance(&self) -> ClapWrapper {
        let wrapper = ClapWrapper::new(
            self.path.to_str().expect("the path should be utf8"),
            CLAP_EDITOR_PLUGIN_ID,
            SAMPLE_RATE,
        )
        .expect("the editor class should load and activate");
        assert!(wrapper.set_plugin_host_request_notifier(Box::new(|_| {})));
        wrapper
    }
}

impl Drop for InstalledClap {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Open the editor into `window`, installed the way the host installs one.
fn open_into(wrapper: &mut ClapWrapper, window: &Arc<RecordingWindow>) {
    wrapper.set_editor_window_resizer(Arc::new(|_, _| {}));
    let shared: SharedEditorWindow = Arc::clone(window) as SharedEditorWindow;
    wrapper.set_editor_window(shared);
    wrapper
        .open_gui(ptr::null_mut())
        .expect("the editor class should open its editor");
}

/// Deliver one `Command` write in one block.
fn command(wrapper: &mut ClapWrapper, command: GuiCommand) {
    let input = [0.0f32; BLOCK_FRAMES];
    let inputs: [&[f32]; 2] = [&input, &input];
    let (mut left, mut right) = ([0.0f32; BLOCK_FRAMES], [0.0f32; BLOCK_FRAMES]);
    let mut outputs: [&mut [f32]; 2] = [&mut left, &mut right];
    wrapper.process_with_parameter_updates(
        &inputs,
        &mut outputs,
        BLOCK_FRAMES,
        &[HostParameterUpdate {
            param_id: COMMAND_PARAM_ID,
            value: command.value(),
        }],
    );
}

/// Take what the plugin asked and answer it, as the control path does.
fn answer_asks(wrapper: &mut ClapWrapper) {
    let (asks, _window) = wrapper
        .take_editor_window_asks()
        .expect("the plugin asked something of its window");
    wrapper.answer_editor_window_asks(asks);
}

fn gui_record(wrapper: &ClapWrapper) -> GuiRecord {
    decode_gui(&wrapper.get_state().unwrap())
        .expect("the chunk is the editor class's own")
        .1
}

#[test]
fn an_editor_the_plugin_destroyed_is_acknowledged_once_and_opens_again() {
    let plugin = InstalledClap::create("closed");
    let mut wrapper = plugin.editor_instance();
    let window = Arc::new(RecordingWindow::default());
    open_into(&mut wrapper, &window);

    command(&mut wrapper, GuiCommand::CloseDestroyed);
    let (asks, _window) = wrapper.take_editor_window_asks().unwrap();
    assert_eq!(
        asks.closed,
        Some(EditorClosed {
            was_destroyed: true
        })
    );
    wrapper.answer_editor_window_asks(asks);

    assert_eq!(
        gui_record(&wrapper).calls,
        [GuiCall::Create, GuiCall::Show, GuiCall::Destroy],
        "a destroyed editor is acknowledged with one destroy and never hidden"
    );
    assert_eq!(window.calls(), [WindowCall::Destroy]);

    // The session is over: a later close has no editor left to destroy.
    wrapper.close_gui();
    assert_eq!(
        gui_record(&wrapper).calls,
        [GuiCall::Create, GuiCall::Show, GuiCall::Destroy]
    );

    let reopened = Arc::new(RecordingWindow::default());
    open_into(&mut wrapper, &reopened);
    assert_eq!(
        gui_record(&wrapper).calls,
        [
            GuiCall::Create,
            GuiCall::Show,
            GuiCall::Destroy,
            GuiCall::Create,
            GuiCall::Show
        ]
    );
    assert!(
        wrapper.take_editor_window_asks().is_none(),
        "the reopened editor inherits nothing the closed one asked"
    );
}

#[test]
fn the_window_follows_the_plugins_resizability_each_time_its_hints_change() {
    let plugin = InstalledClap::create("hints");
    let mut wrapper = plugin.editor_instance();
    let window = Arc::new(RecordingWindow::default());
    open_into(&mut wrapper, &window);
    assert!(!wrapper.editor_can_resize());

    command(&mut wrapper, GuiCommand::ToggleResizable);
    answer_asks(&mut wrapper);
    assert!(gui_record(&wrapper).can_resize);
    assert_eq!(window.calls(), [WindowCall::SetResizable(true)]);

    command(&mut wrapper, GuiCommand::ToggleResizable);
    answer_asks(&mut wrapper);
    assert!(!gui_record(&wrapper).can_resize);
    assert_eq!(
        window.calls(),
        [
            WindowCall::SetResizable(true),
            WindowCall::SetResizable(false)
        ]
    );
}

#[test]
fn a_hide_then_a_show_reach_the_editor_and_then_its_window() {
    let plugin = InstalledClap::create("visibility");
    let mut wrapper = plugin.editor_instance();
    let window = Arc::new(RecordingWindow::default());
    open_into(&mut wrapper, &window);

    command(&mut wrapper, GuiCommand::RequestHide);
    let (asks, _window) = wrapper.take_editor_window_asks().unwrap();
    assert_eq!(asks.visibility, Some(EditorVisibility::Hide));
    wrapper.answer_editor_window_asks(asks);
    command(&mut wrapper, GuiCommand::RequestShow);
    answer_asks(&mut wrapper);

    let record = gui_record(&wrapper);
    assert_eq!(
        record.calls,
        [GuiCall::Create, GuiCall::Show, GuiCall::Hide, GuiCall::Show]
    );
    assert_eq!(
        (record.hide_answer, record.show_answer),
        (Some(true), Some(true))
    );
    assert_eq!(window.calls(), [WindowCall::Hide, WindowCall::Show]);
}

#[test]
fn a_hide_or_show_is_refused_while_no_window_is_installed() {
    let plugin = InstalledClap::create("no-window");
    let mut wrapper = plugin.editor_instance();
    wrapper
        .open_gui(ptr::null_mut())
        .expect("the editor class should open its editor");

    command(&mut wrapper, GuiCommand::RequestHide);
    command(&mut wrapper, GuiCommand::RequestShow);

    let record = gui_record(&wrapper);
    assert_eq!(
        (record.hide_answer, record.show_answer),
        (Some(false), Some(false))
    );
    assert!(wrapper.take_editor_window_asks().is_none());
    assert_eq!(record.calls, [GuiCall::Create, GuiCall::Show]);
}
