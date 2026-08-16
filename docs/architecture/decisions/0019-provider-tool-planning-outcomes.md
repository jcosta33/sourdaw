# ADR 0019: Provider tool-planning outcomes
**Status:** Accepted
## Context
Provider-neutral tool planning returned only a `ToolCallResult[]`. Structured providers can return an explicitly valid empty batch, but the WebLLM text parser also produced an empty array for an empty response, refusal prose, malformed JSON, or truncated output. The action parser therefore could not prove that an empty array represented successful planning before allowing the legacy DSO fallback. Direct consumers likewise could not distinguish a valid no-op from an unusable plan.
## Decision
- Provider-neutral action planning returns a discriminated `complete` or `rejected` outcome internally; successful structured cloud tool-call arrays map to `complete`, including an explicitly valid empty array, without changing provider error classification.
- WebLLM text accepts one fully consumed JSON, fenced JSON, XML sequence, or strict JSONL representation. Tool-call arguments must be plain objects, and duplicate object keys at any depth are invalid. Strict text parsing rejects syntactically incomplete or malformed payloads; provider completion metadata and non-terminal finish-state classification belong to terminal protocol outcomes in ADR 0020.
- A rejected planning outcome stops action bridging and DSO parsing. DSO is eligible only after a `complete` outcome containing zero proposed calls.
- The public `generateToolCalls` compatibility boundary still returns a tool-call array and throws when internal planning is rejected; action parsing uses the outcome API directly.
## Consequences
An empty array is no longer an ambiguous success signal inside action planning. WebLLM text planning cannot bypass an unusable response through the DSO editor, while existing direct consumers and structured-provider fallback behavior remain compatible.
