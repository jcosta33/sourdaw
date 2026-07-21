use mistralrs::{
    Constraint, Function, GgufModelBuilder, PagedAttentionMetaBuilder, RequestBuilder, Response,
    TextMessageRole, Tool, ToolChoice, ToolType,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
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

#[derive(Debug, PartialEq, Eq)]
struct VerifiedGgufLoadTarget {
    model_id: String,
    files: Vec<String>,
}

// ── Helper ───────────────────────────────────────────────────────────────

async fn get_model(state: &NativeLlmState) -> Result<Arc<mistralrs::Model>, String> {
    let guard = state.model.read().await;
    guard
        .clone()
        .ok_or_else(|| "No model loaded. Call init_native_llm first.".to_string())
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
    let gguf_load_target = verified_gguf_load_target(&model_path)?;

    let _ = app.emit(
        "llm-progress",
        serde_json::json!({ "progress": 0.7, "text": "Loading model into memory…" }),
    );
    eprintln!("[Native LLM] GGUF downloaded, loading from: {model_path_str}");

    // Step 2: Load from the verified cache directory. mistralrs resolves GGUF
    // files as `model_id` + `files`, so `model_id` must be the local directory.
    let paged_attn_cfg = PagedAttentionMetaBuilder::default()
        .build()
        .map_err(|e| format!("PagedAttention config error: {e}"))?;

    let model: mistralrs::Model =
        GgufModelBuilder::new(gguf_load_target.model_id, gguf_load_target.files)
            .with_logging()
            .with_paged_attn(paged_attn_cfg)
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

    let constraint = build_json_schema_constraint(&json_schema).map_err(|e| {
        let _ = on_event.send(LlmStreamEvent::Error {
            message: e.clone(),
        });
        e
    })?;

    let mut request = RequestBuilder::new()
        .add_message(TextMessageRole::System, &system_prompt)
        .add_message(TextMessageRole::User, &user_message)
        .set_constraint(constraint)
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
}
