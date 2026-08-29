//! The Node shell's implementation of the plugin-window seam.
//!
//! Only the Electron main thread may touch a native window, and the command
//! bodies run on the async executor's workers — so every window operation
//! crosses to JS. Creation (and the existence probe) needs an answer back
//! before the plugin lifecycle can run, so those two are synchronous round
//! trips: post the call, park this worker on a channel, and let the JS thread
//! answer. The JS event loop is never the waiting side, so the wait cannot
//! deadlock it; a shell that fails to answer inside the deadline fails the open
//! rather than wedging the app. Focus, hide, show, and destroy are fire and
//! forget, because nothing downstream reads their effect.
//!
//! A resize is not: a plugin resizing its own editor is mid-handshake with its
//! view and is told the size the host granted, so a size that has not landed
//! yet is a lie the plugin then draws against. It is applied by calling the
//! shell's callback directly on the main thread, and a call that starts
//! anywhere else gets there through [`crate::host::ui_thread`] first.
//!
//! This module is also where that thread is: [`JsUiThread`] is the shell's main
//! thread as the editor lifecycle sees it, and every thread-affine editor call
//! reaches JS through the same pump.
//!
//! Errors cross as a response field rather than a JS throw for the two
//! threadsafe round trips: the callee-unhandled threadsafe shape has no error
//! channel back to the caller, and a shell callback that throws surfaces as an
//! uncaught exception instead of failing the open that caused it.

use std::sync::mpsc;
use std::sync::Arc;
use std::thread::ThreadId;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use crate::host::plugin_window::{
    apply_editor_size_on_ui_thread, native_handle_from_bytes, PluginEditorWindow, PluginWindowHost,
};
use crate::host::ui_thread::{PostedUiThread, UiThread, UiThreadTask};

/// How long one JS round trip may take before the operation fails.
///
/// Generous because the main thread may be mid-layout; bounded because a shell
/// that never answers must fail the open, not park a worker forever.
const WINDOW_HOST_DEADLINE: Duration = Duration::from_secs(10);

/// How long a worker waits for the main thread to run one editor call.
///
/// Much shorter than the round trips above, and the difference is the point.
/// Those wait for a JS answer the main thread will get to; this one is waited on
/// while holding a plugin's control gate, and the main thread may be blocked on
/// that very gate — the one cycle the ordering rules in
/// [`crate::host::ui_thread`] cannot rule out. What ends it is this side giving
/// up, so the bound is chosen against what is waiting behind it: two seconds is
/// the control timeout every editor command already spends, so a hop can never
/// outlast the claim it runs inside, and the assertion below keeps it clear of
/// the deadline at which the shell stops waiting for a graceful exit and kills
/// every plugin mid-flight.
const EDITOR_UI_THREAD_DEADLINE: Duration = Duration::from_secs(2);

const _: () = assert!(
    EDITOR_UI_THREAD_DEADLINE.as_millis() * 2
        <= crate::shutdown::SHELL_FORCE_EXIT_DEADLINE.as_millis(),
    "an editor hop must give up with time to spare inside the shell's force-exit deadline"
);

#[napi(object)]
pub struct CreateEditorWindowRequest {
    pub label: String,
    pub title: String,
    pub instance_id: String,
}

/// What the JS host answered a create with: a handle, or a reason.
#[napi(object)]
pub struct CreateEditorWindowResponse {
    /// The window's native handle bytes (`getNativeWindowHandle()`), absent on
    /// failure.
    pub handle: Option<Buffer>,
    /// Whether the window is owned by the DAW window. When the platform
    /// refused a parent, the shell has already applied the always-on-top
    /// fallback.
    pub parented: bool,
    /// The display scale the window was created at. The shell is the only side
    /// that can measure it, and a plugin editor whose rect is in physical
    /// pixels cannot be sized without it.
    pub scale_factor: f64,
    pub error: Option<String>,
}

#[napi(object)]
pub struct EditorWindowSizeRequest {
    pub label: String,
    pub width: u32,
    pub height: u32,
}

