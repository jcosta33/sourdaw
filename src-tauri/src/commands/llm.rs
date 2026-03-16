use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmRequest {
    pub prompt: String,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmResponse {
    pub text: String,
    pub tokens_used: u32,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmStatus {
    pub loaded: bool,
    pub model_name: Option<String>,
    pub model_size_mb: Option<u64>,
}

#[tauri::command]
pub async fn invoke_llm(request: LlmRequest) -> Result<LlmResponse, String> {
    // Sidecar integration point: spawn llama-server process and communicate via HTTP/stdin
    // For now, return a stub response indicating the sidecar is not yet running
    Err(format!(
        "LLM sidecar not available. Prompt was: '{}'. Install llama.cpp sidecar to enable.",
        request.prompt
    ))
}

#[tauri::command]
pub async fn get_llm_status() -> Result<LlmStatus, String> {
    Ok(LlmStatus {
        loaded: false,
        model_name: None,
        model_size_mb: None,
    })
}
