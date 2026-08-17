//! The Node shell's implementation of the plugin-window seam.
//!
//! Only the Electron main thread may touch a native window, and the command
//! bodies run on the async executor's workers — so every window operation
//! crosses to JS through a weak threadsafe function. Creation (and the
//! existence probe) needs an answer back before the CLAP lifecycle can run, so
//! those two are synchronous round trips: post the call, park this worker on a
//! channel, and let the JS thread answer. The JS event loop is never the
//! waiting side, so the wait cannot deadlock it; a shell that fails to answer
//! inside the deadline fails the open rather than wedging the app. Everything
//! else — resize, focus, hide, show, destroy — is fire and forget, exactly as
//! the Tauri host discards those results.
//!
//! Errors cross as a response field rather than a JS throw: the
//! callee-unhandled threadsafe shape has no error channel back to the caller,
//! and a shell callback that throws surfaces as an uncaught exception instead
//! of failing the open that caused it.

use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

use crate::host::plugin_window::{native_handle_from_bytes, PluginEditorWindow, PluginWindowHost};

/// How long one JS round trip may take before the operation fails.
///
/// Generous because the main thread may be mid-layout; bounded because a shell
/// that never answers must fail the open, not park a worker forever.
const WINDOW_HOST_DEADLINE: Duration = Duration::from_secs(10);

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
pub type EditorWindowSizeFn =
    ThreadsafeFunction<EditorWindowSizeRequest, (), EditorWindowSizeRequest, Status, false, true>;
pub type EditorWindowLabelFn = ThreadsafeFunction<String, (), String, Status, false, true>;

/// The seven JS callbacks one registration hands over, kept together so an
/// editor window can still address them after `open_plugin_gui` returns.
pub struct JsWindowCallbacks {
    pub create: CreateEditorWindowFn,
    pub exists: EditorWindowExistsFn,
    pub set_size: EditorWindowSizeFn,
    pub show_and_focus: EditorWindowLabelFn,
    pub destroy: EditorWindowLabelFn,
    pub hide: EditorWindowLabelFn,
    pub show: EditorWindowLabelFn,
}

/// Creates and addresses plugin editor windows through the JS shell.
pub struct JsWindowHost {
    callbacks: Arc<JsWindowCallbacks>,
}

impl JsWindowHost {
    pub fn new(callbacks: JsWindowCallbacks) -> Self {
        Self {
            callbacks: Arc::new(callbacks),
        }
    }
}

fn fire(target: &EditorWindowLabelFn, label: &str) {
    // Status discarded like the Tauri host discards its window-op results: a
    // window that is already gone is not a failure of the operation.
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

fn create_over_js(
    callbacks: &JsWindowCallbacks,
    request: CreateEditorWindowRequest,
) -> std::result::Result<usize, String> {
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
                    (None, Some(handle)) => native_handle_from_bytes(&handle),
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
    receiver
        .recv_timeout(WINDOW_HOST_DEADLINE)
        .map_err(|_| "Window host did not create the editor window in time".to_string())?
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
        let handle = create_over_js(
            &self.callbacks,
            CreateEditorWindowRequest {
                label: label.to_string(),
                title: title.to_string(),
                instance_id: instance_id.to_string(),
            },
        )?;
        Ok(Box::new(JsEditorWindow {
            label: label.to_string(),
            handle,
            callbacks: Arc::clone(&self.callbacks),
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
    callbacks: Arc<JsWindowCallbacks>,
}

impl PluginEditorWindow for JsEditorWindow {
    fn native_handle_ptr(&self) -> std::result::Result<*mut std::ffi::c_void, String> {
        Ok(self.handle as *mut std::ffi::c_void)
    }

    fn set_size(&self, width: u32, height: u32) {
        let _ = self.callbacks.set_size.call(
            EditorWindowSizeRequest {
                label: self.label.clone(),
                width,
                height,
            },
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }

    fn show_and_focus(&self) {
        fire(&self.callbacks.show_and_focus, &self.label);
    }

    fn destroy(&self) {
        fire(&self.callbacks.destroy, &self.label);
    }
}