// Weak (the last parameter) for the same reason as the event sink: the window
// host lives for the process, and a referenced threadsafe function would pin
// the Node event loop so `app.quit()` could never drain.
pub type CreateEditorWindowFn = ThreadsafeFunction<
    CreateEditorWindowRequest,
    CreateEditorWindowResponse,
    CreateEditorWindowRequest,
    Status,
    false,
    true,
>;
pub type EditorWindowExistsFn = ThreadsafeFunction<String, bool, String, Status, false, true>;
pub type EditorWindowLabelFn = ThreadsafeFunction<String, (), String, Status, false, true>;

/// The shell's resize callback, kept as a reference rather than a threadsafe
/// function: it is only ever called on the main thread, and calling it there is
/// the whole point — a threadsafe call would queue behind the turn of the loop
/// the caller is standing in.
pub type EditorWindowSizeCallback = FunctionRef<EditorWindowSizeRequest, ()>;

/// The pump that runs one batch of editor work on the shell's main thread.
///
/// Its JS side is a function this module makes; the shell registers nothing for
/// it, because there is nothing shell-specific about "run this here".
type UiThreadPumpFn = ThreadsafeFunction<(), (), (), Status, false, true>;

/// The addon's `napi_env`, kept so a main-thread call can reach JS without
/// waiting for a turn of the event loop.
///
/// Sound because every read goes through [`JsUiThread::env`], which is reached
/// only from the thread that registered it — the check is
/// [`UiThread::is_ui_thread`], and it gates every path that gets here.
struct MainThreadEnv(napi::sys::napi_env);

// SAFETY: the pointer is never dereferenced off `JsUiThread::thread_id`.
unsafe impl Send for MainThreadEnv {}
unsafe impl Sync for MainThreadEnv {}

/// The shell's main thread, as the plugin editor lifecycle reaches it.
///
/// Both hosted formats bind their editor calls to the thread that owns the
/// window, and that is this one. Work posted from a worker is queued here and
/// the pump drains it on the next turn of the Node loop; work raised on the
/// main thread already runs there and never queues, which is what keeps a
/// plugin's re-entrant resize from waiting for the attach that is holding the
/// turn.
struct JsUiThread {
    thread_id: ThreadId,
    env: MainThreadEnv,
    pump: UiThreadPumpFn,
    posted: Arc<PostedUiThread>,
}

impl JsUiThread {
    fn new(env: &Env) -> Result<Self> {
        let posted = Arc::new(PostedUiThread::new(EDITOR_UI_THREAD_DEADLINE));
        let drained = Arc::clone(&posted);
        let pump: Function<'_, (), ()> =
            env.create_function_from_closure("sourdawPluginEditorUiThreadPump", move |_| {
                drained.drain();
                Ok(())
            })?;

        Ok(Self {
            thread_id: std::thread::current().id(),
            env: MainThreadEnv(env.raw()),
            // Weak for the same reason as every other callback here: the pump
            // lives for the process, and a referenced one would pin the Node
            // event loop so `app.quit()` could never drain.
            pump: pump
                .build_threadsafe_function::<()>()
                .weak::<true>()
                .build()?,
            posted,
        })
    }

    /// The registering thread's env. Only call from that thread.
    fn env(&self) -> Env {
        Env::from_raw(self.env.0)
    }
}

impl UiThread for JsUiThread {
    fn is_ui_thread(&self) -> bool {
        std::thread::current().id() == self.thread_id
    }

    fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> std::result::Result<(), String> {
        if self.is_ui_thread() {
            // Unreachable through `call_on_ui_thread`, which runs the work in
            // place instead. Refused rather than queued because the pump cannot
            // run until this call returns, so the wait would never end.
            return Err("The shell's main thread cannot wait for its own turn".to_string());
        }

        self.posted.post_and_wait(task, || {
            let status = self.pump.call((), ThreadsafeFunctionCallMode::NonBlocking);
            if status != Status::Ok {
                return Err(format!("Shell main thread is unreachable: {status}"));
            }
            Ok(())
        })
    }
}

