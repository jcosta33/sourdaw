# ADR 0020: Terminal provider planning rejections

**Status:** Partially superseded by ADR 0037

> Historical scope: references to the retired native language-model route are superseded by ADR 0037. The hosted-provider rejection contract remains accepted.

**Amended by:** ADR 0036 for universal terminal stream semantics.

## Context

Structured provider tool-planning adapters reported malformed payloads, refusals, inconsistent finish states, and incomplete output with ordinary errors. The provider fallback chain could mistake those completed but non-executable protocol responses for availability failures, retry another backend, and bypass the original provider's terminal result. Transport, protocol-bridge, configuration, and initialization failures still need fallback so tool planning remains available when a backend cannot run.

## Decision

- Structured hosted adapters throw `ToolPlanningRejectedError` for refusal, malformed or inconsistent payloads, non-tool assistant content without valid tool calls, and incomplete tool-call batches.
- OpenAI-compatible tool-call responses may include protocol-valid assistant content when every non-empty tool-call batch validates; `stop` responses without calls complete only when assistant content is absent or blank.
- Anthropic planning responses require an array containing only `text` blocks with string text or `tool_use` blocks with a non-empty string name and record input.
- OpenAI-compatible requests set `n: 1` and never select among zero or multiple response choices; cardinality violations raise `HostedToolCallingProtocolError`, mark that attempt unhealthy, and may use provider fallback.
- HTTP status failures, body-stream and transport failures, aborts, provider configuration changes, and backend initialization or runtime failures retain their existing retry or cancellation behavior.
- Provider orchestration converts `ToolPlanningRejectedError` into a rejected planning outcome immediately and does not try another backend.
- A terminal planning rejection leaves the responding backend ready because the request completed and the failure concerns the model response, not backend availability.

## Consequences

Provider refusals and provider-validated invalid structured responses cannot be bypassed through another provider or downstream action execution. Availability failures can still use the configured provider fallback chain. Existing rejected-outcome consumers receive terminal model reasons without treating them as backend unavailability.
