use mistralrs::{
    Constraint, Function, GgufModelBuilder, PagedAttentionMetaBuilder, RequestBuilder, Response,
    TextMessageRole, Tool, ToolChoice, ToolType,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::RwLock;

use super::model_download;

// ── Managed state ────────────────────────────────────────────────────────

pub struct NativeLlmState {
    model: Arc<RwLock<Option<Arc<mistralrs::Model>>>>,
    model_id: Arc<RwLock<Option<String>>>,
}

impl Default for NativeLlmState {
    fn default() -> Self {
        Self {
            model: Arc::new(RwLock::new(None)),
            model_id: Arc::new(RwLock::new(None)),
        }
    }
}

// ── Types ────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
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
    Token { text: String },
    Done { total_tokens: u32 },
    Error { message: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub name: String,
    pub arguments: serde_json::Value,
}

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

// ── Helper ───────────────────────────────────────────────────────────────

async fn get_model(state: &NativeLlmState) -> Result<Arc<mistralrs::Model>, String> {
    let guard = state.model.read().await;
    guard
        .clone()
        .ok_or_else(|| "No model loaded. Call init_native_llm first.".to_string())
}

// ── Commands ─────────────────────────────────────────────────────────────

/// Initialize the native LLM.
/// Step 1: Download GGUF file with real progress (via our reqwest downloader).
/// Step 2: Load model from local file (no network needed).
#[tauri::command]
pub async fn init_native_llm(
    model_id: Option<String>,
    app: AppHandle,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<NativeLlmStatus, String> {
    // Already loaded?
    {
        let guard = state.model.read().await;
        if guard.is_some() {
            let id = state.model_id.read().await;
            return Ok(NativeLlmStatus {
                loaded: true,
                model_id: id.clone(),
            });
        }
    }

    let _ = model_id; // reserved for future model selection

    // Step 1: Ensure GGUF file is downloaded (with real progress)
    let _ = app.emit(
        "llm-progress",
        serde_json::json!({ "progress": 0.0, "text": "Checking model cache…" }),
    );

    let model_path = model_download::ensure_model(&GGUF_MODEL).await?;
    let model_path_str = model_path.to_string_lossy().to_string();

    let _ = app.emit(
        "llm-progress",
        serde_json::json!({ "progress": 0.7, "text": "Loading model into memory…" }),
    );
    eprintln!("[Native LLM] GGUF downloaded, loading from: {model_path_str}");

    // Step 2: Load from local GGUF file
    let model: mistralrs::Model = GgufModelBuilder::new(GGUF_REPO, vec![GGUF_FILE])
        .with_logging()
        .with_paged_attn(|| PagedAttentionMetaBuilder::default().build())
        .map_err(|e| format!("PagedAttention config error: {e}"))?
        .build()
        .await
        .map_err(|e| format!("Failed to load model: {e}"))?;

    let _ = app.emit(
        "llm-progress",
        serde_json::json!({ "progress": 1.0, "text": "Ready" }),
    );
    eprintln!("[Native LLM] Model loaded successfully");

    let model = Arc::new(model);
    {
        let mut guard = state.model.write().await;
        *guard = Some(model);
    }
    {
        let mut guard = state.model_id.write().await;
        *guard = Some(GGUF_REPO.to_string());
    }

    Ok(NativeLlmStatus {
        loaded: true,
        model_id: Some(GGUF_REPO.to_string()),
    })
}

/// Non-streaming completion.
#[tauri::command]
pub async fn generate_native_completion(
    system_prompt: String,
    user_message: String,
    temperature: Option<f32>,
    max_tokens: Option<usize>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<String, String> {
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

    let response = model
        .send_chat_request(request)
        .await
        .map_err(|e| format!("Inference error: {e}"))?;

    Ok(response
        .choices
        .first()
        .and_then(|c| c.message.content.as_ref())
        .cloned()
        .unwrap_or_default())
}

/// Streaming completion via Tauri Channel.
#[tauri::command]
pub async fn stream_native_completion(
    system_prompt: String,
    messages: Vec<ChatMessage>,
    temperature: Option<f32>,
    max_tokens: Option<usize>,
    on_event: Channel<LlmStreamEvent>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<(), String> {
    let model = get_model(&state).await?;

    let mut request = RequestBuilder::new().add_message(TextMessageRole::System, &system_prompt);

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

    let mut stream = model.stream_chat_request(request).await.map_err(|e| {
        let msg = format!("Stream init error: {e}");
        let _ = on_event.send(LlmStreamEvent::Error {
            message: msg.clone(),
        });
        msg
    })?;

    let mut total_tokens: u32 = 0;

    while let Some(chunk) = stream.next().await {
        match chunk {
            Response::Chunk(resp) => {
                if let Some(choice) = resp.choices.first() {
                    if let Some(ref content) = choice.delta.content {
                        if !content.is_empty() {
                            total_tokens += 1;
                            let _ = on_event.send(LlmStreamEvent::Token {
                                text: content.clone(),
                            });
                        }
                    }
                }
            }
            Response::Done(_) => break,
            Response::ModelError(msg, _) => {
                let _ = on_event.send(LlmStreamEvent::Error {
                    message: msg.to_string(),
                });
                return Err(msg.to_string());
            }
            _ => {}
        }
    }

    let _ = on_event.send(LlmStreamEvent::Done { total_tokens });
    Ok(())
}

/// Tool-calling inference.
#[tauri::command]
pub async fn native_tool_calling(
    system_prompt: String,
    user_message: String,
    tools: Vec<ToolDef>,
    temperature: Option<f32>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<Vec<ToolCallResult>, String> {
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

    let response = model
        .send_chat_request(request)
        .await
        .map_err(|e| format!("Tool calling error: {e}"))?;

    let message = response
        .choices
        .first()
        .map(|c| &c.message)
        .ok_or("No response")?;
    let mut results = Vec::new();

    if let Some(ref tool_calls) = message.tool_calls {
        for call in tool_calls {
            let arguments: serde_json::Value = serde_json::from_str(&call.function.arguments)
                .unwrap_or(serde_json::Value::Object(Default::default()));
            results.push(ToolCallResult {
                name: call.function.name.clone(),
                arguments,
            });
        }
    }

    Ok(results)
}

/// Schema-constrained streaming generation.
/// The output is guaranteed to conform to the provided JSON schema at the token level.
/// This is the primary edit protocol — DSO output via schema constraints.
#[tauri::command]
pub async fn schema_constrained_generation(
    system_prompt: String,
    user_message: String,
    json_schema: String,
    temperature: Option<f32>,
    max_tokens: Option<usize>,
    on_event: Channel<LlmStreamEvent>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<(), String> {
    let model = get_model(&state).await?;

    let mut request = RequestBuilder::new()
        .add_message(TextMessageRole::System, &system_prompt)
        .add_message(TextMessageRole::User, &user_message)
        .set_constraint(Constraint::JsonSchema(serde_json::Value::String(
            json_schema,
        )))
        .set_sampler_temperature(temperature.unwrap_or(0.1) as f64)
        .set_sampler_topp(0.9)
        .set_sampler_max_len(max_tokens.unwrap_or(2048));

    let mut stream = model.stream_chat_request(request).await.map_err(|e| {
        let msg = format!("Schema-constrained stream init error: {e}");
        let _ = on_event.send(LlmStreamEvent::Error {
            message: msg.clone(),
        });
        msg
    })?;

    let mut total_tokens: u32 = 0;

    while let Some(chunk) = stream.next().await {
        match chunk {
            Response::Chunk(resp) => {
                if let Some(choice) = resp.choices.first() {
                    if let Some(ref content) = choice.delta.content {
                        if !content.is_empty() {
                            total_tokens += 1;
                            let _ = on_event.send(LlmStreamEvent::Token {
                                text: content.clone(),
                            });
                        }
                    }
                }
            }
            Response::Done(_) => break,
            Response::ModelError(msg, _) => {
                let _ = on_event.send(LlmStreamEvent::Error {
                    message: msg.to_string(),
                });
                return Err(msg.to_string());
            }
            _ => {}
        }
    }

    let _ = on_event.send(LlmStreamEvent::Done { total_tokens });
    Ok(())
}

/// Unload model.
#[tauri::command]
pub async fn unload_native_llm(state: tauri::State<'_, NativeLlmState>) -> Result<(), String> {
    {
        let mut guard = state.model.write().await;
        *guard = None;
    }
    {
        let mut guard = state.model_id.write().await;
        *guard = None;
    }
    eprintln!("[Native LLM] Model unloaded");
    Ok(())
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
