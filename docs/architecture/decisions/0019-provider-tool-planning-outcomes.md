# ADR 0019: Provider tool-planning outcomes

**Status:** Accepted

## Context

Provider-neutral tool planning returned only a `ToolCallResult[]`. Structured providers can return an explicitly valid empty batch, but the WebLLM and native text parsers also produced an empty array for an empty response, refusal prose, malformed JSON, or truncated output. The action parser therefore could not prove that an empty array represented successful planning before allowing the legacy DSO fallback. Direct consumers likewise could not distinguish a valid no-op from an unusable plan.

## Decision

- Provider-neutral tool planning returns a discriminated `complete` or `rejected` outcome.
- Existing successful structured cloud and native tool-call arrays map to `complete`, including an explicitly valid empty array. Structured provider error classification is unchanged by this decision.
- WebLLM and native text responses map only a syntactically valid empty JSON tool-call batch to `complete` with zero calls. Empty text, refusal or other non-tool text, malformed syntax, invalid calls, and truncated output map to `rejected` with a human-readable reason.
- A rejected planning outcome stops action bridging and DSO parsing. DSO is eligible only after a `complete` outcome containing zero proposed calls.
- Direct consumers of provider-neutral planning must branch on the outcome. MIDI note generation returns no generated notes for a rejected plan.

## Consequences

An empty array is no longer an ambiguous success signal. WebLLM and native text planning cannot bypass an unusable response through the DSO editor, while the existing structured-provider execution and fallback behavior remains unchanged. Consumers must handle both outcome variants before reading tool calls.
