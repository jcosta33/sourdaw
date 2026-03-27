use mistralrs::{
    Function, IsqType, PagedAttentionMetaBuilder, RequestBuilder,
    Response, TextMessageRole, TextModelBuilder, Tool, ToolChoice, ToolType,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::RwLock;

// ── Managed state ────────────────────────────────────────────────────────

/// In-process LLM state. The model downloads from HuggingFace Hub on first
/// init and stays loaded in memory until explicitly unloaded.
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

// ── Default model ────────────────────────────────────────────────────────

const DEFAULT_MODEL_ID: &str = "NousResearch/Hermes-3-Llama-3.1-8B";

// ── Helper: get loaded model or return error ─────────────────────────────

async fn get_model(
    state: &NativeLlmState,
) -> Result<Arc<mistralrs::Model>, String> {
    let guard = state.model.read().await;
    guard
        .clone()
        .ok_or_else(|| "No model loaded. Call init_native_llm first.".to_string())
}

// ── Commands ─────────────────────────────────────────────────────────────

/// Initialize the native LLM engine. Downloads the model from HuggingFace Hub
/// on first use, applies 4-bit quantization in-process, and loads to GPU.
/// No manual GGUF download or external binary required.
#[tauri::command]
pub async fn init_native_llm(
    model_id: Option<String>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<NativeLlmStatus, String> {
    // If already loaded, return immediately
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

    let id = model_id.unwrap_or_else(|| DEFAULT_MODEL_ID.to_string());
    eprintln!("[Native LLM] Loading model: {id} (4-bit quantization, this may take a moment on first run)...");

    let model: mistralrs::Model = TextModelBuilder::new(id.clone())
        .with_isq(IsqType::Q4K)
        .with_logging()
        .with_paged_attn(|| PagedAttentionMetaBuilder::default().build())
        .map_err(|e| format!("PagedAttention config error: {e}"))?
        .build()
        .await
        .map_err(|e| format!("Failed to load model: {e}"))?;

    eprintln!("[Native LLM] Model loaded successfully");

    let model = Arc::new(model);
    {
        let mut guard = state.model.write().await;
        *guard = Some(model);
    }
    {
        let mut guard = state.model_id.write().await;
        *guard = Some(id.clone());
    }

    Ok(NativeLlmStatus {
        loaded: true,
        model_id: Some(id),
    })
}

/// Non-streaming completion. Returns the full response text.
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

    let content = response.choices.first()
        .and_then(|c| c.message.content.as_ref())
        .cloned()
        .unwrap_or_default();

    Ok(content)
}

/// Streaming completion via Tauri Channel. Sends tokens as they are generated.
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

    let mut request = RequestBuilder::new()
        .add_message(TextMessageRole::System, &system_prompt);

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

    let mut stream = model
        .stream_chat_request(request)
        .await
        .map_err(|e| {
            let msg = format!("Stream init error: {e}");
            let _ = on_event.send(LlmStreamEvent::Error { message: msg.clone() });
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

/// Tool-calling inference. Sends tools to the model and returns parsed tool calls.
#[tauri::command]
pub async fn native_tool_calling(
    system_prompt: String,
    user_message: String,
    tools: Vec<ToolDef>,
    temperature: Option<f32>,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<Vec<ToolCallResult>, String> {
    let model = get_model(&state).await?;

    // Convert our ToolDef to mistralrs Tool format
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

    let message = response.choices.first()
        .map(|c| &c.message)
        .ok_or("No response from model")?;

    let mut results = Vec::new();

    if let Some(ref tool_calls) = message.tool_calls {
        for call in tool_calls {
            let arguments: serde_json::Value =
                serde_json::from_str(&call.function.arguments)
                    .unwrap_or(serde_json::Value::Object(Default::default()));
            results.push(ToolCallResult {
                name: call.function.name.clone(),
                arguments,
            });
        }
    }

    Ok(results)
}

/// Unload the model to free GPU/RAM.
#[tauri::command]
pub async fn unload_native_llm(
    state: tauri::State<'_, NativeLlmState>,
) -> Result<(), String> {
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

/// Check whether a model is loaded.
#[tauri::command]
pub async fn get_native_llm_status(
    state: tauri::State<'_, NativeLlmState>,
) -> Result<NativeLlmStatus, String> {
    let loaded = state.model.read().await.is_some();
    let model_id = state.model_id.read().await.clone();
    Ok(NativeLlmStatus { loaded, model_id })
}
