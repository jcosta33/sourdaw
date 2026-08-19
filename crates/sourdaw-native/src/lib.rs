//! Sourdaw's native audio, DSP and plugin-hosting bodies.
//!
//! Nothing in this crate knows what a shell command, a window or an IPC
//! request is: a shell supplies the managed singletons ([`NativeSingletons`]),
//! an event sink ([`events::EventSink`]) and plain owned arguments, and gets
//! plain owned results back. The Node addon in [`addon`] is the one consumer
//! today; the seam stays shell-agnostic so a second shell would link these
//! same bodies rather than re-implement them.

pub mod commands;
pub mod events;
pub mod host;
pub mod shutdown;
pub mod state;

#[cfg(feature = "napi-addon")]
pub mod addon;

use std::sync::Arc;

use crate::commands::collab::CollabState;
use crate::commands::crumbs::CrumbsState;
use crate::commands::link::LinkState;
use crate::commands::midi::{MidiState, PushState};
use crate::commands::provider_gateway::ProviderGatewayState;
use crate::commands::speech::DictationState;
use crate::events::EventSink;
use crate::state::AppState;

/// Every long-lived singleton the command bodies address.
///
/// Field order is load bearing for the same reason `AppState`'s own field
/// order is: drop runs
/// top-to-bottom, so `app_state` — which owns the CPAL stream and, after it, the
/// retired CLAP runtimes — is released before any state that can still be
/// holding a ring the audio thread reads. Reordering these fields reorders
/// teardown.
pub struct NativeSingletons {
    pub app_state: AppState,
    pub collab: CollabState,
    pub link: LinkState,
    pub midi: MidiState,
    pub push: PushState,
    pub dictation: DictationState,
    pub crumbs: CrumbsState,
    pub provider_gateway: ProviderGatewayState,
    /// Where every pushed event goes. Registered once, at host init, and never
    /// reachable from the CPAL callback.
    pub events: Arc<dyn EventSink>,
}

impl NativeSingletons {
    pub fn new(events: Arc<dyn EventSink>) -> Self {
        Self {
            app_state: AppState::default(),
            collab: CollabState::default(),
            link: LinkState::default(),
            midi: MidiState::default(),
            push: PushState::default(),
            dictation: DictationState::default(),
            crumbs: CrumbsState::default(),
            provider_gateway: ProviderGatewayState::default(),
            events,
        }
    }

    /// Run the process-exit cascade over these singletons.
    ///
    /// See [`shutdown::shutdown`] for why the three steps are ordered as they
    /// are. A shell that owns its singletons individually calls that function
    /// directly; this is the same cascade for a shell that owns them here.
    pub fn shutdown(
        &self,
        windows: Option<&dyn host::plugin_window::PluginWindowHost>,
    ) -> shutdown::ShutdownReport {
        shutdown::shutdown(&self.collab, &self.app_state, windows)
    }
}

/// Run the bounded CLAP descriptor-extraction worker.
///
/// The Node addon reaches this through `#[napi] run_plugin_scan_worker`,
/// handing it the same process-argument contract every shell has used, so the
/// scan policy — bounded child process, absolute paths, no entry point loaded
/// in the application process — is independent of which shell started the
/// process.
///
/// Returns the exit code the worker process must terminate with, or `None` when
/// this process was not started as a scan worker.
pub fn run_plugin_scan_worker_from_process_args() -> Option<i32> {
    host::plugin_scan_worker::run_from_process_args()
}

/// Drive one `async` command body to completion from a synchronous test.
///
/// The bodies are `async` because their shells call them that way, not because
/// they await inside a lock; a current-thread runtime is therefore the honest
/// harness. Shared across the crate's test modules so no module invents its own.
#[cfg(test)]
pub(crate) fn block_on_test<Fut: std::future::Future>(future: Fut) -> Fut::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime should build")
        .block_on(future)
}
