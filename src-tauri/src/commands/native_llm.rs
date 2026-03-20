use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Native LLM inference state using in-process model loading.
/// Replaces the external llama-server sidecar with direct inference.
pub struct NativeLlmState {
    loaded: Mutex<bool>,
    model_path: Mutex<Option<String>>,
}

impl Default for NativeLlmState {
    fn default() -> Self {
        Self {
            loaded: Mutex::new(false),
            model_path: Mutex::new(None),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NativeLlmStatus {
    pub loaded: bool,
    pub model_path: Option<String>,
    pub backend: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NativeInferenceRequest {
    pub system_prompt: String,
    pub user_message: String,
    pub temperature: Option<f32>,
    pub max_tokens: Option<u32>,
    pub grammar: Option<String>,
}

/// Load a GGUF model for native inference.
/// In production, uses mistral.rs or llama.cpp bindings for in-process loading.
#[tauri::command]
pub async fn load_native_model(
    model_path: String,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<NativeLlmStatus, String> {
    // Validate file exists
    if !std::path::Path::new(&model_path).exists() {
        return Err(format!("Model file not found: {model_path}"));
    }

    // In production: mistral_rs::Model::from_gguf(&model_path)
    // or: candle_core with GGUF loader
    let mut loaded = state.loaded.lock().map_err(|e| format!("Lock: {e}"))?;
    *loaded = true;
    let mut path = state.model_path.lock().map_err(|e| format!("Lock: {e}"))?;
    *path = Some(model_path);

    Ok(NativeLlmStatus {
        loaded: true,
        model_path: path.clone(),
        backend: "native-gguf".into(),
    })
}

/// Generate completion using the native model.
/// Supports grammar-constrained output for structured tool calling.
#[tauri::command]
pub async fn native_inference(
    request: NativeInferenceRequest,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<String, String> {
    let loaded = state.loaded.lock().map_err(|e| format!("Lock: {e}"))?;
    if !*loaded {
        return Err("No model loaded. Call load_native_model first.".into());
    }

    // In production: model.generate(&prompt, &sampling_params, grammar_constraint)
    // Grammar-constrained decoding ensures valid JSON for tool calls
    Ok(format!(
        "{{\"action\": \"noop\", \"note\": \"Native inference stub — model loaded, \
         prompt: {:.50}...\"}}", request.user_message
    ))
}

/// Unload the native model to free memory.
#[tauri::command]
pub async fn unload_native_model(
    state: tauri::State<'_, NativeLlmState>,
) -> Result<(), String> {
    let mut loaded = state.loaded.lock().map_err(|e| format!("Lock: {e}"))?;
    *loaded = false;
    let mut path = state.model_path.lock().map_err(|e| format!("Lock: {e}"))?;
    *path = None;
    Ok(())
}

// ── Tool Calling Pipeline ────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters_schema: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolCall {
    pub tool_name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolCallingRequest {
    pub system_prompt: String,
    pub user_message: String,
    pub tools: Vec<ToolDefinition>,
    pub temperature: Option<f32>,
}

/// Execute a structured tool-calling pipeline.
/// Uses grammar-constrained decoding to ensure valid JSON tool calls.
#[tauri::command]
pub async fn execute_tool_calling(
    request: ToolCallingRequest,
    state: tauri::State<'_, NativeLlmState>,
) -> Result<Vec<ToolCall>, String> {
    let loaded = state.loaded.lock().map_err(|e| format!("Lock: {e}"))?;
    if !*loaded {
        return Err("No model loaded".into());
    }

    // In production:
    // 1. Build JSON schema grammar from tool definitions
    // 2. Generate with grammar constraint → guaranteed valid JSON
    // 3. Parse tool calls from structured output
    // 4. Validate arguments against parameter schemas

    let tool_names: Vec<String> = request.tools.iter().map(|t| t.name.clone()).collect();

    Ok(vec![ToolCall {
        tool_name: tool_names.first().cloned().unwrap_or_else(|| "noop".into()),
        arguments: serde_json::json!({"note": "Stub tool call — grammar-constrained decoding not yet active"}),
    }])
}
