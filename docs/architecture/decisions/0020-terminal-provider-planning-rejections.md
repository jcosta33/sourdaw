# ADR 0020: Terminal provider planning rejections

**Status:** Accepted

## Context

Structured native and hosted tool-planning adapters reported malformed payloads, refusals, inconsistent finish states, and incomplete output with ordinary errors. The provider fallback chain could mistake those completed but non-executable protocol responses for availability failures, retry another backend, and bypass the original provider's terminal result. A malformed Tauri DTO is different because the frontend cannot prove that the native model completed with a validated planning result. Transport, protocol-bridge, configuration, and initialization failures still need fallback so tool planning remains available when a backend cannot run.

## Decision

- Structured hosted adapters throw `ToolPlanningRejectedError` for refusal, malformed or inconsistent payloads, non-tool assistant content without valid tool calls, and incomplete tool-call batches.
- Browser-dev native text planning requires exactly one choice, string message content, and `finish_reason: stop`. Malformed successful-response JSON, malformed envelopes, and non-string Tauri tool-planning output are terminal rejections.
- The Tauri native completion command still exposes only a string, so finish-state validation cannot be claimed there until the bridge returns metadata; strict text syntax validation remains in effect.
- Tauri native structured planning returns a minimal tagged `complete` or `rejected` DTO; command errors remain reserved for model availability, runtime, and cancellation failures, while the TypeScript repository validates and classifies the DTO.
- Only a validated native `rejected` DTO becomes `ToolPlanningRejectedError`; malformed native envelopes, complete payloads, and result items raise `NativeToolCallingProtocolError`, bypass native text fallback, and leave the native attempt unhealthy while another configured provider may run.
- Qwen-native tool-call responses may include additional assistant content when every tool call validates; `stop` responses without calls complete only when assistant content is absent or blank.
- Anthropic planning responses require an array containing only `text` blocks with string text or `tool_use` blocks with a non-empty string name and record input.
- OpenAI-compatible requests set `n: 1` and accept exactly one response choice; zero or multiple choices are terminal protocol rejections.
- HTTP status failures, body-stream and transport failures, aborts, provider configuration changes, and backend initialization or runtime failures retain their existing retry or cancellation behavior.
- Provider orchestration converts `ToolPlanningRejectedError` into a rejected planning outcome immediately and does not try another backend or native text fallback.
- A terminal planning rejection leaves the responding backend ready because the request completed and the failure concerns the model response, not backend availability.

## Consequences

Provider refusals and provider-validated invalid structured responses cannot be bypassed through another provider, native text generation, or downstream action execution. Malformed native IPC DTOs and availability failures can still use the configured provider fallback chain. Existing rejected-outcome consumers receive terminal model reasons without treating them as backend unavailability.