/// The JS callbacks one registration hands over, kept together so an editor
/// window can still address them after `open_plugin_gui` returns.
pub struct JsWindowCallbacks {
    pub create: CreateEditorWindowFn,
    pub exists: EditorWindowExistsFn,
    pub set_size: EditorWindowSizeCallback,
    pub show_and_focus: EditorWindowLabelFn,
    pub destroy: EditorWindowLabelFn,
    pub hide: EditorWindowLabelFn,
    pub show: EditorWindowLabelFn,
}

/// Creates and addresses plugin editor windows through the JS shell.
pub struct JsWindowHost {
    callbacks: Arc<JsWindowCallbacks>,
    ui: Arc<JsUiThread>,
}

impl JsWindowHost {
    /// Build the host from the registering call's env, which must be the
    /// shell's main thread — it is the thread every editor call is then sent
    /// back to.
    pub fn new(env: &Env, callbacks: JsWindowCallbacks) -> Result<Self> {
        Ok(Self {
            callbacks: Arc::new(callbacks),
            ui: Arc::new(JsUiThread::new(env)?),
        })
    }
}

impl UiThread for JsWindowHost {
    fn is_ui_thread(&self) -> bool {
        self.ui.is_ui_thread()
    }

    fn run_on_ui_thread(&self, task: &Arc<UiThreadTask>) -> std::result::Result<(), String> {
        self.ui.run_on_ui_thread(task)
    }
}

fn fire(target: &EditorWindowLabelFn, label: &str) {
    // Status discarded on purpose: a window that is already gone is not a
    // failure of the operation.
    let _ = target.call(label.to_string(), ThreadsafeFunctionCallMode::NonBlocking);
}

fn window_exists_over_js(
    callbacks: &JsWindowCallbacks,
    label: &str,
) -> std::result::Result<bool, String> {
    let (sender, receiver) = mpsc::channel();
    let status = callbacks.exists.call_with_return_value(
        label.to_string(),
        ThreadsafeFunctionCallMode::NonBlocking,
        move |answer, _env| {
            let _ = sender.send(answer.map_err(|error| error.reason.clone()));
            Ok(())
        },
    );
    if status != Status::Ok {
        return Err(format!("Window host is unreachable: {status}"));
    }
    receiver
        .recv_timeout(WINDOW_HOST_DEADLINE)
        .map_err(|_| "Window host did not answer the existence probe in time".to_string())?
}

/// What a created editor window is: where to draw, and at what scale.
struct CreatedWindow {
    handle: usize,
    scale_factor: f64,
}

fn create_over_js(
    callbacks: &JsWindowCallbacks,
    request: CreateEditorWindowRequest,
) -> std::result::Result<CreatedWindow, String> {
    let label = request.label.clone();
    let (sender, receiver) = mpsc::channel();
    let status = callbacks.create.call_with_return_value(
        request,
        ThreadsafeFunctionCallMode::NonBlocking,
        move |response, _env| {
            // The handle bytes are parsed here, on the JS thread, because the
            // `Buffer` references JS-owned memory and must not cross threads.
            let answer = match response {
                Ok(response) => match (response.error, response.handle) {
                    (Some(error), _) => Err(error),
                    (None, Some(handle)) => {
                        native_handle_from_bytes(&handle).map(|handle| CreatedWindow {
                            handle,
                            scale_factor: response.scale_factor,
                        })
                    }
                    (None, None) => {
                        Err("Window host returned neither a handle nor an error".to_string())
                    }
                },
                Err(error) => Err(error.reason.clone()),
            };
            let _ = sender.send(answer);
            Ok(())
        },
    );
    if status != Status::Ok {
        return Err(format!("Window host is unreachable: {status}"));
    }
    receiver.recv_timeout(WINDOW_HOST_DEADLINE).map_err(|_| {
        // The create call may still be queued behind whatever has the main
        // thread stalled past the deadline. This destroy queues behind it on
        // the same loop, so a window created after the timeout is torn down
        // immediately and its close handler frees the label — instead of
        // surviving hidden, unclosable, with the label occupied until the app
        // restarts.
        fire(&callbacks.destroy, &label);
        "Window host did not create the editor window in time".to_string()
    })?
}

