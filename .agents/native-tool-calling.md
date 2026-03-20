# Natural language to DAW tool calls: a Rust + Tauri v2 implementation guide

**A local LLM running inside a Tauri desktop app can reliably decompose prompts like "make it sound like David Gilmour" into structured chains of DAW operations.** The recommended stack is **mistral.rs v0.7** for in-process inference with **Qwen3-8B Q4_K_M** (the strongest 7-8B tool-calling model available, scoring F1=0.919 — near GPT-4 accuracy), streamed to a React frontend via Tauri events. This guide covers every layer: inference engine selection, tool call schemas, the Rust pipeline, RAG for musical knowledge, and a complete worked example.

---

## 1. Local LLM inference in Rust: the engine decision

### mistral.rs v0.7 is the clear winner for embedded use

The `mistralrs` crate (MIT, ~6.3k GitHub stars) is purpose-built for embedding as a Rust library — no server required. It runs in-process via async Rust on Tokio, making it ideal for Tauri v2 backends.

**Tool calling support is first-class.** Three mechanisms exist:

```rust
// Mechanism 1: ToolCallback — register a closure
let model = TextModelBuilder::new("Qwen/Qwen3-8B".to_string())
    .with_isq(IsqType::Q4K)
    .with_tool_callback(|called_fn| {
        // called_fn.name: &str, called_fn.arguments: serde_json::Value
        Ok(format!("Executed {} successfully", called_fn.name))
    })
    .build()
    .await?;

// Mechanism 2: #[tool] proc macro — declarative
#[tool]
fn set_reverb(track_id: u32, decay: f64, mix: f64) -> String {
    format!("Set reverb on track {}: decay={}s, mix={}%", track_id, decay, mix * 100.0)
}

// Mechanism 3: Agent/AgentBuilder — full agentic loop with streaming
let agent = AgentBuilder::new(model)
    .with_tool(set_reverb_tool)
    .build();
let mut stream: AgentStream = agent.run_stream("Add lush reverb to the guitar").await?;
```

**Streaming is native async.** Call `model.stream_chat_request(messages)` to get a `futures::Stream` of `ChatCompletionChunkResponse` items. Under the hood, mistral.rs uses `tokio::mpsc` channels — a natural fit for Tauri's event system.

**ISQ quantization** lets you skip hunting for GGUF files entirely. Point `TextModelBuilder` at any HuggingFace model and pass `.with_isq(IsqType::Q4K)` to quantize on load. For faster startup with pre-quantized models, use `GgufModelBuilder` instead. Supported ISQ types span Q2K through Q8_0, plus HQQ (4/8-bit), AFQ (Metal-optimized 2-8 bit), and FP8. The shorthand `.with_isq(4)` auto-selects the optimal method for your hardware.

**MCP client** is built in via the `mistralrs-mcp` crate with HTTP, WebSocket, and stdio transports. For a DAW app, this is overkill — direct `ToolCallback` or `#[tool]` registration is simpler since everything runs in-process.

