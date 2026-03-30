# Implementation Plan for LLM-Assisted DAW Project Editing (WebLLM & Rust)

## 1. DAW Project Data Model and Chunking

A DAW project is a nested JSON graph: tracks (audio/MIDI), clips, devices (instruments/effects), routing, automation curves, tempo map, etc. For example, film-production tools already use JSON for complex scene graphs【2†L58-L66】; similarly, our audio project can be chunked. Split the state into logical parts (e.g. **Arrangement**: tracks & clips, **Mixer/Devices**, **Automation**, **Global Tempo/Time**). When prompting the model, send only the relevant chunk(s) plus a concise summary of the rest (e.g. “Project has 5 tracks, chorus on track 3 selected”). This keeps context small and focused. Use stable, unique IDs for list items (e.g. clip IDs, device IDs) so the model can refer to them by name or key instead of fragile indices【2†L91-L100】.

- _Key idea:_ Treat the project as a structured JSON document; feed the model only the subset it needs (e.g. only track 3 data when editing that track) plus any high-level context.
- _Arrays/EASE:_ To avoid index-shift bugs, maintain persistent IDs or “EASE” keys on array elements【2†L91-L100】. For example, each MIDI clip gets an immutable `clipId` so patch ops refer by `/clips/clipId` instead of `/clips/3`.

## 2. Edit Representation: JSON Patch vs Domain Ops

Define a **structured edit schema** rather than free text. One approach is to use **RFC-6902 JSON Patch**: a list of `{op,path,value}` operations. LLMs can be prompted to output just the minimal patch for an instruction【2†L177-L184】. For instance, to rename a clip, the model would emit `{"op":"replace","path":"/tracks/2/clips/clip_42/name","value":"New Name"}`. JSON Patch is a standard format for safe, atomic edits【2†L177-L184】. In Rust, crates like _json-patch_ implement RFC-6902.

Alternatively or additionally, define **domain-specific ops** with a JSON schema. For example:

```json
{
    "ops": [
        { "type": "duplicate_clip", "clipId": "clip_42", "destTrack": "track_7", "startBeat": 64 },
        { "type": "set_param", "track": "track_7", "device": "plugin_lp1", "param": "cutoff", "value": 4200 }
    ]
}
```

Domain ops use explicit names and types, making errors easier to catch. You can enforce a JSON Schema for these ops in the prompt, so the model must output valid JSON matching that schema. OpenAI’s Structured Output guide suggests using function-calling (or JSON schema) to constrain output【6†L916-L924】. In practice, we’ll likely have one **generic apply-patch tool** (rather than dozens), where the LLM returns an `ops` array or patch.

- _JSON Patch:_ Minimal atomic changes. Proven for undo/redo persistence【15†L554-L562】.
- _Domain Ops:_ Human-readable and semantically rich (e.g. `duplicate_clip`), easier to validate semantically.

## 3. WebLLM Prompting and Structured Output

Use WebLLM (MLC’s in-browser LLM) in chat mode with a system prompt that enforces JSON output. For example, the system message can say “Respond **only** in JSON. Do not output any explanation.” Then the user message includes the NL instruction and the relevant JSON state slice. For instance:

```
System: You are a DAW editing assistant. Output only JSON edits.
User: {state_json} | Instruction: "Add reverb device to track 3 with default settings."
```

The model should produce something like:

```json
{"ops":[{"type":"add_device","trackId":"track3","device":"reverb","settings":{...}}]}
```

With WebLLM, use its streaming API to receive partial JSON. You can parse the incoming stream to reconstruct valid JSON before validation.

- Use structured output mode (JSON mode) to get schema-adherring output【6†L944-L952】【6†L916-L924】.
- Keep system prompt strict (“must output JSON array of ops only”).
- Preview/diff: Always parse and display the patch for user confirmation before applying.

## 4. Rust Backend: Validation, Apply, Undo/Redo

The Rust backend _owns_ the true project state and validates everything. On receiving a JSON patch or domain-op list from the model:

1. **Parse and Validate:** Use `serde_json` or a JSON Schema crate to validate structure. Then check each operation’s semantics: ensure IDs exist, numbers are in range, no illegal overlaps, etc. Reject or sanitize invalid ops.
2. **Compute Inverses:** For undo support, compute the inverse patch for each operation before applying. For JSON Patch this is straightforward (e.g. `{"op":"replace","path":"…","value":oldValue}`)【15†L554-L562】. Store both the patch and its inverse in a history stack.
3. **Apply Edits:** Use a library (e.g. the Rust `json-patch` crate) to apply the JSON patch to your project state. For domain ops, write hand-coded handlers (e.g. for “duplicate_clip”, create a new clip entry).
4. **Confirm and Persist:** After applying, you can emit the new state or a diff back to the UI. Also push the patch onto an undo stack so the user can revert. JSON Patch is inherently undo-friendly: you just apply the stored inverse. As shown in e.g. _json-patch-history_, storing the patch and its inverse enables reliable time travel【15†L554-L562】.

**Summary:** Always keep the original state in Rust. Do not let the model override whole documents. Only apply model-proposed patches after checks. This way, the app retains control of invariants and undo history.

## 5. Model Selection, Benchmarking & Integration

For a ~7B local model, the **Qwen2.5-Coder-7B-Instruct** is currently state-of-the-art for code tasks. In Qwen’s benchmarks it significantly outperformed other 7B models (HE+ 84.1%, MBPP+ 71.7% for Qwen vs ~44%/44% for CodeLlama-7B)【25†L1180-L1183】【22†L1202-L1205】. Thus Qwen2.5-Coder-7B should handle our JSON-and-ops editing tasks very well. (It even rivals much larger open models on coding benchmarks【25†L1180-L1183】.)

- **Benchmark:** Before full integration, run a few test prompts (e.g. “duplicate clip” or “set parameter”) against Qwen2.5 and other candidates (CodeLlama, StarCoder2, etc.) on sample state JSON to verify correctness and cost.
- **WebLLM (Browser):** MLC provides quantized builds of Qwen2.5-7B (e.g. q0f16) for in-browser use【27†L47-L49】. Use one of these in Tauri’s WebView via WebLLM. WebLLM’s chat API with streaming will integrate with the frontend.
- **Rust Backend:** To run Qwen2.5 in the native part, use mistralrs or a similar Rust inference library. If Qwen2.5 is not directly supported by mistralrs, you may convert the model to a supported GGUF format (similar to how the Hermes Llama was loaded). Then load it with `GgufModelBuilder` as in the sample code, replacing the GGUF repo/URL. Finally, use `model.stream_chat_request` for streaming generation just as is done for the current model.

In summary:

- **One Generic Tool:** Instead of many specialized tools, expose one “apply_patch” endpoint in Rust. Let the LLM output JSON ops as its “function call”.
- **Load Qwen2.5:** For native, download the Qwen2.5 GGUF/Safetensors (or use HuggingFace MLC model) and load with mistralrs. For web, use the MLC/WebLLM quantized Qwen build【27†L47-L49】.
- **Streaming Output:** Both Rust (`stream_chat_request`) and WebLLM support streaming JSON chunks. Reassemble and parse on the fly.

**References:** Cutting-edge work confirms that instruct-tuned code models like Qwen2.5-7B excel at patch-generation tasks【25†L1180-L1183】【22†L1202-L1205】. JSON Patch (RFC6902) is an established format for safe diffs【2†L177-L184】 and even has ready-made Rust crates. Undo/redo via inverse patches is standard practice【15†L554-L562】. Combining these with a structured prompt approach yields a robust editing workflow.
