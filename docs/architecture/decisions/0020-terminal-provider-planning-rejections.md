# ADR 0020: Terminal provider planning rejections

**Status:** Accepted

## Context

Structured native and hosted tool-planning adapters reported malformed payloads, refusals, inconsistent finish states, and incomplete output with ordinary errors. The provider fallback chain could mistake those completed but non-executable protocol responses for availability failures, retry another backend, and bypass the original provider's terminal result. Transport, configuration, and initialization failures still need fallback so tool planning remains available when a backend cannot run.

## Decision

- Structured native and hosted adapters throw `ToolPlanningRejectedError` for refusal, malformed or inconsistent payloads, non-tool assistant content, and incomplete tool-call batches.
- HTTP status failures, transport errors, provider configuration changes, and backend initialization failures retain their existing retry or cancellation behavior.
- Provider orchestration converts `ToolPlanningRejectedError` into a rejected planning outcome immediately and does not try another backend or native text fallback.
- A terminal planning rejection leaves the responding backend ready because the request completed and the failure concerns the model response, not backend availability.

## Consequences

Provider refusals and invalid structured responses cannot be bypassed through another provider, native text generation, or downstream action execution. Availability failures can still use the configured fallback chain. Existing rejected-outcome consumers receive the terminal reason without treating it as backend unavailability.
