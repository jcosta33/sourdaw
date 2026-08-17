//! The Node addon surface over the command bodies.
//!
//! One class, [`SourdawNative`], owns the long-lived singletons for the life of
//! the process, exactly as the Tauri shell's `.manage()` registrations did. Its
//! methods carry the same names, arguments and results as the commands they
//! replace.
//!
//! Two shapes are deliberate. Structured arguments and results cross as JSON
//! values rather than as generated JS classes: the wire shapes are already
//! serde contracts mirrored by hand on the TypeScript side, and re-deriving them
//! here would create a second, silently diverging definition of every payload.
//! Byte payloads cross as `Buffer`, never as a JSON number array — a `Vec<u8>`
//! rendered as decimal numbers costs ~3.57x the raw length for the high-entropy
//! data plugin state and audio are made of.
//!
//! The event sink is a threadsafe function registered once at construction. It
//! takes owned arguments and is never reachable from the CPAL callback.

use std::sync::Arc;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use serde::Serialize;
use serde_json::Value;

use crate::commands;
use crate::events::{EventSink, EventStream};
use crate::host::plugin_window::{NoWindowHost, PluginWindowHost};
use crate::host::sidecar::{NoSidecarHost, SidecarHost};
use crate::NativeSingletons;

use daw_core::{PluginId, PluginInstanceId};

/// The JS callback every pushed event is delivered to, as `(event, payload)`.
///
/// Weak (the last parameter) on purpose. This sink is registered once and lives
/// for the process: the CLAP latency watcher holds a clone on a detached thread
/// that never stops, so nothing can drop it. A *referenced* threadsafe function
/// pins the Node event loop, which would mean a shell's `app.quit()` could never
/// drain — the process would hang instead of exiting. Weak registration unrefs
/// at creation, so the sink observes the loop rather than keeping it alive; what
/// keeps a shell running is the shell.
type EventEmitter = ThreadsafeFunction<(String, Value), (), (String, Value), Status, false, true>;

/// One request's response callback, for commands that stream correlated events.
type StreamEmitter = ThreadsafeFunction<Value, (), Value, Status, false>;

fn reason<Value_>(result: std::result::Result<Value_, String>) -> Result<Value_> {
    result.map_err(Error::from_reason)
}

fn json<Payload: Serialize>(payload: Payload) -> Result<Value> {
    serde_json::to_value(payload)
        .map_err(|error| Error::from_reason(format!("Result did not serialize: {error}")))
}

/// Pushes command-body events onto the JS event loop.
struct TsfnEventSink {
    emit: EventEmitter,
}

impl EventSink for TsfnEventSink {
    fn emit_json(&self, event: &str, payload: Value) {
        // Non-blocking, and the status is discarded: a listener that has gone
        // away is not a reason to fail the operation that produced the event,
        // and this is called from driver threads that must not park.
        let _ = self.emit.call(
            (event.to_string(), payload),
            ThreadsafeFunctionCallMode::NonBlocking,
        );
    }
}

/// One request's correlated response stream.
struct TsfnEventStream {
    emit: StreamEmitter,
}

impl<Event: Serialize> EventStream<Event> for TsfnEventStream {
    fn send(&self, event: Event) -> std::result::Result<(), String> {
        let payload = serde_json::to_value(event)
            .map_err(|error| format!("Response event did not serialize: {error}"))?;
        match self
            .emit
            .call(payload, ThreadsafeFunctionCallMode::Blocking)
        {
            Status::Ok => Ok(()),
            status => Err(format!("Response channel closed: {status}")),
        }
    }
}

/// Run the bounded CLAP descriptor-extraction worker.
///
/// The process contract is the argv scan the Tauri binary performed in
/// `main.rs`: same policy, same bounded child process, same exit code. Returns
/// `None` when this process was not started as a scan worker.
#[napi]
pub fn run_plugin_scan_worker() -> Option<i32> {
    crate::run_plugin_scan_worker_from_process_args()
}

