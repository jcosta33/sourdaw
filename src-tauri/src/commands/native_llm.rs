use mistralrs::{
    Constraint, Function, GgufModelBuilder, PagedAttentionMetaBuilder, RequestBuilder, Response,
    TextMessageRole, Tool, ToolChoice, ToolType,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::{watch, Mutex, RwLock};

use super::model_download;

const MAX_STREAM_EVENT_BYTES: usize = 64 * 1024;
const MAX_STREAM_BYTES: usize = 1024 * 1024;
const MAX_STREAM_EVENTS: u32 = 4096;

// ── Managed state ────────────────────────────────────────────────────────

pub struct NativeLlmState {
    model: Arc<RwLock<Option<Arc<mistralrs::Model>>>>,
    model_id: Arc<RwLock<Option<String>>>,
    model_owner: Arc<RwLock<Option<String>>>,
    initialization: Arc<Mutex<()>>,
    cancellations: Arc<RwLock<HashMap<String, GenerationCancellation>>>,
}

impl Default for NativeLlmState {
    fn default() -> Self {
        Self {
            model: Arc::new(RwLock::new(None)),
            model_id: Arc::new(RwLock::new(None)),
            model_owner: Arc::new(RwLock::new(None)),
            initialization: Arc::new(Mutex::new(())),
            cancellations: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

// ── Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLlmStatus {
    pub loaded: bool,
    pub model_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum LlmStreamEvent {
    Token {
        #[serde(rename = "requestId")]
        request_id: String,
        sequence: u32,
        text: String,
    },
    Done {
        #[serde(rename = "requestId")]
        request_id: String,
        sequence: u32,
        prompt_tokens: usize,
        completion_tokens: usize,
        finish_reason: String,
    },
    Error {
        #[serde(rename = "requestId")]
        request_id: String,
        sequence: u32,
        message: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub struct ToolCallResult {
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum NativeToolCallingResponse {
    Complete {
        #[serde(rename = "protocolVersion")]
        protocol_version: u8,
        #[serde(rename = "toolCalls")]
        tool_calls: Vec<ToolCallResult>,
    },
    Rejected {
        #[serde(rename = "protocolVersion")]
        protocol_version: u8,
        reason: String,
    },
}

const NATIVE_TOOL_CALLING_PROTOCOL_VERSION: u8 = 1;

// ── Model config ─────────────────────────────────────────────────────────

const GGUF_REPO: &str = "Qwen/Qwen3-8B-GGUF";
const GGUF_FILE: &str = "Qwen3-8B-Q4_K_M.gguf";
const GGUF_URL: &str =
    "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/7c41481f57cb95916b40956ab2f0b139b296d974/Qwen3-8B-Q4_K_M.gguf";
const GGUF_SHA256: &str = "d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785";
const GGUF_SIZE_BYTES: u64 = 5_027_783_488;
const GGUF_MODEL: model_download::ModelDownload = model_download::ModelDownload {
    filename: GGUF_FILE,
    url: GGUF_URL,
    expected_sha256: GGUF_SHA256,
    expected_size_bytes: GGUF_SIZE_BYTES,
};

#[derive(Debug, PartialEq, Eq)]
struct VerifiedGgufLoadTarget {
    model_id: String,
    files: Vec<String>,
}

struct GenerationCancellation {
    sender: watch::Sender<bool>,
    registered: bool,
    created_at: Instant,
}

const CANCELLATION_TOMBSTONE_TTL: Duration = Duration::from_secs(30);
const MAX_CANCELLATION_TOMBSTONES: usize = 256;

// ── Helper ───────────────────────────────────────────────────────────────

async fn get_model(state: &NativeLlmState) -> Result<Arc<mistralrs::Model>, String> {
    let guard = state.model.read().await;
    guard
        .clone()
        .ok_or_else(|| "No model loaded. Call init_native_llm first.".to_string())
}

async fn register_generation_cancellation(
    state: &NativeLlmState,
    request_id: &str,
) -> watch::Receiver<bool> {
    let mut cancellations = state.cancellations.write().await;
    prune_cancellation_tombstones(&mut cancellations);
    let cancellation = cancellations
        .entry(request_id.to_string())
        .or_insert_with(|| GenerationCancellation {
            sender: watch::channel(false).0,
            registered: true,
            created_at: Instant::now(),
        });
    cancellation.registered = true;
    cancellation.sender.subscribe()
}

async fn request_generation_cancellation(state: &NativeLlmState, request_id: &str) {
    let mut cancellations = state.cancellations.write().await;
    prune_cancellation_tombstones(&mut cancellations);
    if !cancellations.contains_key(request_id) {
        evict_oldest_cancellation_tombstone_if_full(&mut cancellations);
    }
    let cancellation = cancellations
        .entry(request_id.to_string())
        .or_insert_with(|| GenerationCancellation {
            sender: watch::channel(false).0,
            registered: false,
            created_at: Instant::now(),
        });
    cancellation.sender.send_replace(true);
}

async fn clear_generation_cancellation(state: &NativeLlmState, request_id: &str) {
    state.cancellations.write().await.remove(request_id);
}

async fn wait_for_generation_cancellation(cancellation: &mut watch::Receiver<bool>) {
    if *cancellation.borrow_and_update() {
        return;
    }

    while cancellation.changed().await.is_ok() {
        if *cancellation.borrow_and_update() {
            return;
        }
    }
}

fn generation_cancelled_error() -> String {
    "Native LLM generation cancelled".to_string()
}

fn prune_cancellation_tombstones(cancellations: &mut HashMap<String, GenerationCancellation>) {
    cancellations.retain(|_, cancellation| {
        cancellation.registered || cancellation.created_at.elapsed() < CANCELLATION_TOMBSTONE_TTL
    });
}

fn evict_oldest_cancellation_tombstone_if_full(
    cancellations: &mut HashMap<String, GenerationCancellation>,
) {
    let tombstone_count = cancellations
        .values()
        .filter(|cancellation| !cancellation.registered)
        .count();
    if tombstone_count < MAX_CANCELLATION_TOMBSTONES {
        return;
    }

    let oldest_request_id = cancellations
        .iter()
        .filter(|(_, cancellation)| !cancellation.registered)
        .min_by_key(|(_, cancellation)| cancellation.created_at)
        .map(|(request_id, _)| request_id.clone());
    if let Some(request_id) = oldest_request_id {
        cancellations.remove(&request_id);
    }
}

fn validate_text_finish_reason(finish_reason: &str, context: &str) -> Result<(), String> {
    if finish_reason == "stop" {
        return Ok(());
    }
    Err(format!(
        "{context} ended incompletely with finish reason {finish_reason}"
    ))
}

fn validate_stream_finish_reason(finish_reason: &str) -> Result<(), String> {
    if finish_reason == "stop" || finish_reason == "length" {
        return Ok(());
    }
    Err(format!(
        "Native completion stream ended with unsupported finish reason {finish_reason}"
    ))
}

async fn unload_model_if_owned(state: &NativeLlmState, request_id: &str) -> bool {
    let _initialization = state.initialization.lock().await;
    if state.model_owner.read().await.as_deref() != Some(request_id) {
        return false;
    }

    *state.model.write().await = None;
    *state.model_id.write().await = None;
    *state.model_owner.write().await = None;
    true
}

async fn finalize_model_initialization(
    state: &NativeLlmState,
    request_id: &str,
) -> NativeLlmStatus {
    let _initialization = state.initialization.lock().await;
    let loaded = state.model.read().await.is_some();
    let model_id = state.model_id.read().await.clone();
    let owner = state.model_owner.read().await.clone();
    finalization_status(loaded, model_id, owner.as_deref(), request_id)
}

fn finalization_status(
    loaded: bool,
    model_id: Option<String>,
    owner: Option<&str>,
    request_id: &str,
) -> NativeLlmStatus {
    if !loaded || owner.is_some_and(|owner| owner != request_id) {
        return NativeLlmStatus {
            loaded: false,
            model_id: None,
        };
    }
    NativeLlmStatus {
        loaded: true,
        model_id,
    }
}

fn verified_gguf_load_target(model_path: &Path) -> Result<VerifiedGgufLoadTarget, String> {
    let file_name = model_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Verified GGUF path must include a UTF-8 file name".to_string())?;
    if file_name != GGUF_FILE {
        return Err(format!(
            "Verified GGUF file mismatch: expected {GGUF_FILE}, got {file_name}"
        ));
    }

    let model_dir = model_path
        .parent()
        .ok_or_else(|| "Verified GGUF path must include a parent directory".to_string())?;
    let model_id = model_dir
        .to_str()
        .ok_or_else(|| "Verified GGUF parent directory must be UTF-8".to_string())?
        .to_string();

    Ok(VerifiedGgufLoadTarget {
        model_id,
        files: vec![GGUF_FILE.to_string()],
    })
}

// ── Commands ─────────────────────────────────────────────────────────────

/// Initialize the native LLM.
/// Step 1: Download GGUF file with real progress (via our reqwest downloader).
/// Step 2: Load model from local file (no network needed).
#[tauri::command]
pub async fn init_native_llm(
    request_id: String,
    model_id: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<NativeLlmStatus, String> {
    let mut cancellation = register_generation_cancellation(&state, &request_id).await;
    let result = async {
        let _initialization = tokio::select! {
            biased;
            _ = wait_for_generation_cancellation(&mut cancellation) => {
                return Err(generation_cancelled_error());
            }
            lock = state.initialization.lock() => lock,
        };

        if state.model.read().await.is_some() {
            *state.model_owner.write().await = None;
            return Ok(NativeLlmStatus {
                loaded: true,
                model_id: state.model_id.read().await.clone(),
            });
        }

        let _ = model_id; // reserved for future model selection

        let _ = app.emit(
            "llm-progress",
            serde_json::json!({ "progress": 0.0, "text": "Checking model cache…" }),
        );

        let model_path = tokio::select! {
            biased;
            _ = wait_for_generation_cancellation(&mut cancellation) => {
                return Err(generation_cancelled_error());
            }
            model_path = model_download::ensure_model(&GGUF_MODEL) => model_path?,
        };
        let model_path_str = model_path.to_string_lossy().to_string();
        let gguf_load_target = verified_gguf_load_target(&model_path)?;

        let _ = app.emit(
            "llm-progress",
            serde_json::json!({ "progress": 0.7, "text": "Loading model into memory…" }),
        );
        eprintln!("[Native LLM] GGUF downloaded, loading from: {model_path_str}");

        let paged_attn_cfg = PagedAttentionMetaBuilder::default()
            .build()
            .map_err(|e| format!("PagedAttention config error: {e}"))?;

        let model_builder =
            GgufModelBuilder::new(gguf_load_target.model_id, gguf_load_target.files)
                .with_logging()
                .with_paged_attn(paged_attn_cfg)
                .build();
        let model: mistralrs::Model = tokio::select! {
            biased;
            _ = wait_for_generation_cancellation(&mut cancellation) => {
                return Err(generation_cancelled_error());
            }
            model = model_builder => model.map_err(|e| format!("Failed to load model: {e}"))?,
        };

        let _ = app.emit(
            "llm-progress",
            serde_json::json!({ "progress": 1.0, "text": "Ready" }),
        );
        eprintln!("[Native LLM] Model loaded successfully");

        *state.model.write().await = Some(Arc::new(model));
        *state.model_id.write().await = Some(GGUF_REPO.to_string());
        *state.model_owner.write().await = Some(request_id.clone());

        Ok(NativeLlmStatus {
            loaded: true,
            model_id: Some(GGUF_REPO.to_string()),
        })
    }
    .await;
    clear_generation_cancellation(&state, &request_id).await;
    result
}

/// Non-streaming completion.
#[tauri::command]
pub async fn generate_native_completion(
    request_id: String,
    system_prompt: String,
    user_message: String,
    temperature: Option<f32>,
    max_tokens: Option<usize>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<String, String> {
    let mut cancellation = register_generation_cancellation(&state, &request_id).await;
    let result = async {
        let model = get_model(&state).await?;

        let mut request = RequestBuilder::new()
            .add_message(TextMessageRole::System, &system_prompt)
            .add_message(TextMessageRole::User, &user_message);

        if let Some(temp) = temperature {
            request = request.set_sampler_temperature(temp as f64);
        }
        if let Some(max) = max_tokens {
            request = request.set_sampler_max_len(max);
        }

        let response = tokio::select! {
            biased;
            _ = wait_for_generation_cancellation(&mut cancellation) => {
                return Err(generation_cancelled_error());
            }
            response = model.send_chat_request(request) => {
                response.map_err(|e| format!("Inference error: {e}"))?
            }
        };

        let choice = response.choices.first().ok_or("No completion response")?;
        validate_text_finish_reason(&choice.finish_reason, "Native completion")?;
        Ok(choice.message.content.clone().unwrap_or_default())
    }
    .await;
    clear_generation_cancellation(&state, &request_id).await;
    result
}

/// Streaming completion via Tauri Channel.
#[tauri::command]
pub async fn stream_native_completion(
    request_id: String,
    system_prompt: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<usize>,
    on_event: Channel<LlmStreamEvent>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<(), String> {
    let mut cancellation = register_generation_cancellation(&state, &request_id).await;
    let result = async {
        let model = get_model(&state).await?;

        let mut request =
            RequestBuilder::new().add_message(TextMessageRole::System, &system_prompt);

        for msg in &messages {
            let role = match msg.role.as_str() {
                "user" => TextMessageRole::User,
                "assistant" => TextMessageRole::Assistant,
                _ => TextMessageRole::User,
            };
            request = request.add_message(role, &msg.content);
        }

        if let Some(temp) = temperature {
            request = request.set_sampler_temperature(temp as f64);
        }
        if let Some(max) = max_tokens {
            request = request.set_sampler_max_len(max);
        }

        let mut stream = tokio::select! {
            biased;
            _ = wait_for_generation_cancellation(&mut cancellation) => {
                return Err(generation_cancelled_error());
            }
            stream = model.stream_chat_request(request) => {
                stream.map_err(|e| {
                    let msg = format!("Stream init error: {e}");
                    let _ = on_event.send(LlmStreamEvent::Error {
                        request_id: request_id.clone(),
                        sequence: 0,
                        message: msg.clone(),
                    });
                    msg
                })?
            }
        };

        let mut completed = false;
        let mut sequence = 0u32;
        let mut streamed_bytes = 0usize;

        loop {
            let chunk = tokio::select! {
                biased;
                _ = wait_for_generation_cancellation(&mut cancellation) => {
                    return Err(generation_cancelled_error());
                }
                chunk = stream.next() => chunk,
            };
            let Some(chunk) = chunk else {
                break;
            };

            match chunk {
                Response::Chunk(resp) => {
                    if let Some(choice) = resp.choices.first() {
                        if let Some(ref content) = choice.delta.content {
                            if !content.is_empty() {
                                if content.len() > MAX_STREAM_EVENT_BYTES
                                    || streamed_bytes.saturating_add(content.len()) > MAX_STREAM_BYTES
                                    || sequence >= MAX_STREAM_EVENTS
                                {
                                    let message = "Native completion stream exceeded its bounded protocol limits";
                                    let _ = on_event.send(LlmStreamEvent::Error {
                                        request_id: request_id.clone(),
                                        sequence,
                                        message: message.to_string(),
                                    });
                                    return Err(message.to_string());
                                }
                                let _ = on_event.send(LlmStreamEvent::Token {
                                    request_id: request_id.clone(),
                                    sequence,
                                    text: content.clone(),
                                });
                                sequence += 1;
                                streamed_bytes += content.len();
                            }
                        }
                    }
                }
                Response::Done(response) => {
                    let choice = response
                        .choices
                        .first()
                        .ok_or("No stream completion response")?;
                    validate_stream_finish_reason(&choice.finish_reason)?;
                    let _ = on_event.send(LlmStreamEvent::Done {
                        request_id: request_id.clone(),
                        sequence,
                        prompt_tokens: response.usage.prompt_tokens,
                        completion_tokens: response.usage.completion_tokens,
                        finish_reason: choice.finish_reason.clone(),
                    });
                    completed = true;
                    break;
                }
                Response::ModelError(msg, _) => {
                    let _ = on_event.send(LlmStreamEvent::Error {
                        request_id: request_id.clone(),
                        sequence,
                        message: msg.to_string(),
                    });
                    return Err(msg.to_string());
                }
                _ => {}
            }
        }

        if !completed {
            return Err("Native completion stream ended without a terminal response".to_string());
        }
        Ok(())
    }
    .await;
    clear_generation_cancellation(&state, &request_id).await;
    result
}

/// Tool-calling inference.
#[tauri::command]
pub async fn native_tool_calling(
    request_id: String,
    system_prompt: String,
    user_message: String,
    tools: Vec<ToolDef>,
    temperature: Option<f32>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<NativeToolCallingResponse, String> {
    let mut cancellation = register_generation_cancellation(&state, &request_id).await;
    let result = async {
        let model = get_model(&state).await?;

        let mr_tools: Vec<Tool> = tools
            .iter()
            .map(|t| {
                let parameters: HashMap<String, serde_json::Value> =
                    serde_json::from_value(t.parameters.clone()).unwrap_or_default();
                Tool {
                    tp: ToolType::Function,
                    function: Function {
                        description: Some(t.description.clone()),
                        name: t.name.clone(),
                        parameters: Some(parameters),
                    },
                }
            })
            .collect();

        let mut request = RequestBuilder::new()
            .add_message(TextMessageRole::System, &system_prompt)
            .add_message(TextMessageRole::User, &user_message)
            .set_tools(mr_tools)
            .set_tool_choice(ToolChoice::Auto);

        if let Some(temp) = temperature {
            request = request.set_sampler_temperature(temp as f64);
        }

        let response = tokio::select! {
            biased;
            _ = wait_for_generation_cancellation(&mut cancellation) => {
                return Err(generation_cancelled_error());
            }
            response = model.send_chat_request(request) => {
                response.map_err(|e| format!("Tool calling error: {e}"))?
            }
        };

        let Some(choice) = response.choices.first() else {
            return Ok(rejected_native_tool_calling(
                "Native tool calling returned no choice",
            ));
        };
        let message = &choice.message;
        let has_tool_calls = message
            .tool_calls
            .as_ref()
            .is_some_and(|tool_calls| !tool_calls.is_empty());
        if let Err(reason) = validate_native_tool_finish(
            &choice.finish_reason,
            has_tool_calls,
            message.content.as_deref(),
        ) {
            return Ok(rejected_native_tool_calling(reason));
        }
        if !has_tool_calls {
            return Ok(completed_native_tool_calling(Vec::new()));
        }
        let mut results = Vec::new();

        if let Some(ref tool_calls) = message.tool_calls {
            for call in tool_calls {
                match parse_native_tool_call(&call.function.name, &call.function.arguments) {
                    Ok(result) => results.push(result),
                    Err(reason) => return Ok(rejected_native_tool_calling(reason)),
                }
            }
        }

        Ok(completed_native_tool_calling(results))
    }
    .await;
    clear_generation_cancellation(&state, &request_id).await;
    result
}

fn rejected_native_tool_calling(reason: impl Into<String>) -> NativeToolCallingResponse {
    NativeToolCallingResponse::Rejected {
        protocol_version: NATIVE_TOOL_CALLING_PROTOCOL_VERSION,
        reason: reason.into(),
    }
}

fn completed_native_tool_calling(tool_calls: Vec<ToolCallResult>) -> NativeToolCallingResponse {
    NativeToolCallingResponse::Complete {
        protocol_version: NATIVE_TOOL_CALLING_PROTOCOL_VERSION,
        tool_calls,
    }
}

fn validate_native_tool_finish(
    finish_reason: &str,
    has_tool_calls: bool,
    content: Option<&str>,
) -> Result<(), String> {
    match (finish_reason, has_tool_calls) {
        ("tool_calls", true) => Ok(()),
        ("stop", false) if content.map(str::trim).unwrap_or_default().is_empty() => Ok(()),
        ("stop", false) => Err("Native tool calling returned non-tool assistant text".to_string()),
        (reason, _) => Err(format!(
            "Native tool calling returned inconsistent finish reason {reason}"
        )),
    }
}

fn parse_native_tool_call(name: &str, raw_arguments: &str) -> Result<ToolCallResult, String> {
    let arguments: serde_json::Value = serde_json::from_str(raw_arguments)
        .map_err(|error| format!("Native tool {name} returned malformed arguments: {error}"))?;
    if !arguments.is_object() {
        return Err(format!(
            "Native tool {name} arguments must be a JSON object"
        ));
    }
    Ok(ToolCallResult {
        name: name.to_string(),
        arguments,
    })
}

/// Parse the IPC schema argument into the constraint value llguidance
/// expects. The frontend sends the schema as a serialized JSON string
/// (`jsonSchema: string`); llguidance requires the parsed object/boolean —
/// wrapping the raw string in `Value::String` made grammar construction
/// fail with "schema must be an object or boolean" on every request.
fn build_json_schema_constraint(json_schema: &str) -> Result<Constraint, String> {
    let value: serde_json::Value =
        serde_json::from_str(json_schema).map_err(|e| format!("Invalid JSON schema: {e}"))?;
    if value.as_object().is_none() && value.as_bool().is_none() {
        return Err("JSON schema must be an object or boolean".to_string());
    }
    Ok(Constraint::JsonSchema(value))
}

/// Schema-constrained streaming generation.
/// The output is guaranteed to conform to the provided JSON schema at the token level.
/// Callers use schema constraints to validate provider-specific structured output at generation time.
#[tauri::command]
pub async fn schema_constrained_generation(
    request_id: String,
    system_prompt: String,
    user_message: String,
    json_schema: String,
    temperature: Option<f32>,
    max_tokens: Option<usize>,
    on_event: Channel<LlmStreamEvent>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<(), String> {
    let mut cancellation = register_generation_cancellation(&state, &request_id).await;
    let result = async {
        let model = get_model(&state).await?;

        let constraint = build_json_schema_constraint(&json_schema).map_err(|e| {
            let _ = on_event.send(LlmStreamEvent::Error {
                request_id: request_id.clone(),
                sequence: 0,
                message: e.clone(),
            });
            e
        })?;

        let request = RequestBuilder::new()
            .add_message(TextMessageRole::System, &system_prompt)
            .add_message(TextMessageRole::User, &user_message)
            .set_constraint(constraint)
            .set_sampler_temperature(temperature.unwrap_or(0.1) as f64)
            .set_sampler_topp(0.9)
            .set_sampler_max_len(max_tokens.unwrap_or(2048));

        let mut stream = tokio::select! {
            biased;
            _ = wait_for_generation_cancellation(&mut cancellation) => {
                return Err(generation_cancelled_error());
            }
            stream = model.stream_chat_request(request) => {
                stream.map_err(|e| {
                    let msg = format!("Schema-constrained stream init error: {e}");
                    let _ = on_event.send(LlmStreamEvent::Error {
                        request_id: request_id.clone(),
                        sequence: 0,
                        message: msg.clone(),
                    });
                    msg
                })?
            }
        };

        let mut completed = false;
        let mut sequence = 0u32;
        let mut streamed_bytes = 0usize;

        loop {
            let chunk = tokio::select! {
                biased;
                _ = wait_for_generation_cancellation(&mut cancellation) => {
                    return Err(generation_cancelled_error());
                }
                chunk = stream.next() => chunk,
            };
            let Some(chunk) = chunk else {
                break;
            };

            match chunk {
                Response::Chunk(resp) => {
                    if let Some(choice) = resp.choices.first() {
                        if let Some(ref content) = choice.delta.content {
                            if !content.is_empty() {
                                if content.len() > MAX_STREAM_EVENT_BYTES
                                    || streamed_bytes.saturating_add(content.len()) > MAX_STREAM_BYTES
                                    || sequence >= MAX_STREAM_EVENTS
                                {
                                    let message = "Native schema-constrained stream exceeded its bounded protocol limits";
                                    let _ = on_event.send(LlmStreamEvent::Error {
                                        request_id: request_id.clone(),
                                        sequence,
                                        message: message.to_string(),
                                    });
                                    return Err(message.to_string());
                                }
                                let _ = on_event.send(LlmStreamEvent::Token {
                                    request_id: request_id.clone(),
                                    sequence,
                                    text: content.clone(),
                                });
                                sequence += 1;
                                streamed_bytes += content.len();
                            }
                        }
                    }
                }
                Response::Done(response) => {
                    let choice = response
                        .choices
                        .first()
                        .ok_or("No schema-constrained completion response")?;
                    validate_text_finish_reason(
                        &choice.finish_reason,
                        "Native schema-constrained generation",
                    )?;
                    let _ = on_event.send(LlmStreamEvent::Done {
                        request_id: request_id.clone(),
                        sequence,
                        prompt_tokens: response.usage.prompt_tokens,
                        completion_tokens: response.usage.completion_tokens,
                        finish_reason: choice.finish_reason.clone(),
                    });
                    completed = true;
                    break;
                }
                Response::ModelError(msg, _) => {
                    let _ = on_event.send(LlmStreamEvent::Error {
                        request_id: request_id.clone(),
                        sequence,
                        message: msg.to_string(),
                    });
                    return Err(msg.to_string());
                }
                _ => {}
            }
        }

        if !completed {
            return Err(
                "Native schema-constrained generation ended without a terminal response"
                    .to_string(),
            );
        }
        Ok(())
    }
    .await;
    clear_generation_cancellation(&state, &request_id).await;
    result
}

#[tauri::command]
pub async fn cancel_native_llm_generation(
    request_id: String,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<(), String> {
    request_generation_cancellation(&state, &request_id).await;
    Ok(())
}

/// Unload model.
#[tauri::command]
pub async fn unload_native_llm(state: tauri::State<'_, NativeLlmState>) -> Result<(), String> {
    let _initialization = state.initialization.lock().await;
    *state.model.write().await = None;
    *state.model_id.write().await = None;
    *state.model_owner.write().await = None;
    eprintln!("[Native LLM] Model unloaded");
    Ok(())
}

#[tauri::command]
pub async fn unload_native_llm_if_owned(
    request_id: String,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<bool, String> {
    let unloaded = unload_model_if_owned(&state, &request_id).await;
    if unloaded {
        eprintln!("[Native LLM] Cancelled initialization unloaded its model");
    }
    Ok(unloaded)
}

#[tauri::command]
pub async fn finalize_native_llm_initialization(
    request_id: String,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<NativeLlmStatus, String> {
    Ok(finalize_model_initialization(&state, &request_id).await)
}

/// Status check.
#[tauri::command]
pub async fn get_native_llm_status(
    state: tauri::State<'_, NativeLlmState>,
) -> Result<NativeLlmStatus, String> {
    let loaded = state.model.read().await.is_some();
    let model_id = state.model_id.read().await.clone();
    Ok(NativeLlmStatus { loaded, model_id })
}

/// Return the default model directory path (creates it if absent).
#[tauri::command]
pub fn get_model_dir() -> Result<String, String> {
    let dir = dirs::data_dir()
        .ok_or("Could not determine data directory")?
        .join("com.sourdaw.app")
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create model directory: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// llguidance-1.7.0/src/json/schema.rs:608-610 gate, mirrored verbatim:
    /// grammar construction rejects any schema value that is not an object
    /// or boolean with "schema must be an object or boolean".
    fn llguidance_schema_gate(value: &serde_json::Value) -> Result<(), String> {
        if value.as_object().is_some() || value.as_bool().is_some() {
            Ok(())
        } else {
            Err("schema must be an object or boolean".to_string())
        }
    }

    /// Regression (F1): the command receives the schema as a serialized
    /// JSON string over IPC and must hand llguidance the parsed object —
    /// the parsed value must pass the llguidance gate (object or boolean).
    #[test]
    fn should_parse_serialized_schema_into_object_constraint() {
        let json_schema = r#"{"type":"object","properties":{"kind":{"type":"string"}}}"#;

        let constraint = match build_json_schema_constraint(json_schema) {
            Ok(c) => c,
            Err(e) => panic!("expected a valid constraint, got: {e}"),
        };
        let Constraint::JsonSchema(value) = constraint else {
            panic!("expected JsonSchema constraint")
        };

        assert_eq!(
            llguidance_schema_gate(&value),
            Ok(()),
            "constraint value must satisfy the llguidance object/boolean gate"
        );
        assert_eq!(value["type"], "object");
    }

    /// Regression (F1): the pre-fix construction (Value::String around the
    /// raw string) is exactly the shape llguidance rejects — pin the gate
    /// so the constraint path can never regress to it.
    #[test]
    fn should_reject_non_object_schema_values_at_the_gate() {
        let string_valued = serde_json::Value::String(r#"{"type":"object"}"#.to_string());
        assert_eq!(
            llguidance_schema_gate(&string_valued),
            Err("schema must be an object or boolean".to_string())
        );

        let err = match build_json_schema_constraint(r#""just a string""#) {
            Ok(_) => panic!("string-valued schema must be rejected"),
            Err(e) => e,
        };
        assert_eq!(err, "JSON schema must be an object or boolean");
    }

    #[test]
    fn should_reject_malformed_schema_json_with_clear_error() {
        let err = match build_json_schema_constraint("{not json") {
            Ok(_) => panic!("malformed schema must be rejected"),
            Err(e) => e,
        };
        assert!(
            err.starts_with("Invalid JSON schema:"),
            "expected a parse error, got: {err}"
        );
    }

    #[test]
    fn should_build_gguf_target_from_verified_local_file() {
        let model_dir = std::env::temp_dir().join("sourdaw-models");
        let model_path = model_dir.join(GGUF_FILE);

        let target = verified_gguf_load_target(&model_path).unwrap();

        assert_eq!(
            target,
            VerifiedGgufLoadTarget {
                model_id: model_dir.to_str().unwrap().to_string(),
                files: vec![GGUF_FILE.to_string()],
            }
        );
    }

    #[test]
    fn should_reject_gguf_target_with_unexpected_filename() {
        let model_path = std::env::temp_dir()
            .join("sourdaw-models")
            .join("unverified.gguf");

        let result = verified_gguf_load_target(&model_path);

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err(),
            "Verified GGUF file mismatch: expected Qwen3-8B-Q4_K_M.gguf, got unverified.gguf"
        );
    }

    #[tokio::test]
    async fn should_observe_cancellation_requested_before_generation_registration() {
        let state = NativeLlmState::default();
        request_generation_cancellation(&state, "request-1").await;
        let mut cancellation = register_generation_cancellation(&state, "request-1").await;

        wait_for_generation_cancellation(&mut cancellation).await;

        assert!(*cancellation.borrow());
    }

    #[tokio::test]
    async fn should_remove_finished_generation_cancellation_state() {
        let state = NativeLlmState::default();
        let _cancellation = register_generation_cancellation(&state, "request-2").await;

        clear_generation_cancellation(&state, "request-2").await;

        assert!(!state.cancellations.read().await.contains_key("request-2"));
    }

    #[tokio::test]
    async fn should_not_unload_a_model_owned_by_a_replacement_initialization() {
        let state = NativeLlmState::default();
        *state.model_owner.write().await = Some("replacement".to_string());

        let unloaded = unload_model_if_owned(&state, "cancelled").await;

        assert!(!unloaded);
        assert_eq!(
            state.model_owner.read().await.as_deref(),
            Some("replacement")
        );
    }

    #[tokio::test]
    async fn should_not_finalize_when_no_model_is_loaded() {
        let state = NativeLlmState::default();
        *state.model_owner.write().await = Some("installer".to_string());

        assert!(!finalize_model_initialization(&state, "other").await.loaded);
        assert_eq!(state.model_owner.read().await.as_deref(), Some("installer"));
    }

    #[test]
    fn should_finalize_only_the_matching_or_stable_model_installation() {
        assert!(
            finalization_status(
                true,
                Some("model".to_string()),
                Some("installer"),
                "installer"
            )
            .loaded
        );
        assert!(finalization_status(true, Some("model".to_string()), None, "cache-hit").loaded);
        assert!(
            !finalization_status(
                true,
                Some("model".to_string()),
                Some("replacement"),
                "installer"
            )
            .loaded
        );
    }

    #[tokio::test]
    async fn should_bound_unknown_cancellation_tombstones() {
        let state = NativeLlmState::default();
        for index in 0..=MAX_CANCELLATION_TOMBSTONES {
            request_generation_cancellation(&state, &format!("unknown-{index}")).await;
        }

        let cancellations = state.cancellations.read().await;
        let tombstone_count = cancellations
            .values()
            .filter(|cancellation| !cancellation.registered)
            .count();

        assert_eq!(tombstone_count, MAX_CANCELLATION_TOMBSTONES);
    }

    #[test]
    fn should_serialize_correlated_native_stream_events() {
        assert_eq!(
            serde_json::to_value(LlmStreamEvent::Token {
                request_id: "request-1".to_string(),
                sequence: 4,
                text: "hello".to_string(),
            })
            .expect("native stream event must serialize"),
            serde_json::json!({
                "event": "token",
                "data": { "requestId": "request-1", "sequence": 4, "text": "hello" }
            })
        );
    }

    #[test]
    fn should_serialize_native_tool_calling_response_with_camel_case_fields() {
        assert_eq!(
            serde_json::to_value(NativeToolCallingResponse::Complete {
                protocol_version: NATIVE_TOOL_CALLING_PROTOCOL_VERSION,
                tool_calls: Vec::new(),
            })
            .expect("complete tool-planning DTO must serialize"),
            serde_json::json!({"status": "complete", "protocolVersion": 1, "toolCalls": []})
        );
        assert_eq!(
            serde_json::to_value(rejected_native_tool_calling("Native planning rejected"))
                .expect("rejected tool-planning DTO must serialize"),
            serde_json::json!({
                "status": "rejected",
                "protocolVersion": 1,
                "reason": "Native planning rejected"
            })
        );
    }

    #[test]
    fn should_classify_native_tool_finish_states() {
        assert!(validate_native_tool_finish("tool_calls", true, Some("")).is_ok());
        assert!(validate_native_tool_finish("tool_calls", true, Some("Using mute")).is_ok());
        assert_eq!(
            validate_native_tool_finish("length", true, None),
            Err("Native tool calling returned inconsistent finish reason length".to_string())
        );
        assert_eq!(
            validate_native_tool_finish("stop", true, None),
            Err("Native tool calling returned inconsistent finish reason stop".to_string())
        );
        for (content, expected) in [
            (None, Ok(())),
            (Some(""), Ok(())),
            (Some(" \n"), Ok(())),
            (
                Some("I cannot do that"),
                Err("Native tool calling returned non-tool assistant text".to_string()),
            ),
        ] {
            assert_eq!(
                validate_native_tool_finish("stop", false, content),
                expected
            );
        }
    }

    #[test]
    fn should_reject_malformed_or_non_object_native_tool_arguments() {
        let malformed = parse_native_tool_call("muteTrack", "{");
        let non_object = parse_native_tool_call("muteTrack", "[]");

        assert!(malformed
            .as_ref()
            .is_err_and(|reason| reason.contains("returned malformed arguments")));
        assert_eq!(
            non_object,
            Err("Native tool muteTrack arguments must be a JSON object".to_string())
        );
    }

    #[test]
    fn should_reject_incomplete_native_text_finish_reasons() {
        assert_eq!(validate_text_finish_reason("stop", "Native test"), Ok(()));
        assert_eq!(
            validate_text_finish_reason("length", "Native test"),
            Err("Native test ended incompletely with finish reason length".to_string())
        );
    }

    #[test]
    fn should_preserve_supported_native_stream_finish_reasons() {
        assert_eq!(validate_stream_finish_reason("stop"), Ok(()));
        assert_eq!(validate_stream_finish_reason("length"), Ok(()));
        assert_eq!(
            validate_stream_finish_reason("content_filter"),
            Err(
                "Native completion stream ended with unsupported finish reason content_filter"
                    .to_string()
            )
        );
    }
}