**Backend support**: CPU, CUDA (with FlashAttention V2/V3), and Metal (with AFQ affine quantization) are all production-ready. Metal performance is actively being optimized (tracked in issue #903) but already achieves interactive speeds on Apple Silicon.

**Cargo dependency:**

```toml
[dependencies]
mistralrs = { version = "0.7", features = ["metal"] }  # or "cuda"
```

### llama-cpp-2 and llguidance: the structured output alternative

The `llama-cpp-2` crate (and its newer fork `llama-cpp-4`) provides thin safe Rust wrappers around llama.cpp. Its killer advantage is **GBNF grammar-constrained decoding** — at each token, the sampler masks out every token that would violate a grammar, guaranteeing 100% structurally valid JSON:

```rust
use llama_cpp_4::sampling::LlamaSampler;

// Convert JSON schema to GBNF grammar
let grammar = json_schema_to_grammar(&tool_call_schema);
let sampler = LlamaSampler::chain_simple([
    LlamaSampler::grammar(model, &grammar, "root"),
    LlamaSampler::top_k(40),
    LlamaSampler::top_p(0.95, 1),
    LlamaSampler::temp(0.8),
    LlamaSampler::dist(42),
]);
```

**llguidance** (Microsoft/Guidance-AI) is the gold standard for constrained decoding: a Rust-native engine achieving **~50μs per token** with an optimized Earley parser. It's already merged into llama.cpp (`-DLLAMA_LLGUIDANCE=ON`) and Chromium. If you use llama-cpp-2/4 as your backend, enabling llguidance gives state-of-the-art structured output enforcement.

**Trade-off**: llama-cpp-2 is a low-level wrapper — you build your own chat templates, tool calling, and session management. mistral.rs gives you all of this out of the box.

### kalosm: the ergonomic outsider

The `kalosm` crate (v0.4, part of the Floneum ecosystem) offers the most ergonomic structured generation in Rust via `#[derive(Parse, Schema)]`:

```rust
#[derive(Parse, Schema, Clone, Debug)]
struct ToolCall {
    #[parse(pattern = "[a-z_]+")]
    tool_name: String,
    #[parse(pattern = r#"\{[^}]*\}"#)]
    arguments: String,
}
```

This operates at the token level during generation. However, kalosm has no built-in tool-calling loop, slower inference than mistral.rs, and is transitioning backends (v0.5 moves to WGPU via Fusor). It's best as inspiration for structured output patterns rather than a production choice.

### Engine recommendation matrix

| Criterion             | mistral.rs                         | llama-cpp-4 + llguidance            | kalosm                |
| --------------------- | ---------------------------------- | ----------------------------------- | --------------------- |
| Tool calling built-in | ✅ Full (callbacks, macros, Agent) | ❌ Build yourself                   | ❌ Build yourself     |
| Structured output     | ✅ Built-in                        | ✅ Best (GBNF/llguidance)           | ✅ `#[derive(Parse)]` |
| Streaming             | ✅ Native async                    | ✅ Manual                           | ✅ Async              |
| ISQ/quantization      | ✅ On-the-fly                      | ✅ Pre-quantized GGUF               | ⚠️ Limited            |
| Metal/CUDA            | ✅/✅                              | ✅/✅                               | ✅/✅                 |
| Maturity              | ⭐⭐⭐⭐                           | ⭐⭐⭐⭐                            | ⭐⭐⭐                |
| **Recommendation**    | **Primary choice**                 | Fallback if structured output fails | Skip                  |

---

## 2. Model selection: Qwen3-8B dominates tool calling

Docker's 2025 benchmark tested 21 models across 3,570 tool-calling scenarios on consumer hardware. The results are decisive:

| Model               | Tool Selection F1 | Q4_K_M Size | RAM (4K ctx) |
| ------------------- | ----------------- | ----------- | ------------ |
| **Qwen3-8B Q4_K_M** | **0.919**         | ~4.9 GB     | ~6–7 GB      |
| Llama-3.1-8B Q4_K_M | 0.793             | ~4.9 GB     | ~6–7 GB      |
| Qwen2.5-7B Q4_K_M   | 0.753             | ~4.7 GB     | ~5.6–7 GB    |
| xLAM-8B Q4_K_M      | 0.570             | ~4.9 GB     | ~6–7 GB      |

**Qwen3-8B at Q4_K_M scores F1=0.919 — within 6% of GPT-4 (0.974)** and 12+ points ahead of Llama-3.1-8B. Quantization showed no significant degradation of tool-calling accuracy in these tests.

**RAM feasibility**: On a **16GB machine** running a DAW (~3-6 GB) plus OS (~3 GB), a 7B Q4_K_M model at 4K context (~6 GB) is tight but feasible for light sessions. On **32GB**, it's comfortable even at Q5_K_M or 8K context.

**Tokens per second on Apple Silicon** (text generation, 7B Q4_K_M):

- M1 base: **14-18 tok/s** — interactive ✅
- M2 Pro: **25-35 tok/s** — smooth ✅
- M2/M4 Max: **50-63+ tok/s** — fast ✅
- NVIDIA RTX 3060: **33-40 tok/s** — solid ✅
- CPU only: **5-15 tok/s** — marginal

**Tool calling format**: Qwen3 uses Hermes-style `<tool_call>` XML tags, which is the best-supported format across frameworks (vLLM, Ollama, llama.cpp, mistral.rs). Llama 3.1 uses a JSON-based format with `<|eom_id|>` tokens and an `ipython` role for results — functional but less widely supported.

**GGUF sources**: bartowski's HuggingFace repos are the standard for community quantizations with imatrix calibration. Qwen also publishes official GGUFs. Download with:

```bash
huggingface-cli download bartowski/Qwen2.5-7B-Instruct-GGUF \
  --include "Qwen2.5-7B-Instruct-Q4_K_M.gguf" --local-dir ./
```

---

## 3. Tool call schemas for DAW operations

### Complete JSON schema definitions

Every tool follows the OpenAI function-calling schema format. Here are all nine:

```json
[
    {
        "type": "function",
        "function": {
            "name": "load_plugin",
            "description": "Load an audio effect or instrument plugin into a specific slot on a track",
            "parameters": {
                "type": "object",
                "properties": {
                    "plugin_id": {
                        "type": "string",
                        "description": "Plugin identifier, e.g. 'NAM' or 'dragonfly-reverb'"
                    },
                    "track_id": { "type": "integer", "description": "Target track ID" },
                    "slot": { "type": "integer", "description": "Insert slot index (0-based)", "default": 0 }
                },
                "required": ["plugin_id", "track_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_parameter",
            "description": "Set a specific parameter on a loaded plugin",
            "parameters": {
                "type": "object",
                "properties": {
                    "plugin_id": { "type": "string", "description": "Plugin instance to modify" },
                    "param_name": { "type": "string", "description": "Parameter name, e.g. 'gain', 'mix', 'decay'" },
                    "value": {
                        "type": "number",
                        "description": "Parameter value (normalized 0.0-1.0 or absolute depending on param)"
                    },
                    "description": { "type": "string", "description": "Human-readable explanation of this change" }
                },
                "required": ["plugin_id", "param_name", "value"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "load_instrument",
            "description": "Load a virtual instrument onto a track",
            "parameters": {
                "type": "object",
                "properties": {
                    "instrument_name": {
                        "type": "string",
                        "description": "Instrument name, e.g. 'vital', 'surge-xt', 'sfizz'"
                    },
                    "track_id": { "type": "integer", "description": "Target track ID" }
                },
                "required": ["instrument_name", "track_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "generate_midi",
            "description": "Generate a MIDI pattern from a natural language description",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "Musical description, e.g. 'slow bluesy pentatonic melody'"
                    },
                    "key": {
                        "type": "string",
                        "enum": ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"],
                        "default": "A"
                    },
                    "scale": {
                        "type": "string",
                        "enum": [
                            "major",
                            "minor",
                            "pentatonic_minor",
                            "pentatonic_major",
                            "blues",
                            "dorian",
                            "mixolydian"
                        ],
                        "default": "pentatonic_minor"
                    },
                    "bars": { "type": "integer", "minimum": 1, "maximum": 32, "default": 4 },
                    "style": {
                        "type": "string",
                        "description": "Style hint: 'legato', 'staccato', 'arpeggiated', 'chordal'"
                    }
                },
                "required": ["description"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_chord_progression",
            "description": "Write a chord progression as MIDI on a track",
            "parameters": {
                "type": "object",
                "properties": {
                    "progression": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Chord symbols, e.g. ['Bm', 'D', 'A', 'G']"
                    },
                    "track_id": { "type": "integer" },
                    "start_bar": { "type": "integer", "default": 1 },
                    "bars": {
                        "type": "integer",
                        "description": "Total bars for progression (chords distributed evenly)",
                        "default": 4
                    }
                },
                "required": ["progression", "track_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_volume",
            "description": "Set track volume in decibels",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_id": { "type": "integer" },
                    "db": { "type": "number", "minimum": -60, "maximum": 12, "description": "Volume in dB (0 = unity)" }
                },
                "required": ["track_id", "db"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "set_reverb",
            "description": "Add or configure reverb on a track",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_id": { "type": "integer" },
                    "type": {
                        "type": "string",
                        "enum": ["hall", "plate", "room", "spring", "cathedral"],
                        "default": "hall"
                    },
                    "decay_seconds": { "type": "number", "minimum": 0.1, "maximum": 20.0, "default": 2.5 },
                    "mix": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": "Wet/dry mix (0=dry, 1=fully wet)",
                        "default": 0.25
                    }
                },
                "required": ["track_id"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "add_delay",
            "description": "Add a delay effect to a track",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_id": { "type": "integer" },
                    "time_ms": {
                        "type": "number",
                        "minimum": 1,
                        "maximum": 2000,
                        "description": "Delay time in milliseconds"
                    },
                    "feedback": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 0.95,
                        "description": "Feedback amount (0-0.95)",
                        "default": 0.4
                    },
                    "sync_to_tempo": { "type": "boolean", "default": false }
                },
                "required": ["track_id", "time_ms"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "apply_eq_preset",
            "description": "Apply an EQ curve described in natural language",
            "parameters": {
                "type": "object",
                "properties": {
                    "track_id": { "type": "integer" },
                    "description": {
                        "type": "string",
                        "description": "Natural language EQ description, e.g. 'scoop the mids, boost presence at 3kHz'"
                    }
                },
                "required": ["track_id", "description"]
            }
        }
    }
]
```

### Structuring ordered tool call chains

The LLM output should be an **ordered JSON array** of tool calls. Each element specifies one operation; the system executes them sequentially. For a prompt like "make it sound like David Gilmour," the model returns:

```json
{
  "reasoning": "Gilmour's Comfortably Numb tone uses compression → fuzz → rotary modulation → delay → reverb",
  "tool_calls": [
    { "name": "load_plugin", "arguments": { "plugin_id": "lamb-compressor", "track_id": 1, "slot": 0 } },
    { "name": "set_parameter", "arguments": { "plugin_id": "lamb-compressor", "param_name": "threshold", "value": -18.0 } },
    { "name": "load_plugin", "arguments": { "plugin_id": "aida-x", "track_id": 1, "slot": 1 } },
    ...
  ]
}
```

### Streaming partial JSON parsing

As tokens stream in, you accumulate a buffer and attempt incremental parsing. A state machine detects `<tool_call>` / `</tool_call>` boundaries in Hermes-format output:

```rust
enum ParserState { Text, InToolCall(String) }

fn process_token(state: &mut ParserState, token: &str, buffer: &mut String) -> Option<ToolCall> {
    buffer.push_str(token);
    match state {
        ParserState::Text => {
            if buffer.contains("<tool_call>") {
                *state = ParserState::InToolCall(String::new());
                let start = buffer.find("<tool_call>").unwrap() + "<tool_call>".len();
                if let Some(end) = buffer.find("</tool_call>") {
                    let json = &buffer[start..end];
                    *state = ParserState::Text;
                    return serde_json::from_str(json).ok();
                }
            }
            None
        }
        ParserState::InToolCall(ref mut json_buf) => {
            json_buf.push_str(token);
            if json_buf.contains("</tool_call>") {
                let end = json_buf.find("</tool_call>").unwrap();
                let json = &json_buf[..end];
                let result = serde_json::from_str(json).ok();
                *state = ParserState::Text;
                buffer.clear();
                return result;
            }
            None
        }
    }
}
```

For partial JSON preview (showing parameters as they arrive), use the `json-stream-parser` crate or attempt `serde_json::from_str` on each accumulated chunk — it fails gracefully on incomplete input.

---

## 4. Rust architecture: the full pipeline

### Running mistral.rs on a background Tokio thread in Tauri v2

```rust
// src-tauri/src/llm_service.rs
use mistralrs::{
    TextModelBuilder, GgufModelBuilder, IsqType, TextMessages, TextMessageRole,
    Response, ChatCompletionChunkResponse, ChunkChoice, Delta,
    PagedAttentionMetaBuilder, Model,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

pub struct LlmState {
    pub model: Option<Arc<Model>>,
}

impl Default for LlmState {
    fn default() -> Self { Self { model: None } }
}

#[tauri::command]
pub async fn load_model(
    state: State<'_, Arc<Mutex<LlmState>>>,
) -> Result<String, String> {
    let model = GgufModelBuilder::new(
        "models",                          // directory
        vec!["Qwen3-8B-Q4_K_M.gguf"],    // files
    )
    .with_logging()
    .build()
    .await
    .map_err(|e| e.to_string())?;

    state.lock().await.model = Some(Arc::new(model));
    Ok("Model loaded".into())
}

#[tauri::command]
pub async fn generate_response(
    app: AppHandle,
    state: State<'_, Arc<Mutex<LlmState>>>,
    prompt: String,
    system_prompt: String,
) -> Result<(), String> {
    let model = {
        let guard = state.lock().await;
        guard.model.as_ref().ok_or("Model not loaded")?.clone()
    };

    // Spawn on background task — does not block main thread
    tauri::async_runtime::spawn(async move {
        let messages = TextMessages::new()
            .add_message(TextMessageRole::System, &system_prompt)
            .add_message(TextMessageRole::User, &prompt);

        let mut stream = model.stream_chat_request(messages).await.unwrap();

        while let Some(chunk) = stream.next().await {
            if let Response::Chunk(ChatCompletionChunkResponse { choices, .. }) = chunk {
                if let Some(ChunkChoice { delta: Delta { content: Some(token), .. }, .. })
                    = choices.first()
                {
                    let _ = app.emit("llm:token", serde_json::json!({
                        "token": token, "done": false
                    }));
                }
            }
        }
        let _ = app.emit("llm:token", serde_json::json!({ "token": "", "done": true }));
    });

    Ok(())
}
```

### Tool registry trait pattern — complete code

```rust
// src-tauri/src/tool_registry.rs
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// ─── Core types ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ToolResult {
    pub success: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip)]
    pub undo_description: Option<String>,
}

impl ToolResult {
    pub fn success(message: impl Into<String>) -> Self {
        Self { success: true, message: message.into(), data: None, undo_description: None }
    }
    pub fn success_with_data(message: impl Into<String>, data: Value) -> Self {
        Self { success: true, message: message.into(), data: Some(data), undo_description: None }
    }
    pub fn undoable(mut self, desc: impl Into<String>) -> Self {
        self.undo_description = Some(desc.into());
        self
    }
}

#[derive(Debug, Serialize)]
pub enum ToolError {
    NotFound(String),
    InvalidParams(String),
    ExecutionFailed(String),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::NotFound(n) => write!(f, "Tool not found: {}", n),
            Self::InvalidParams(e) => write!(f, "Invalid parameters: {}", e),
            Self::ExecutionFailed(e) => write!(f, "Execution failed: {}", e),
        }
    }
}

// ─── DawTool trait ───────────────────────────────────────

#[async_trait]
pub trait DawTool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn schema(&self) -> Value;  // JSON Schema for parameters
    async fn execute(&self, params: Value) -> Result<ToolResult, ToolError>;
}

// ─── ToolRegistry ────────────────────────────────────────

pub struct ToolRegistry {
    tools: HashMap<String, Box<dyn DawTool>>,
    undo_stack: Vec<UndoEntry>,
}

#[derive(Debug)]
struct UndoEntry {
    tool_name: String,
    description: String,
    params: Value,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self { tools: HashMap::new(), undo_stack: Vec::new() }
    }

    pub fn register(&mut self, tool: Box<dyn DawTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    pub async fn dispatch(&mut self, tool_name: &str, params: Value) -> Result<ToolResult, ToolError> {
        let tool = self.tools.get(tool_name)
            .ok_or_else(|| ToolError::NotFound(tool_name.into()))?;

        let result = tool.execute(params.clone()).await?;

        if let Some(ref desc) = result.undo_description {
            self.undo_stack.push(UndoEntry {
                tool_name: tool_name.to_string(),
                description: desc.clone(),
                params,
            });
        }

        Ok(result)
    }

    /// Generate the tools section for the LLM system prompt
    pub fn tools_for_prompt(&self) -> Value {
        let schemas: Vec<Value> = self.tools.values().map(|t| {
            serde_json::json!({
                "type": "function",
                "function": {
                    "name": t.name(),
                    "description": t.description(),
                    "parameters": t.schema(),
                }
            })
        }).collect();
        Value::Array(schemas)
    }

    pub fn undo_stack_len(&self) -> usize { self.undo_stack.len() }
}
```

### Example tool implementation

```rust
// src-tauri/src/tools/set_reverb.rs
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use crate::tool_registry::{DawTool, ToolResult, ToolError};

pub struct SetReverbTool;

#[derive(Deserialize)]
struct Params {
    track_id: u32,
    #[serde(default = "default_type")]
    r#type: String,
    #[serde(default = "default_decay")]
    decay_seconds: f64,
    #[serde(default = "default_mix")]
    mix: f64,
}
fn default_type() -> String { "hall".into() }
fn default_decay() -> f64 { 2.5 }
fn default_mix() -> f64 { 0.25 }

#[async_trait]
impl DawTool for SetReverbTool {
    fn name(&self) -> &str { "set_reverb" }
    fn description(&self) -> &str {
        "Add or configure reverb on a track. Types: hall, plate, room, spring, cathedral."
    }
    fn schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "track_id": { "type": "integer" },
                "type": { "type": "string", "enum": ["hall","plate","room","spring","cathedral"] },
                "decay_seconds": { "type": "number", "minimum": 0.1, "maximum": 20.0 },
                "mix": { "type": "number", "minimum": 0, "maximum": 1 }
            },
            "required": ["track_id"]
        })
    }
    async fn execute(&self, params: Value) -> Result<ToolResult, ToolError> {
        let p: Params = serde_json::from_value(params)
            .map_err(|e| ToolError::InvalidParams(e.to_string()))?;
        // In production: send to DAW engine via channel
        Ok(ToolResult::success(format!(
            "Set {} reverb on track {}: decay={}s, mix={}%",
            p.r#type, p.track_id, p.decay_seconds, p.mix * 100.0
        )).undoable(format!("Remove reverb from track {}", p.track_id)))
    }
}
```

### Thread safety between LLM and DAW threads

```rust
use std::sync::Arc;
use tokio::sync::{Mutex, mpsc};

// DAW commands flow through a channel to the audio thread
#[derive(Debug)]
enum DawCommand {
    LoadPlugin { plugin_id: String, track_id: u32, slot: u32 },
    SetParameter { plugin_id: String, param: String, value: f64 },
    Undo,
}

struct AppState {
    llm: Arc<Mutex<LlmState>>,
    registry: Arc<Mutex<ToolRegistry>>,
    daw_tx: mpsc::Sender<DawCommand>,  // Send commands to audio thread
}
```

The `ToolRegistry` lives behind `Arc<Mutex<>>` in Tauri's managed state. Tool `execute()` methods send `DawCommand` variants through a `tokio::sync::mpsc` channel to the audio thread — never calling audio APIs directly from the LLM thread.

### DAW state injection into the system prompt

Serialize only what the LLM needs, using abbreviated keys to conserve tokens:

```rust
impl DawProjectState {
    pub fn to_compact_json(&self) -> Value {
        json!({
            "tempo": self.tempo,
            "key": self.key,
            "ts": self.time_signature,
            "tracks": self.tracks.iter().map(|t| {
                let mut track = json!({ "id": t.id, "nm": t.name, "ty": t.track_type });
                if let Some(inst) = &t.instrument { track["inst"] = json!(inst); }
                if !t.effects.is_empty() { track["fx"] = json!(t.effects); }
                track["vol"] = json!(format!("{:.0}%", t.volume * 100.0));
                track
            }).collect::<Vec<_>>(),
            "sel_track": self.selected_track,
        })
    }
}
```

A typical project state costs ~150-200 tokens:

```json
{
    "tempo": 120,
    "key": "Bm",
    "ts": "4/4",
    "tracks": [
        { "id": 1, "nm": "Guitar", "ty": "audio", "vol": "75%", "fx": ["eq"] },
        { "id": 2, "nm": "Bass", "ty": "midi", "inst": "sfizz", "vol": "80%" },
        { "id": 3, "nm": "Drums", "ty": "midi", "inst": "hydrogen", "vol": "85%" }
    ],
    "sel_track": 1
}
```

### Streaming UI in React/TypeScript

```typescript
// src/hooks/useLlmStream.ts
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useRef, useCallback } from 'react';

interface ToolCallEvent {
    toolName: string;
    args: Record<string, unknown>;
    status: 'parsing' | 'executing' | 'complete' | 'error';
    result?: { success: boolean; message: string };
}

export function useLlmStream() {
    const [tokens, setTokens] = useState('');
    const [toolCalls, setToolCalls] = useState<ToolCallEvent[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const unlistenRefs = useRef<UnlistenFn[]>([]);

    useEffect(() => {
        const setup = async () => {
            const unToken = await listen<{ token: string; done: boolean }>('llm:token', (e) => {
                if (e.payload.done) {
                    setIsStreaming(false);
                } else {
                    setTokens((prev) => prev + e.payload.token);
                }
            });

            const unTool = await listen<ToolCallEvent>('llm:tool_call', (e) => {
                setToolCalls((prev) => {
                    const idx = prev.findIndex((tc) => tc.toolName === e.payload.toolName && tc.status !== 'complete');
                    if (idx >= 0) {
                        const u = [...prev];
                        u[idx] = e.payload;
                        return u;
                    }
                    return [...prev, e.payload];
                });
            });

            unlistenRefs.current = [unToken, unTool];
        };
        setup();
        return () => unlistenRefs.current.forEach((fn) => fn());
    }, []);

    const send = useCallback(async (prompt: string) => {
        setTokens('');
        setToolCalls([]);
        setIsStreaming(true);
        await invoke('generate_response', { prompt, maxTokens: 1024 });
    }, []);

    return { tokens, toolCalls, isStreaming, send };
}
```

Each tool call renders as a card that transitions through states: ⏳ parsing → ⚙️ executing → ✅ complete. The streaming token display shows a blinking cursor until `done: true` arrives.

---

## 5. Musical domain knowledge and RAG

### David Gilmour's Comfortably Numb signal chain

The studio tone for the Comfortably Numb solos (The Wall, 1979) is meticulously documented:

**Guitar**: 1969 Fender Stratocaster ("The Black Strat") with **DiMarzio FS-1 bridge pickup** (hotter output than stock) and a custom toggle enabling bridge+neck simultaneously.

**Signal chain in order**:

1. **MXR Dyna Comp** — Output: 7/10, Sensitivity: 4/10. Provides even sustain and pushes subsequent gain stages.
2. **Electro-Harmonix Big Muff Pi** (1974 Ram's Head version) — Volume: 4/10, Tone: 6/10, Sustain: 6/10. The core overdrive/fuzz sound — moderate, not maxed.
3. **Yamaha RA-200 Rotating Speaker** (in parallel with amp) — provides subtle chorusing and midrange body. This is NOT a pedal chorus; it's a physical rotating speaker cabinet with three spinning drivers. Live substitutes: EHX Electric Mistress flanger or Boss CE-2 chorus.
4. **Delay** (added during mixing) — First solo: **~450ms, 4-5 repeats, ~20% mix**. Second solo: ~580ms → ~450ms, 4-5 repeats, ~25% mix. Live (Pulse tour): TC2290 at 480ms + MXR Digital Delay at 720ms.
5. **Reverb** — studio room ambience and post-production reverb, not a pedal.

**Amplifier**: **Hiwatt DR103 Custom 100** (100W) running clean — all dirt comes from pedals. Hiwatt 4×12 cabinet with Fane Crescendo speakers. The Hiwatt and RA-200 outputs sum together.

### Building the artist-to-effects knowledge base

Each sound recipe maps an artist/tone description to a structured effects chain. The JSON schema:

```json
{
    "type": "object",
    "properties": {
        "id": { "type": "string" },
        "name": { "type": "string", "description": "e.g. 'David Gilmour - Comfortably Numb Solo'" },
        "tags": { "type": "array", "items": { "type": "string" } },
        "description": { "type": "string", "description": "Searchable natural language description" },
        "genre": { "type": "string" },
        "era": { "type": "string" },
        "instrument": { "type": "string" },
        "signal_chain": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "effect_type": { "type": "string" },
                    "plugin_id": { "type": "string" },
                    "model_file": { "type": "string", "description": "NAM/AIDA-X capture file if applicable" },
                    "parameters": { "type": "object", "additionalProperties": { "type": "number" } },
                    "notes": { "type": "string" }
                }
            }
        }
    }
}
```

### Additional artist recipes

**Jonny Greenwood (Radiohead, OK Computer era)**: Fender Telecaster Plus → EHX Small Stone phaser → DOD 440 envelope filter → DigiTech Whammy → dual signal path via Boss LS-2: Path A (clean → Boss SD-1 → Roland RE-201 Space Echo → Vox AC30) and Path B (distorted → Marshall Shredmaster → Fender Eighty-Five solid-state). Key: the Shredmaster provides signature Radiohead crunch while the Space Echo handles ambient textures.

**Bootsy Collins (70s funk bass)**: The signature sound is a **Mu-Tron III envelope filter** responding to attack dynamics, creating the squelchy wah-quack tone. Chain: Mu-Tron III → EHX Big Muff Pi → EHX Bass Micro Synthesizer → MXR Digital Delay, into an Ampeg SVT. James Jamerson, by contrast, used **zero effects** — just a 1962 P-Bass with dead flatwound strings direct into an Ampeg B-15.

**Daft Punk synthesizers**: Roland Juno-106 with heavy low-pass filtering is the core French house sound. Vocals use a **DigiTech Talker vocoder** ("Harder, Better, Faster, Stronger") or Antares Auto-Tune ("One More Time"). The pumping effect comes from sidechain compression on synth pads. Key effects: Mu-Tron Phasor, heavy LP filtering, 4-to-the-floor kick with Oberheim DMX drum machine.

### RAG pipeline with fastembed-rs and usearch

**fastembed** (v5.12, Apache 2.0) runs ONNX-based embedding models entirely locally. Use `AllMiniLML6V2Q` (quantized, ~23MB, 384 dimensions) for fast inference with good semantic quality.

**usearch** (v2.24) is the recommended vector index — HNSW-based, SIMD-accelerated, with first-class Rust bindings and disk persistence. For 100-2000 sound recipes, queries complete in microseconds.

**sqlite-vec** is a strong alternative if you want recipe metadata and embeddings in a single SQLite file. Brute-force KNN is fine at this scale.

```rust
// Build-time: embed and index all recipes
fn build_recipe_index(recipes: &[SoundRecipe]) -> Result<()> {
    let embedder = TextEmbedding::try_new(
        InitOptions::new(EmbeddingModel::AllMiniLML6V2Q)
    )?;

    let texts: Vec<String> = recipes.iter()
        .map(|r| format!("passage: {} {} {}", r.name, r.description, r.tags.join(" ")))
        .collect();
    let embeddings = embedder.embed(texts, None)?;

    let mut opts = IndexOptions::default();
    opts.dimensions = 384;
    opts.metric = MetricKind::Cos;
    let index = Index::new(&opts)?;
    index.reserve(recipes.len())?;
    for (i, emb) in embeddings.iter().enumerate() {
        index.add(recipes[i].id as u64, emb)?;
    }
    index.save("recipes.usearch")?;
    Ok(())
}

// Query-time: find relevant recipes and inject into prompt
fn retrieve_recipes(query: &str, top_k: usize) -> Result<Vec<SoundRecipe>> {
    let embedder = TextEmbedding::try_new(Default::default())?;
    let qvec = embedder.embed(vec![format!("query: {}", query)], None)?;
    let index = Index::new(&opts)?;
    index.load("recipes.usearch")?;
    let results = index.search(&qvec[0], top_k)?;
    // Map result keys back to recipes...
    Ok(matched_recipes)
}
```

**Cargo dependencies for RAG:**

```toml
fastembed = "5"
usearch = "2.24"
```

---

## 6. The complete David Gilmour example

For the prompt "make it sound like David Gilmour on Comfortably Numb" targeting track 1, the system should generate this exact tool call array. These use **free/open-source CLAP/VST3 plugins**:

```json
{
    "reasoning": "Gilmour's Comfortably Numb solo: compression for sustain, Big Muff fuzz at moderate gain, rotary speaker chorus effect, ~450ms delay with long repeats, hall reverb. Using FOSS plugin equivalents.",
    "tool_calls": [
        {
            "name": "load_plugin",
            "arguments": { "plugin_id": "lamb-compressor", "track_id": 1, "slot": 0 }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "lamb-compressor",
                "param_name": "threshold",
                "value": -20.0,
                "description": "Moderate compression like MXR Dyna Comp — even out dynamics for sustained singing tone"
            }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "lamb-compressor",
                "param_name": "ratio",
                "value": 4.0,
                "description": "Medium ratio for musical compression"
            }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "lamb-compressor",
                "param_name": "attack_ms",
                "value": 10.0,
                "description": "Fast attack to catch transients"
            }
        },
        {
            "name": "load_plugin",
            "arguments": { "plugin_id": "aida-x", "track_id": 1, "slot": 1 }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "aida-x",
                "param_name": "model",
                "value": "big-muff-rams-head.aidax",
                "description": "Load neural capture of 1974 EHX Big Muff Ram's Head — Gilmour's core fuzz"
            }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "aida-x",
                "param_name": "gain",
                "value": 0.6,
                "description": "Moderate sustain (6/10) — Gilmour never maxes the Big Muff"
            }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "aida-x",
                "param_name": "tone",
                "value": 0.6,
                "description": "Tone at 6/10 — slightly bright but not harsh"
            }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "aida-x",
                "param_name": "output",
                "value": 0.4,
                "description": "Volume at 4/10 — let compression and amp do the heavy lifting"
            }
        },
        {
            "name": "load_plugin",
            "arguments": { "plugin_id": "calf-rotary-speaker", "track_id": 1, "slot": 2 }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "calf-rotary-speaker",
                "param_name": "speed",
                "value": 0.4,
                "description": "Slow rotation — Gilmour's RA-200 provides subtle chorusing, not fast Leslie"
            }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "calf-rotary-speaker",
                "param_name": "mix",
                "value": 0.35,
                "description": "Blend rotary with dry signal for body without overwhelming"
            }
        },
        {
            "name": "add_delay",
            "arguments": { "track_id": 1, "time_ms": 450, "feedback": 0.45, "sync_to_tempo": false }
        },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "delay",
                "param_name": "mix",
                "value": 0.2,
                "description": "20% wet — Gilmour's delay sits behind the dry signal, not on top"
            }
        },
        {
            "name": "set_reverb",
            "arguments": { "track_id": 1, "type": "hall", "decay_seconds": 3.0, "mix": 0.2 }
        },
        {
            "name": "apply_eq_preset",
            "arguments": {
                "track_id": 1,
                "description": "Gentle mid boost around 1-2kHz for vocal-like sustain quality, slight roll-off above 8kHz to avoid harshness"
            }
        }
    ]
}
```

**Plugin mapping to Gilmour's actual gear:**

| Real Gear                    | FOSS Plugin                            | Format     | Notes                                                             |
| ---------------------------- | -------------------------------------- | ---------- | ----------------------------------------------------------------- |
| MXR Dyna Comp                | **lamb** (nih-plug)                    | CLAP, VST3 | Lookahead compressor                                              |
| EHX Big Muff Pi (Ram's Head) | **AIDA-X** + community capture         | CLAP, VST3 | RTNeural model player; Big Muff captures available from community |
| Yamaha RA-200 rotary         | **Calf Rotary Speaker**                | LV2        | Leslie/rotary simulation                                          |
| Studio delay (~450ms)        | **DPF Delay** or built-in              | CLAP       | Set to 450ms, 4-5 repeats, 20% mix                                |
| Hall reverb                  | **Dragonfly Reverb** or **RoomReverb** | CLAP, VST3 | Algorithmic hall reverb                                           |
| Hiwatt DR103 amp             | **NAM** (Neural Amp Modeler)           | VST3, AU   | Community Hiwatt captures exist                                   |

---

## 7. Few-shot system prompt template

````
You are a professional sound design assistant embedded in a DAW. You decompose user requests into precise tool call chains.

# Current Project State
```json
{daw_state_json}
````

# Available Tools

```json
{tools_schema_json}
```

# Sound Recipe References (from knowledge base)

{rag_retrieved_recipes}

# Output Format

Respond with a JSON object containing:

- "reasoning": Brief explanation of your sound design approach
- "tool_calls": Ordered array of tool calls to execute

Each tool call: {"name": "tool_name", "arguments": {...}}

# Examples

User: "add a warm tape delay to track 2"

```json
{
    "reasoning": "Warm tape delay with moderate feedback and analog character",
    "tool_calls": [
        {
            "name": "add_delay",
            "arguments": { "track_id": 2, "time_ms": 375, "feedback": 0.35, "sync_to_tempo": false }
        },
        {
            "name": "apply_eq_preset",
            "arguments": {
                "track_id": 2,
                "description": "Roll off highs above 4kHz on delay return for tape-like warmth"
            }
        }
    ]
}
```

User: "make track 1 sound like a 70s funk bass"

```json
{
    "reasoning": "70s funk bass tone: envelope filter for wah-quack, light compression, warm amp tone",
    "tool_calls": [
        { "name": "load_plugin", "arguments": { "plugin_id": "calf-envelope-filter", "track_id": 1, "slot": 0 } },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "calf-envelope-filter",
                "param_name": "sensitivity",
                "value": 0.7,
                "description": "High sensitivity for responsive quack on attack"
            }
        },
        { "name": "load_plugin", "arguments": { "plugin_id": "lamb-compressor", "track_id": 1, "slot": 1 } },
        {
            "name": "set_parameter",
            "arguments": {
                "plugin_id": "lamb-compressor",
                "param_name": "ratio",
                "value": 3.0,
                "description": "Light compression to even out dynamics"
            }
        },
        {
            "name": "apply_eq_preset",
            "arguments": {
                "track_id": 1,
                "description": "Boost low-mids at 200-400Hz for warmth, cut above 6kHz for vintage character"
            }
        }
    ]
}
```

Now respond to the user's request with a valid JSON tool call chain.

````

---

## 8. Rig, AutoAgents, and prior art

### Rig framework (github.com/0xPlaygrounds/rig)

Rig (v latest, ~6.2k stars, MIT) is a mature Rust LLM framework with excellent tool abstractions and 20+ provider integrations. Tools are defined via a `Tool` trait with typed `Args` and `Output`. **However, Rig requires an external API server** — it connects to Ollama, OpenAI, etc. via HTTP. It has no native in-process inference. For a single-binary Tauri app, this means either bundling Ollama as a sidecar or running mistral.rs as an HTTP server internally — both add unnecessary complexity. Rig's tool abstractions are worth studying for API design inspiration, but the HTTP requirement makes it suboptimal for this use case.

### AutoAgents deserves attention

The `autoagents` framework (liquidos-ai) includes **`autoagents-mistral-rs`** and **`autoagents-llamacpp`** backends for direct in-process inference. It provides derive macros for tools (`#[tool(name = "...", description = "...")]`), ReAct executors, and structured outputs. This is the most architecturally aligned framework for a Tauri DAW app, though it's still early-stage. Worth monitoring.

### Prior art in NL-to-DAW

**DAWZY** (NeurIPS 2025) is the closest prior art. It uses MCP tools to control REAPER, with the LLM generating atomic Lua/ReaScript operations constrained by serialized DAW state. Key finding: **Claude achieved 100% task success; open-source models only 25-50%** (they hallucinated ReaScript functions). This validates the tool-calling approach over code generation — structured tool calls avoid the hallucination problem.

**Ableton-MCP** (~2.3k GitHub stars) uses a Python TCP bridge: Ableton Remote Script → TCP socket → MCP Server → LLM tool calls. One contributor extended it to **70+ tool calls**. This demonstrates that the DAW tool call vocabulary needs to be comprehensive.

**MAGDA** is an open-source DAW (GPL v3, built on Tracktion Engine) with an integrated AI chat console and a companion DSL project. It's early but architecturally interesting.

**WavTool** was the world's first AI DAW (browser-based, GPT-4 powered) — it shut down in November 2024, apparently acquired. Its "Conductor" feature could generate MIDI, create wavetables, and control effects via chat.

**Key pattern across all prior art**: every successful implementation uses MCP-style tool calling (not code generation), grounds the LLM with serialized session state, and makes all operations reversible.

---

## 9. Recommended build order

Build incrementally, validating each layer before moving on:

**Phase 1 — Inference foundation (week 1-2)**. Embed mistral.rs in a Tauri v2 app. Load Qwen3-8B Q4_K_M via `GgufModelBuilder`. Stream tokens to the React frontend via `app.emit("llm:token", ...)`. Validate tokens/second on target hardware. This proves the core loop works.

**Phase 2 — Tool calling pipeline (week 2-3)**. Implement the `DawTool` trait and `ToolRegistry`. Define 3-4 core tools (load_plugin, set_parameter, set_reverb, add_delay). Wire up the Hermes `<tool_call>` parser for streaming output. Test with hardcoded prompts. At this stage, tools just log actions — no real DAW integration yet.

**Phase 3 — System prompt and few-shot (week 3-4)**. Build the DAW state serializer. Construct the full system prompt template with tool schemas and few-shot examples. Add the Gilmour example as a test case. Tune prompt engineering until the model reliably produces valid tool call chains.

**Phase 4 — RAG knowledge base (week 4-5)**. Build 50-100 sound recipes in JSON. Embed with fastembed-rs, index with usearch. Wire retrieval into the system prompt pipeline. Test that "David Gilmour guitar" retrieves the right recipe and the model adapts its output.

**Phase 5 — DAW integration (week 5-8)**. Connect tool execution to actual audio engine operations via the `mpsc` channel. Implement command/undo. Expand to all 9+ tools. This is where the real DAW engineering happens and is the longest phase.

**Key dependency versions:**
```toml
[dependencies]
tauri = { version = "2", features = [] }
mistralrs = { version = "0.7", features = ["metal"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
async-trait = "0.1"
fastembed = "5"
usearch = "2.24"
````

### Honest maturity assessment

| Component                     | Maturity                     | Risk                                                      |
| ----------------------------- | ---------------------------- | --------------------------------------------------------- |
| mistral.rs library embedding  | ⭐⭐⭐⭐ Production-ready    | Low — well-tested, active development                     |
| Qwen3-8B tool calling         | ⭐⭐⭐⭐ Excellent accuracy  | Low — F1=0.919, near GPT-4                                |
| Tauri v2 event streaming      | ⭐⭐⭐⭐ Stable              | Low — standard Tauri pattern                              |
| fastembed-rs                  | ⭐⭐⭐⭐ Stable              | Low — ONNX-based, 44+ models                              |
| usearch Rust bindings         | ⭐⭐⭐⭐ Production          | Low — used by ScyllaDB                                    |
| Tool call parsing (streaming) | ⭐⭐⭐ Requires custom work  | Medium — no off-the-shelf crate for Hermes tag parsing    |
| Open-source CLAP plugins      | ⭐⭐⭐ Functional but sparse | Medium — some effects have no quality CLAP equivalent yet |
| 16GB RAM feasibility          | ⭐⭐ Tight                   | High — DAW + model may exceed memory with heavy sessions  |

## Conclusion

The stack of **mistral.rs v0.7 + Qwen3-8B Q4_K_M + Tauri v2 + fastembed/usearch** provides every building block for a fully local NL-to-DAW system. Qwen3-8B's near-GPT-4 tool calling accuracy at Q4_K_M quantization is the breakthrough that makes this viable on consumer hardware — even two years ago, no local model could reliably decompose "make it sound like David Gilmour" into a correct 15-step effects chain. The critical insight from prior art (DAWZY, Ableton-MCP) is that **structured tool calls with session state grounding succeed where code generation fails**, because models hallucinate API function names but can select from a provided tool schema with high reliability. The RAG layer transforms this from a generic tool-calling system into a musically literate one — when the model has Gilmour's actual signal chain parameters in context (450ms delay, Big Muff at 6/10, RA-200 rotary), it doesn't need to guess. Target **32GB machines** for comfortable headroom, start with Phase 1 inference integration, and expand the tool vocabulary iteratively based on real user prompts.