/// Every long-lived native singleton, and the commands that address them.
#[napi]
pub struct SourdawNative {
    singletons: Arc<NativeSingletons>,
    windows: Arc<dyn PluginWindowHost>,
    sidecar: Arc<dyn SidecarHost>,
}

#[napi]
impl SourdawNative {
    /// Build the native host and register the process-wide event sink.
    ///
    /// The sink is registered once, here, rather than per call: driver threads
    /// and the CLAP latency watcher outlive any single command and must still
    /// have somewhere to push.
    #[napi(constructor)]
    pub fn new(on_event: EventEmitter) -> Self {
        let events: Arc<dyn EventSink> = Arc::new(TsfnEventSink { emit: on_event });
        let singletons = Arc::new(NativeSingletons::new(Arc::clone(&events)));

        crate::host::latency_watcher::start(
            events,
            Arc::clone(&singletons.app_state.engine_plugins),
        );

        Self {
            singletons,
            // Native editor windows and the generation sidecar are wired by
            // later packets; until then these refuse rather than pretend.
            windows: Arc::new(NoWindowHost),
            sidecar: Arc::new(NoSidecarHost),
        }
    }

    /// Run the process-exit cascade: retire discovery, close every plugin
    /// editor, then sweep the retirement vec.
    ///
    /// A shell must call this on its quit path. The Tauri shell got the same
    /// three steps from `RunEvent::Exit`; a Node shell has no equivalent hook,
    /// so the cascade is an explicit entry point rather than something each
    /// shell reassembles — and `load_plugin` / `unload_plugin` are reachable
    /// through this surface, so the retirement vec fills here too.
    ///
    /// Returns the diagnostic report; nothing in it fails the exit. Idempotent.
    #[napi]
    pub fn shutdown(&self) -> Result<Value> {
        json(self.singletons.shutdown(Some(self.windows.as_ref())))
    }

    // ── Privileged model-provider gateway ──────────────────────────────

    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub async fn provider_gateway_request(
        &self,
        request_id: String,
        adapter_id: String,
        origin: String,
        operation: String,
        api_key: String,
        body: Option<String>,
        on_event: StreamEmitter,
    ) -> Result<()> {
        let stream = TsfnEventStream { emit: on_event };
        reason(
            commands::provider_gateway::provider_gateway_request(
                request_id,
                adapter_id,
                origin,
                operation,
                api_key,
                body,
                &stream,
                &self.singletons.provider_gateway,
            )
            .await,
        )
    }

    #[napi]
    pub async fn cancel_provider_gateway_request(&self, request_id: String) -> Result<()> {
        reason(
            commands::provider_gateway::cancel_provider_gateway_request(
                request_id,
                &self.singletons.provider_gateway,
            )
            .await,
        )
    }

    // ── AI audio processing ────────────────────────────────────────────

    #[napi]
    pub async fn denoise_audio(&self, request: Value) -> Result<Value> {
        let request = serde_json::from_value(request)
            .map_err(|error| Error::from_reason(format!("Invalid denoise request: {error}")))?;
        json(reason(commands::ai_audio::denoise_audio(request).await)?)
    }

    #[napi]
    pub async fn separate_stems(&self, request: Value) -> Result<Value> {
        let request = serde_json::from_value(request).map_err(|error| {
            Error::from_reason(format!("Invalid stem separation request: {error}"))
        })?;
        json(reason(commands::ai_audio::separate_stems(request).await)?)
    }

    #[napi]
    pub fn post_process_audio(&self, request: Value) -> Result<String> {
        let request = serde_json::from_value(request).map_err(|error| {
            Error::from_reason(format!("Invalid post-process request: {error}"))
        })?;
        reason(commands::audio_postprocess::post_process_audio(request))
    }

    // ── Audio generation sidecar ───────────────────────────────────────

    #[napi]
    pub async fn start_audio_gen_sidecar(&self) -> Result<()> {
        reason(
            commands::audio_gen::start_audio_gen_sidecar(
                Arc::clone(&self.sidecar),
                Arc::clone(&self.singletons.events),
                &self.singletons.audio_gen,
            )
            .await,
        )
    }

