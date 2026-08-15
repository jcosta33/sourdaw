# ADR 0020: Terminal provider planning rejections

**Status:** Accepted

**Amended by:** ADR 0036 for universal terminal stream semantics.

## Context

Structured native and hosted tool-planning adapters reported malformed payloads, refusals, inconsistent finish states, and incomplete output with ordinary errors. The provider fallback chain could mistake those completed but non-executable protocol responses for availability failures, retry another backend, and bypass the original provider's terminal result. A malformed Tauri DTO is different because the frontend cannot prove that the native model completed with a validated planning result. Transport, protocol-bridge, configuration, and initialization failures still need fallback so tool planning remains available when a backend cannot run.

## Decision

- Structured hosted adapters throw `ToolPlanningRejectedError` for refusal, malformed or inconsistent payloads, non-tool assistant content without valid tool calls, and incomplete tool-call batches.
- Browser-dev native text planning requires exactly one choice, string message content, and `finish_reason: stop`. Malformed successful-response JSON, malformed envelopes, and non-string Tauri tool-planning output are terminal rejections.
- The Tauri native completion command still exposes only a string, so finish-state validation cannot be claimed there until the bridge returns metadata; strict text syntax validation remains in effect.
- Tauri native structured planning returns a minimal tagged `complete` or `rejected` DTO with `protocolVersion: 1`; missing or unsupported versions and cross-variant contradictions are protocol errors, while additive metadata and tool-call identifiers remain compatible.
- Only a validated native `rejected` DTO becomes `ToolPlanningRejectedError`; malformed native envelopes, complete payloads, and result items raise `NativeToolCallingProtocolError`, bypass native text fallback, and leave the native attempt unhealthy while another configured provider may run. Aborting that fallback, including in the same tick as the operational failure, sets status idle instead of restoring the failed backend's prior ready status.
- Qwen-native and OpenAI-compatible tool-call responses may include protocol-valid assistant content when every non-empty tool-call batch validates; `stop` responses without calls complete only when assistant content is absent or blank.
- Anthropic planning responses require an array containing only `text` blocks with string text or `tool_use` blocks with a non-empty string name and record input.
- OpenAI-compatible requests set `n: 1` and never select among zero or multiple response choices; cardinality violations raise `HostedToolCallingProtocolError`, mark that attempt unhealthy, and may use provider fallback.
- HTTP status failures, body-stream and transport failures, aborts, provider configuration changes, and backend initialization or runtime failures retain their existing retry or cancellation behavior.
- Provider orchestration converts `ToolPlanningRejectedError` into a rejected planning outcome immediately and does not try another backend or native text fallback.
- A terminal planning rejection leaves the responding backend ready because the request completed and the failure concerns the model response, not backend availability.

## Consequences

Provider refusals and provider-validated invalid structured responses cannot be bypassed through another provider, native text generation, or downstream action execution. Malformed native IPC DTOs and availability failures can still use the configured provider fallback chain. Existing rejected-outcome consumers receive terminal model reasons without treating them as backend unavailability.