impl PluginWindowHost for JsWindowHost {
    fn window_exists(&self, label: &str) -> bool {
        // A failed probe answers "no window": the JS host refuses a duplicate
        // label itself, so a wrong "no" fails the open loudly at create rather
        // than wrongly reporting "already open" forever.
        window_exists_over_js(&self.callbacks, label).unwrap_or(false)
    }

    fn create_editor_window(
        &self,
        label: &str,
        title: &str,
        instance_id: &str,
    ) -> std::result::Result<Box<dyn PluginEditorWindow>, String> {
        let created = create_over_js(
            &self.callbacks,
            CreateEditorWindowRequest {
                label: label.to_string(),
                title: title.to_string(),
                instance_id: instance_id.to_string(),
            },
        )?;
        Ok(Box::new(JsEditorWindow {
            label: label.to_string(),
            handle: created.handle,
            scale_factor: created.scale_factor,
            callbacks: Arc::clone(&self.callbacks),
            ui: Arc::clone(&self.ui),
        }))
    }

    fn destroy_window(&self, label: &str) {
        fire(&self.callbacks.destroy, label);
    }

    fn hide_window(&self, label: &str) {
        fire(&self.callbacks.hide, label);
    }

    fn show_window(&self, label: &str) {
        fire(&self.callbacks.show, label);
    }
}

/// One live editor window, addressed by label through the JS callbacks.
///
/// The handle is carried as `usize` so the type stays `Send + Sync`; it is
/// only ever handed onward as the opaque pointer the CLAP GUI extension
/// expects.
struct JsEditorWindow {
    label: String,
    handle: usize,
    scale_factor: f64,
    callbacks: Arc<JsWindowCallbacks>,
    ui: Arc<JsUiThread>,
}

/// Apply one size by calling the shell's callback, here and now.
///
/// Only ever reached on the main thread. The handle scope is opened explicitly
/// because a resize may arrive from the plugin's own event handling rather than
/// from inside a JS call, and a JS value made with no scope open outlives
/// nothing that would release it.
fn apply_editor_window_size(
    ui: &JsUiThread,
    set_size: &EditorWindowSizeCallback,
    request: EditorWindowSizeRequest,
) -> std::result::Result<(), String> {
    let env = ui.env();
    env.run_in_scope(|| set_size.borrow_back(&env)?.call(request))
        .map_err(|error| format!("Window host refused the resize: {error}"))
}

impl PluginEditorWindow for JsEditorWindow {
    fn native_handle_ptr(&self) -> std::result::Result<*mut std::ffi::c_void, String> {
        Ok(self.handle as *mut std::ffi::c_void)
    }

    fn scale_factor(&self) -> f64 {
        self.scale_factor
    }

    /// Applied before this returns, because the plugin asking for it reads the
    /// answer as the size the window now has.
    ///
    /// A resize raised on the main thread — a view laying itself out inside its
    /// own attach — is applied in place. One raised anywhere else crosses to
    /// the main thread and waits there.
    fn set_size(&self, width: u32, height: u32) {
        let callbacks = Arc::clone(&self.callbacks);
        let ui = Arc::clone(&self.ui);
        let request = EditorWindowSizeRequest {
            label: self.label.clone(),
            width,
            height,
        };

        apply_editor_size_on_ui_thread(self.ui.as_ref(), move || {
            if let Err(error) = apply_editor_window_size(&ui, &callbacks.set_size, request) {
                eprintln!("[Plugin] {error}");
            }
        });
    }

    fn show_and_focus(&self) {
        fire(&self.callbacks.show_and_focus, &self.label);
    }

    fn destroy(&self) {
        fire(&self.callbacks.destroy, &self.label);
    }
}