    #[napi]
    pub async fn generate_audio_clip(
        &self,
        prompt: String,
        bpm: Option<f64>,
        key: Option<String>,
        duration_bars: Option<u32>,
        duration_seconds: Option<f64>,
    ) -> Result<Value> {
        json(reason(
            commands::audio_gen::generate_audio_clip(
                Arc::clone(&self.sidecar),
                Arc::clone(&self.singletons.events),
                prompt,
                bpm.map(|value| value as f32),
                key,
                duration_bars,
                duration_seconds.map(|value| value as f32),
                &self.singletons.audio_gen,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn stop_audio_gen_sidecar(&self) -> Result<()> {
        reason(commands::audio_gen::stop_audio_gen_sidecar(&self.singletons.audio_gen).await)
    }

    // ── Dictation ──────────────────────────────────────────────────────

    #[napi]
    pub async fn load_whisper_model(&self, model_path: String) -> Result<Value> {
        json(reason(
            commands::speech::load_whisper_model(model_path, &self.singletons.dictation).await,
        )?)
    }

    #[napi]
    pub async fn ensure_whisper_ready(&self) -> Result<Value> {
        json(reason(
            commands::speech::ensure_whisper_ready(&self.singletons.dictation).await,
        )?)
    }

    #[napi]
    pub async fn start_dictation(&self) -> Result<()> {
        reason(
            commands::speech::start_dictation(
                Arc::clone(&self.singletons.events),
                &self.singletons.dictation,
            )
            .await,
        )
    }

    #[napi]
    pub fn stop_dictation(&self) -> Result<()> {
        reason(commands::speech::stop_dictation(&self.singletons.dictation))
    }

    #[napi]
    pub async fn get_asr_status(&self) -> Result<Value> {
        json(reason(
            commands::speech::get_asr_status(&self.singletons.dictation).await,
        )?)
    }

    // ── Filesystem ─────────────────────────────────────────────────────

    #[napi]
    pub async fn read_audio_file(&self, path: String) -> Result<Buffer> {
        Ok(Buffer::from(reason(
            commands::filesystem::read_audio_file(path).await,
        )?))
    }

    #[napi]
    pub async fn write_audio_file(&self, path: String, data: Buffer) -> Result<()> {
        reason(commands::filesystem::write_audio_file(path, data.to_vec()).await)
    }

    #[napi]
    pub async fn read_file_bytes(&self, path: String) -> Result<Buffer> {
        Ok(Buffer::from(reason(
            commands::filesystem::read_file_bytes(path).await,
        )?))
    }

    #[napi]
    pub async fn write_file_bytes(&self, path: String, data: Buffer) -> Result<()> {
        reason(commands::filesystem::write_file_bytes(path, &data).await)
    }

    #[napi]
    pub async fn list_directory(&self, path: String) -> Result<Value> {
        json(reason(commands::filesystem::list_directory(path).await)?)
    }

    // ── Plugin hosting ─────────────────────────────────────────────────

    #[napi]
    pub async fn scan_plugins(&self, paths: Vec<String>) -> Result<Value> {
        json(reason(
            commands::plugins::scan_plugins(paths, &self.singletons.app_state).await,
        )?)
    }

    #[napi]
    pub async fn get_default_plugin_paths(&self) -> Result<Vec<String>> {
        reason(commands::plugins::get_default_plugin_paths().await)
    }

    #[napi]
    pub async fn load_plugin(&self, plugin_id: String, instance_id: String) -> Result<Value> {
        json(reason(
            commands::plugins::load_plugin(
                PluginId(plugin_id),
                PluginInstanceId(instance_id),
                &self.singletons.app_state,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn unload_plugin(&self, instance_id: Option<String>) -> Result<Value> {
        json(reason(
            commands::plugins::unload_plugin(
                instance_id.map(PluginInstanceId),
                self.windows.as_ref(),
                &self.singletons.app_state,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn set_plugin_parameter(
        &self,
        instance_id: String,
        param_id: u32,
        value: f64,
    ) -> Result<()> {
        reason(
            commands::plugins::set_plugin_parameter(
                PluginInstanceId(instance_id),
                param_id,
                value,
                &self.singletons.app_state,
            )
            .await,
        )
    }

    #[napi]
    pub async fn get_plugin_parameters(&self, instance_id: String) -> Result<Value> {
        json(reason(
            commands::plugins::get_plugin_parameters(
                PluginInstanceId(instance_id),
                &self.singletons.app_state,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn get_plugin_state_bytes(&self, instance_id: String) -> Result<Buffer> {
        Ok(Buffer::from(reason(
            commands::plugins::get_plugin_state_bytes(
                PluginInstanceId(instance_id),
                &self.singletons.app_state,
            )
            .await,
        )?))
    }

    #[napi]
    pub async fn set_plugin_state_bytes(
        &self,
        instance_id: String,
        plugin_state: Buffer,
    ) -> Result<()> {
        reason(
            commands::plugins::set_plugin_state_bytes(
                instance_id,
                &plugin_state,
                &self.singletons.app_state,
            )
            .await,
        )
    }

    #[napi]
    pub async fn start_native_engine(&self) -> Result<String> {
        reason(commands::plugins::start_native_engine(&self.singletons.app_state).await)
    }

    #[napi]
    pub async fn send_plugin_midi(
        &self,
        engine_plugin_id: u32,
        note: u8,
        velocity: u8,
        channel: i16,
        is_note_on: bool,
    ) -> Result<()> {
        reason(
            commands::plugins::send_plugin_midi(
                engine_plugin_id as usize,
                note,
                velocity,
                channel,
                is_note_on,
                &self.singletons.app_state,
            )
            .await,
        )
    }

    #[napi]
    pub async fn set_plugin_bypass(&self, instance_id: String, bypassed: bool) -> Result<()> {
        reason(
            commands::plugins::set_plugin_bypass(instance_id, bypassed, &self.singletons.app_state)
                .await,
        )
    }

    #[napi]
    #[allow(clippy::too_many_arguments)]
    pub async fn update_plugin_transport(
        &self,
        tempo: f64,
        time_sig_num: u16,
        time_sig_denom: u16,
        is_playing: bool,
        song_pos_beats: f64,
        song_pos_seconds: f64,
    ) -> Result<()> {
        reason(
            commands::plugins::update_plugin_transport(
                tempo,
                time_sig_num,
                time_sig_denom,
                is_playing,
                song_pos_beats,
                song_pos_seconds,
                &self.singletons.app_state,
            )
            .await,
        )
    }

    #[napi]
    pub async fn process_plugin_audio(
        &self,
        instance_id: String,
        audio_bytes: Buffer,
    ) -> Result<Buffer> {
        Ok(Buffer::from(reason(
            commands::plugins::process_plugin_audio(
                instance_id,
                audio_bytes.to_vec(),
                &self.singletons.app_state,
            )
            .await,
        )?))
    }

    #[napi]
    pub async fn engine_rt_diagnostics(&self) -> Result<Value> {
        json(reason(
            commands::engine_diagnostics::engine_rt_diagnostics(&self.singletons.app_state).await,
        )?)
    }

    // ── Plugin GUI ─────────────────────────────────────────────────────

    #[napi]
    pub async fn is_plugin_gui_supported(&self, instance_id: String) -> Result<bool> {
        reason(
            commands::plugin_gui::is_plugin_gui_supported(instance_id, &self.singletons.app_state)
                .await,
        )
    }

    #[napi]
    pub async fn open_plugin_gui(&self, instance_id: String) -> Result<Value> {
        json(reason(
            commands::plugin_gui::open_plugin_gui(
                instance_id,
                self.windows.as_ref(),
                &self.singletons.app_state,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn close_plugin_gui(&self, instance_id: String) -> Result<()> {
        reason(
            commands::plugin_gui::close_plugin_gui(
                instance_id,
                self.windows.as_ref(),
                &self.singletons.app_state,
            )
            .await,
        )
    }

    #[napi]
    pub async fn close_all_plugin_guis(&self) -> Result<Value> {
        json(reason(
            commands::plugin_gui::close_all_plugin_guis(
                self.windows.as_ref(),
                &self.singletons.app_state,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn hide_all_plugin_guis(&self) -> Result<()> {
        reason(
            commands::plugin_gui::hide_all_plugin_guis(
                self.windows.as_ref(),
                &self.singletons.app_state,
            )
            .await,
        )
    }

    #[napi]
    pub async fn show_all_plugin_guis(&self) -> Result<()> {
        reason(
            commands::plugin_gui::show_all_plugin_guis(
                self.windows.as_ref(),
                &self.singletons.app_state,
            )
            .await,
        )
    }

    // ── MIDI bridge ────────────────────────────────────────────────────

    #[napi]
    pub fn list_midi_inputs(&self) -> Result<Value> {
        json(reason(commands::midi::list_midi_inputs())?)
    }

    #[napi]
    pub fn open_midi_input(&self, port_index: u32) -> Result<String> {
        reason(commands::midi::open_midi_input(
            port_index as usize,
            Arc::clone(&self.singletons.events),
            &self.singletons.midi,
        ))
    }

    #[napi]
    pub fn close_midi_input(&self) -> Result<()> {
        reason(commands::midi::close_midi_input(&self.singletons.midi))
    }

    #[napi]
    pub async fn open_push_transport(&self, model: String) -> Result<()> {
        reason(
            commands::midi::open_push_transport(
                model,
                Arc::clone(&self.singletons.events),
                &self.singletons.push,
            )
            .await,
        )
    }

    #[napi]
    pub async fn send_push_midi(&self, bytes: Buffer) -> Result<()> {
        reason(
            commands::midi::send_push_midi(
                &bytes,
                Arc::clone(&self.singletons.events),
                &self.singletons.push,
            )
            .await,
        )
    }

    #[napi]
    pub async fn write_push2_display(&self, bytes: Buffer) -> Result<()> {
        reason(
            commands::midi::write_push2_display(
                &bytes,
                Arc::clone(&self.singletons.events),
                &self.singletons.push,
            )
            .await,
        )
    }

    #[napi]
    pub async fn close_push_transport(&self) -> Result<()> {
        reason(commands::midi::close_push_transport(&self.singletons.push).await)
    }

    // ── Ableton Link bridge ────────────────────────────────────────────

    #[napi]
    pub async fn enable_link(&self) -> Result<Value> {
        json(reason(
            commands::link::enable_link(&self.singletons.link).await,
        )?)
    }

    #[napi]
    pub async fn disable_link(&self) -> Result<()> {
        reason(commands::link::disable_link(&self.singletons.link).await)
    }

    #[napi]
    pub async fn set_link_tempo(&self, tempo: f64) -> Result<()> {
        reason(commands::link::set_link_tempo(tempo, &self.singletons.link).await)
    }

    #[napi]
    pub async fn get_link_status(&self) -> Result<Value> {
        json(reason(
            commands::link::get_link_status(&self.singletons.link).await,
        )?)
    }

    #[napi]
    pub async fn link_start_playing(&self) -> Result<()> {
        reason(commands::link::link_start_playing(&self.singletons.link).await)
    }

    #[napi]
    pub async fn link_stop_playing(&self) -> Result<()> {
        reason(commands::link::link_stop_playing(&self.singletons.link).await)
    }

    // ── CRDT collaboration ─────────────────────────────────────────────

    #[napi]
    pub fn collab_create_project(&self, name: String, sample_rate: u32) -> Result<bool> {
        reason(commands::collab::collab_create_project(
            &self.singletons.collab,
            name,
            sample_rate,
        ))
    }

    #[napi]
    pub fn collab_save_bundle(&self, path: String) -> Result<bool> {
        reason(commands::collab::collab_save_bundle(
            &self.singletons.collab,
            path,
        ))
    }

    #[napi]
    pub fn collab_load_bundle(&self, path: String) -> Result<Value> {
        json(reason(commands::collab::collab_load_bundle(
            &self.singletons.collab,
            path,
        ))?)
    }

    #[napi]
    pub fn collab_get_document_state(&self, doc_id: String) -> Result<Value> {
        reason(commands::collab::collab_get_document_state(
            &self.singletons.collab,
            doc_id,
        ))
    }

    #[napi]
    pub fn collab_merge_bundle(&self, path: String) -> Result<Value> {
        json(reason(commands::collab::collab_merge_bundle(
            &self.singletons.collab,
            path,
        ))?)
    }

    #[napi]
    pub fn collab_apply_change(&self, doc_id: String, change_bytes: Buffer) -> Result<bool> {
        reason(commands::collab::collab_apply_change(
            &self.singletons.collab,
            doc_id,
            change_bytes.to_vec(),
        ))
    }

    #[napi]
    pub fn collab_start_advertising(
        &self,
        session_id: String,
        host_name: String,
        project_name: String,
        port: u16,
        approval_required: bool,
    ) -> Result<bool> {
        reason(commands::collab::collab_start_advertising(
            &self.singletons.collab,
            session_id,
            host_name,
            project_name,
            port,
            approval_required,
        ))
    }

    #[napi]
    pub fn collab_stop_advertising(&self) -> Result<bool> {
        reason(commands::collab::collab_stop_advertising(
            &self.singletons.collab,
        ))
    }

    #[napi]
    pub fn collab_start_browsing(&self) -> Result<bool> {
        reason(commands::collab::collab_start_browsing(
            &self.singletons.collab,
        ))
    }

    #[napi]
    pub fn collab_stop_browsing(&self) -> Result<bool> {
        reason(commands::collab::collab_stop_browsing(
            &self.singletons.collab,
        ))
    }

    #[napi]
    pub fn collab_get_nearby_sessions(&self) -> Result<Value> {
        json(reason(commands::collab::collab_get_nearby_sessions(
            &self.singletons.collab,
        ))?)
    }

    // Discovery shutdown is deliberately not exposed on its own: it is one step
    // of the exit cascade, and a shell that can reach it alone can quit having
    // run only it. `shutdown()` is the entry point.

    // ── Crumbs ─────────────────────────────────────────────────────────

    #[napi]
    pub async fn create_crumbs(&self, instance_id: String, sample_rate: f64) -> Result<()> {
        reason(
            commands::crumbs::create_crumbs(
                instance_id,
                sample_rate as f32,
                &self.singletons.crumbs,
                &self.singletons.app_state,
            )
            .await,
        )
    }

    #[napi]
    pub async fn destroy_crumbs(&self, instance_id: String) -> Result<()> {
        reason(
            commands::crumbs::destroy_crumbs(
                instance_id,
                &self.singletons.crumbs,
                &self.singletons.app_state,
            )
            .await,
        )
    }

    #[napi]
    pub async fn load_sample(&self, instance_id: String, file_path: String) -> Result<Value> {
        json(reason(
            commands::crumbs::load_sample(instance_id, file_path, &self.singletons.crumbs).await,
        )?)
    }

    #[napi]
    pub async fn crumbs_note_on(&self, instance_id: String, note: u8, velocity: u8) -> Result<()> {
        reason(
            commands::crumbs::crumbs_note_on(instance_id, note, velocity, &self.singletons.crumbs)
                .await,
        )
    }

    #[napi]
    pub async fn crumbs_note_off(&self, instance_id: String, note: u8) -> Result<()> {
        reason(commands::crumbs::crumbs_note_off(instance_id, note, &self.singletons.crumbs).await)
    }

    #[napi]
    pub async fn set_crumbs_param(
        &self,
        instance_id: String,
        param: String,
        value: f64,
    ) -> Result<()> {
        reason(
            commands::crumbs::set_crumbs_param(
                instance_id,
                param,
                value as f32,
                &self.singletons.crumbs,
            )
            .await,
        )
    }

    #[napi]
    pub async fn set_crumbs_mode(&self, instance_id: String, mode: String) -> Result<()> {
        reason(commands::crumbs::set_crumbs_mode(instance_id, mode, &self.singletons.crumbs).await)
    }

    #[napi]
    pub async fn get_waveform_peaks(
        &self,
        instance_id: String,
        sample_id: u32,
        level: u32,
        channel: Option<u8>,
    ) -> Result<Buffer> {
        Ok(Buffer::from(reason(
            commands::crumbs::get_waveform_peaks(
                instance_id,
                sample_id,
                level as usize,
                channel,
                &self.singletons.crumbs,
            )
            .await,
        )?))
    }

    #[napi]
    pub async fn detect_onsets(
        &self,
        instance_id: String,
        sample_id: u32,
        algorithm: String,
    ) -> Result<Value> {
        json(reason(
            commands::crumbs::detect_onsets(
                instance_id,
                sample_id,
                algorithm,
                &self.singletons.crumbs,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn detect_sample_pitch(&self, instance_id: String, sample_id: u32) -> Result<Value> {
        json(reason(
            commands::crumbs::detect_sample_pitch(instance_id, sample_id, &self.singletons.crumbs)
                .await,
        )?)
    }

    #[napi]
    pub async fn crumbs_all_sound_off(&self, instance_id: String) -> Result<()> {
        reason(commands::crumbs::crumbs_all_sound_off(instance_id, &self.singletons.crumbs).await)
    }

    #[napi]
    pub async fn get_crumbs_position(&self, instance_id: String) -> Result<BigInt> {
        let position = reason(
            commands::crumbs::get_crumbs_position(instance_id, &self.singletons.crumbs).await,
        )?;
        // Sample position is a u64 frame count: past 2^53 frames a JS number
        // would start rounding, and a rounded playhead is a wrong playhead.
        Ok(BigInt::from(position))
    }

    #[napi]
    pub async fn detect_smart_loop_points(
        &self,
        instance_id: String,
        sample_id: u32,
    ) -> Result<Value> {
        json(reason(
            commands::crumbs::detect_smart_loop_points(
                instance_id,
                sample_id,
                &self.singletons.crumbs,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn arm_recording(
        &self,
        instance_id: String,
        threshold: f64,
        target_pad: u8,
        max_duration_secs: f64,
    ) -> Result<()> {
        reason(
            commands::crumbs::arm_recording(
                instance_id,
                threshold as f32,
                target_pad,
                max_duration_secs as f32,
                &self.singletons.crumbs,
            )
            .await,
        )
    }

    #[napi]
    pub async fn stop_recording(&self, instance_id: String) -> Result<()> {
        reason(commands::crumbs::stop_recording(instance_id, &self.singletons.crumbs).await)
    }

    // ── Pitch edit ─────────────────────────────────────────────────────

    #[napi]
    pub async fn analyze_pitch(&self, analysis_id: String, audio_path: String) -> Result<Value> {
        json(reason(
            commands::pitch_edit::analyze_pitch(
                Arc::clone(&self.singletons.events),
                analysis_id,
                audio_path,
            )
            .await,
        )?)
    }

    #[napi]
    pub async fn commit_pitch_edit(&self, request: Value) -> Result<()> {
        let request = serde_json::from_value(request).map_err(|error| {
            Error::from_reason(format!("Invalid pitch commit request: {error}"))
        })?;
        reason(commands::pitch_edit::commit_pitch_edit(request).await)
    }

    // ── Tuning ─────────────────────────────────────────────────────────

    #[napi]
    pub fn parse_scl(&self, content: String, root_note: u8, root_freq: f64) -> Result<Value> {
        json(reason(commands::tuning::parse_scl(
            content, root_note, root_freq,
        ))?)
    }
}
